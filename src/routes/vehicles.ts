import express from 'express';
import { prisma } from '../index';
import { authMiddleware, AuthRequest } from '../middleware/auth'; // Import our middleware
import { z } from 'zod';
import { Prisma } from '@prisma/client';

const router = express.Router();

// Validation schema for creating a vehicle
const createVehicleSchema = z.object({
  make: z.string().min(1, 'Make is required'),
  model: z.string().min(1, 'Model is required'),
  licensePlate: z
    .string()
    .min(3, 'License plate is required')
    .max(10, 'License plate is too long'),
  color: z.string().min(1, 'Color is required'),
});

/**
 * POST /api/vehicles
 * Adds a new vehicle for the currently logged-in driver.
 */
router.post('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    // 1. Ensure the user is a DRIVER
    if (req.user?.role !== 'DRIVER') {
      return res
        .status(403)
        .json({ error: 'You must be a driver to add a vehicle' });
    }

    // 2. Validate the request body
    const result = createVehicleSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: result.error.issues[0].message });
    }

    const { make, model, licensePlate, color } = result.data;
    const driverId = req.user.id;

    // 3. Create the new vehicle
    const newVehicle = await prisma.vehicle.create({
      data: {
        make,
        model,
        licensePlate: licensePlate.toUpperCase(), // Standardize license plate
        color,
        driverId: driverId,
      },
    });

    // 4. Send back the new vehicle
    res.status(201).json(newVehicle);
  } catch (error) {
    // Handle specific Prisma error for unique constraint violation (P2002)
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      // The 'target' field tells us which field failed
      if ((error.meta?.target as string[]).includes('licensePlate')) {
        return res
          .status(400)
          .json({ error: 'A vehicle with this license plate already exists' });
      }
    }
    console.error('Error creating vehicle:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/vehicles
 * Gets all vehicles for the currently logged-in user.
 */
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const driverId = req.user!.id;

    // Find all vehicles linked to this driver
    const vehicles = await prisma.vehicle.findMany({
      where: {
        driverId: driverId,
      },
      orderBy: {
        make: 'asc', // Order them alphabetically
      },
    });

    res.status(200).json(vehicles);
  } catch (error) {
    console.error('Error fetching vehicles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;