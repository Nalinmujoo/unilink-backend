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

export default router;