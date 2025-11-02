import express from 'express';
import { prisma } from '../index';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

const router = express.Router();

// Zod Validation Schemas
const locationSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const postRequestSchema = z.object({
  src: locationSchema, // Source location
  dst: locationSchema, // Destination location
  desiredDepartureTime: z.string().datetime(), // ISO 8601 string
  canPayAmount: z.number().positive('Payment amount must be positive'),
  passengerCount: z.number().int().min(1, 'Must have at least 1 passenger'),
});

/**
 * POST /api/requests
 * Creates a new ride request (posted by a rider).
 *
 */
router.post('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    // 1. Get the logged-in user's ID
    const riderId = req.user!.id;

    // 2. Validate the request body
    const result = postRequestSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: result.error.issues[0].message });
    }
    const { src, dst, desiredDepartureTime, canPayAmount, passengerCount } =
      result.data;

    // 3. Create the ride request
    const newRequest = await prisma.rideRequest.create({
      data: {
        desiredDepartureTime: new Date(desiredDepartureTime), // Convert string to Date
        canPayAmount,
        passengerCount,
        srcDescription: src.description,
        srcLat: src.latitude,
        srcLng: src.longitude,
        dstDescription: dst.description,
        dstLat: dst.latitude,
        dstLng: dst.longitude,
        riderId: riderId,
        status: 'PENDING',
      },
    });

    res.status(201).json(newRequest);
  } catch (error) {
    console.error('Error posting ride request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Schema for validating URL query parameters
const searchRequestQuerySchema = z.object({
  // Location
  from_lat: z.coerce.number().optional(),
  from_lng: z.coerce.number().optional(),
  to_lat: z.coerce.number().optional(),
  to_lng: z.coerce.number().optional(),
  // Date
  date: z.coerce.date().optional(),
  // Filters
  minOffer: z.coerce.number().positive().optional(),
  passengers: z.coerce.number().int().min(1).optional(),
  // Sort
  sort: z
    .enum(['offer', 'earliest', 'rating', 'recommended'])
    .optional()
    .default('recommended'),
});

/**
 * GET /api/requests/search
 * Searches for available ride requests based on query parameters.
 *
 */
router.get('/search', authMiddleware, async (req: AuthRequest, res) => {
  try {
    // 1. Validate the query parameters
    const result = searchRequestQuerySchema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({ error: result.error.issues[0].message });
    }
    const filters = result.data;

    // 2. Build the dynamic WHERE clause
    const where: Prisma.RideRequestWhereInput = {
      status: 'PENDING', // Always filter for pending requests
      desiredDepartureTime: { gte: new Date() }, // Always for the future
    };

    // Apply filters
    if (filters.minOffer) {
      where.canPayAmount = { gte: filters.minOffer };
    }
    if (filters.passengers) {
      where.passengerCount = { equals: filters.passengers };
    }
    if (filters.date) {
      const startOfDay = new Date(filters.date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(filters.date);
      endOfDay.setHours(23, 59, 59, 999);
      where.desiredDepartureTime = { gte: startOfDay, lte: endOfDay };
    }

    // Apply simple location filter (Bounding Box)
    const proximity = 0.1; // Approx. 6.9 miles
    if (filters.from_lat && filters.from_lng) {
      where.srcLat = {
        gte: filters.from_lat - proximity,
        lte: filters.from_lat + proximity,
      };
      where.srcLng = {
        gte: filters.from_lng - proximity,
        lte: filters.from_lng + proximity,
      };
    }
    if (filters.to_lat && filters.to_lng) {
      where.dstLat = {
        gte: filters.to_lat - proximity,
        lte: filters.to_lat + proximity,
      };
      where.dstLng = {
        gte: filters.to_lng - proximity,
        lte: filters.to_lng + proximity,
      };
    }

    // 3. Build the dynamic ORDER BY clause
    const orderBy: Prisma.RideRequestOrderByWithRelationInput = {};
    switch (filters.sort) {
      case 'offer':
        orderBy.canPayAmount = 'desc'; // Highest offer
        break;
      case 'earliest':
        orderBy.desiredDepartureTime = 'asc';
        break;
      case 'rating':
        orderBy.rider = { riderRating: 'desc' }; // Highest rider rating
        break;
      default: // 'recommended' or no sort
        orderBy.createdAt = 'desc'; // Show newest requests first
    }

    // 4. Execute the final query
    const requests = await prisma.rideRequest.findMany({
      where,
      orderBy,
      include: {
        rider: {
          select: { name: true, riderRating: true },
        },
      },
    });

    res.status(200).json(requests);
  } catch (error) {
    console.error('Error searching requests:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const acceptRequestSchema = z.object({
  vehicleId: z.string().cuid('You must select a valid vehicle'),
});

/**
 * POST /api/requests/:requestId/accept
 * A driver accepts a pending ride request.
 * This is a transactional operation:
 * 1. Updates RideRequest status to ACCEPTED.
 * 2. Creates a new Ride based on the request.
 * 3. Creates a new CONFIRMED Booking.
 * 4. Creates a new Chat.
 *
 */
router.post(
  '/:requestId/accept',
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      // 1. Get Driver ID, Request ID
      const driverId = req.user!.id;
      const { requestId } = req.params;

      // 2. Ensure user is a DRIVER
      if (req.user?.role !== 'DRIVER') {
        return res
          .status(403)
          .json({ error: 'You must be a driver to accept a request' });
      }

      // 3. Validate the body (vehicleId)
      const result = acceptRequestSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: result.error.issues[0].message });
      }
      const { vehicleId } = result.data;

      // 4. Verify the selected vehicle belongs to this driver
      const vehicle = await prisma.vehicle.findUnique({
        where: { id: vehicleId, driverId: driverId },
      });
      if (!vehicle) {
        return res
          .status(404)
          .json({ error: 'Vehicle not found or it is not yours' });
      }

      // 5. Use a transaction to accept the request
      const [updatedRequest, newRide, newBooking, newChat] =
        await prisma.$transaction(async (tx) => {
          // Step 1: Find and update the original request
          const rideRequest = await tx.rideRequest.update({
            where: {
              id: requestId,
              status: 'PENDING', // Only accept pending requests
            },
            data: {
              status: 'ACCEPTED',
            },
          });

          // Step 2: Create a new Ride based on the request's details
          const newRide = await tx.ride.create({
            data: {
              // Copy details from the request
              srcDescription: rideRequest.srcDescription,
              srcLat: rideRequest.srcLat,
              srcLng: rideRequest.srcLng,
              dstDescription: rideRequest.dstDescription,
              dstLat: rideRequest.dstLat,
              dstLng: rideRequest.dstLng,
              departureTime: rideRequest.desiredDepartureTime,
              cost: rideRequest.canPayAmount,
              totalSeats: rideRequest.passengerCount,
              seatsAvailable: 0, // The ride is full by this one booking
              status: 'SCHEDULED',

              // Assign the driver and their vehicle
              driverId: driverId,
              vehicleId: vehicleId,
            },
          });

          // Step 3: Create a CONFIRMED booking
          const newBooking = await tx.booking.create({
            data: {
              status: 'CONFIRMED',
              seatsBooked: rideRequest.passengerCount,
              rideId: newRide.id,
              riderId: rideRequest.riderId,
              driverId: driverId,
              rideRequestId: rideRequest.id, // Link to the original request
            },
          });

          // Step 4: Create the Chat
          const newChat = await tx.chat.create({
            data: {
              bookingId: newBooking.id,
              participants: {
                connect: [
                  { id: driverId }, // Connect the driver
                  { id: rideRequest.riderId }, // Connect the rider
                ],
              },
            },
          });

          return [rideRequest, newRide, newBooking, newChat];
        });

      // 6. Respond with the new booking
      res.status(201).json(newBooking);
    } catch (error) {
      // Handle case where request was already accepted (P2025)
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        return res
          .status(404)
          .json({
            error: 'Ride request not found or has already been accepted',
          });
      }
      console.error('Error accepting request:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
