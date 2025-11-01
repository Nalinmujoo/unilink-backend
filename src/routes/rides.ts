import express from 'express';
import { prisma } from '../index';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { z } from 'zod';

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
          select: { name: true },
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

/**
 * GET /api/rides
 * Gets all rides. (Later, this will be a complex search)
 */
router.get('/', async (req, res) => {
  try {
    const rides = await prisma.ride.findMany({
      where: {
        status: 'SCHEDULED', // Only find rides that haven't happened
        departureTime: { gte: new Date() }, // Only in the future
      },
      orderBy: {
        departureTime: 'asc', // Show soonest first
      },
      include: {
        driver: {
          select: { name: true },
        },
        vehicle: true,
      },
    });
    res.status(200).json(rides);
  } catch (error) {
    console.error('Error fetching rides:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;