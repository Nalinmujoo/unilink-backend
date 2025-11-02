import express from 'express';
import { prisma } from '../index';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

const router = express.Router();

// --- Zod Validation Schemas ---
const locationSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const postRideSchema = z.object({
  src: locationSchema, // Source location
  dst: locationSchema, // Destination location
  departureTime: z.string().datetime(), // ISO 8601 string
  cost: z.number().positive('Cost must be positive'),
  totalSeats: z.number().int().min(1, 'Must offer at least 1 seat'),
  vehicleId: z.string().cuid('Invalid vehicle ID'),
});

/**
 * POST /api/rides
 * Creates a new ride (posted by a driver).
 *
 */
router.post('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    // 1. Ensure the user is a DRIVER
    if (req.user?.role !== 'DRIVER') {
      return res
        .status(403)
        .json({ error: 'You must be a driver to post a ride' });
    }
    const driverId = req.user.id;

    // 2. Validate the request body
    const result = postRideSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: result.error.issues[0].message });
    }
    const { src, dst, departureTime, cost, totalSeats, vehicleId } =
      result.data;

    // 3. Verify the selected vehicle belongs to this driver
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
    });
    if (!vehicle || vehicle.driverId !== driverId) {
      return res.status(403).json({ error: 'This is not your vehicle' });
    }

    // 4. Create the ride
    const newRide = await prisma.ride.create({
      data: {
        departureTime: new Date(departureTime), // Convert string to Date
        cost,
        totalSeats,
        seatsAvailable: totalSeats, // Initially, all seats are available
        srcDescription: src.description,
        srcLat: src.latitude,
        srcLng: src.longitude,
        dstDescription: dst.description,
        dstLat: dst.latitude,
        dstLng: dst.longitude,
        driverId: driverId,
        vehicleId: vehicleId,
      },
      include: {
        // Include the related data in the response
        driver: {
          select: { name: true, driverRating: true },
        },
        vehicle: true,
      },
    });

    res.status(201).json(newRide);
  } catch (error) {
    console.error('Error posting ride:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Schema for validating URL query parameters
const searchQuerySchema = z.object({
  // Location (coerce transforms "43.0" into 43.0)
  from_lat: z.coerce.number().optional(),
  from_lng: z.coerce.number().optional(),
  to_lat: z.coerce.number().optional(),
  to_lng: z.coerce.number().optional(),
  // Date
  date: z.coerce.date().optional(),
  // Filters
  maxPrice: z.coerce.number().positive().optional(),
  minRating: z.coerce.number().min(1).max(5).optional(),
  minSeats: z.coerce.number().int().min(1).optional(),
  // Sort
  sort: z
    .enum(['price', 'earliest', 'rating', 'recommended'])
    .optional()
    .default('recommended'),
});

/**
 * GET /api/rides/search
 * Searches for available rides based on query parameters.
 *
 */
router.get('/search', authMiddleware, async (req: AuthRequest, res) => {
  try {
    // 1. Validate the query parameters
    const result = searchQuerySchema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({ error: result.error.issues[0].message });
    }
    const filters = result.data;

    // 2. Build the dynamic WHERE clause
    const where: Prisma.RideWhereInput = {
      status: 'SCHEDULED', // Always filter for scheduled rides
      departureTime: { gte: new Date() }, // Always filter for future rides
    };

    // Apply filters
    if (filters.minSeats) {
      where.seatsAvailable = { gte: filters.minSeats };
    }
    if (filters.maxPrice) {
      where.cost = { lte: filters.maxPrice };
    }
    if (filters.minRating) {
      where.driver = { driverRating: { gte: filters.minRating } };
    }
    if (filters.date) {
      const startOfDay = new Date(filters.date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(filters.date);
      endOfDay.setHours(23, 59, 59, 999);
      where.departureTime = { gte: startOfDay, lte: endOfDay };
    }

    // Apply simple location filter (Bounding Box)
    // This is a simple, fast "square" search. 0.1 degrees is approx. 6.9 miles
    const proximity = 0.1;
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
    const orderBy: Prisma.RideOrderByWithRelationInput = {};
    switch (filters.sort) {
      case 'price':
        orderBy.cost = 'asc';
        break;
      case 'earliest':
        orderBy.departureTime = 'asc';
        break;
      case 'rating':
        orderBy.driver = { driverRating: 'desc' };
        break;
      default: // 'recommended' or no sort
        orderBy.departureTime = 'asc'; // Default to earliest
    }

    // 4. Execute the final query
    const rides = await prisma.ride.findMany({
      where,
      orderBy,
      include: {
        driver: {
          select: { name: true, driverRating: true },
        },
        vehicle: true,
      },
    });

    res.status(200).json(rides);
  } catch (error) {
    console.error('Error searching rides:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const bookRideSchema = z.object({
  seatsBooked: z.number().int().min(1, 'Must book at least 1 seat'),
});

/**
 * POST /api/rides/:rideId/book
 * A rider requests to book a seat on a specific ride.
 *
 */
router.post('/:rideId/book', authMiddleware, async (req: AuthRequest, res) => {
  try {
    // 1. Get Rider ID from token and Ride ID from URL
    const riderId = req.user!.id;
    const { rideId } = req.params;

    // 2. Validate the request body
    const result = bookRideSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: result.error.issues[0].message });
    }
    const { seatsBooked } = result.data;

    // 3. Find the ride they want to book
    const ride = await prisma.ride.findUnique({
      where: { id: rideId, status: 'SCHEDULED' },
    });

    if (!ride) {
      return res.status(404).json({ error: 'Ride not found or is no longer available' });
    }

    // 4. Check business logic
    if (ride.driverId === riderId) {
      return res.status(400).json({ error: 'You cannot book your own ride' });
    }
    if (ride.seatsAvailable < seatsBooked) {
      return res.status(400).json({ error: 'Not enough seats available' });
    }

    // 5. Create the PENDING booking
    const newBooking = await prisma.booking.create({
      data: {
        seatsBooked,
        status: 'PENDING',
        rideId: ride.id,
        riderId: riderId,
        driverId: ride.driverId, // Store driverId for easy access
      },
    });

    // 6. Respond with the pending booking
    // In the future, we would send a notification to the driver here.
    res.status(201).json(newBooking);

  } catch (error) {
    // Handle potential error if user has already booked this ride (not yet implemented, but good to think about)
    console.error('Error booking ride:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;