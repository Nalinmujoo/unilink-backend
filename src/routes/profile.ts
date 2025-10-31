import express from 'express';
import { prisma } from '../index';
import { authMiddleware, AuthRequest } from '../middleware/auth'; // Import our middleware
import { z } from 'zod';
import { UserRole } from '@prisma/client'; // Import the enum

const router = express.Router();

// Define a schema for the PATCH request
const profileUpdateSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').optional(),
  role: z.nativeEnum(UserRole).optional(), // Ensures role is "RIDER" or "DRIVER"
});

/**
 * GET /api/profile
 * Gets the currently logged-in user's profile.
 * This route is protected by authMiddleware.
 */
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  // If we get here, authMiddleware was successful.
  // The user object is attached to req.user
  // We don't need to re-fetch, we can just send req.user
  res.status(200).json(req.user);
});

/**
 * PATCH /api/profile
 * Partially updates the currently logged-in user's profile.
 * This is for changing name, role, etc.
 * This route is also protected by authMiddleware.
 */
router.patch('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    // 1. Validate the incoming data
    const result = profileUpdateSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: result.error.issues[0].message });
    }
    const dataToUpdate = result.data;

    // 2. Get the user's ID from the middleware
    const userId = req.user!.id;

    // 3. Update the user in the database
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: dataToUpdate, // Only updates the fields present in the object
      select: {
        // Select only the non-sensitive fields to send back
        id: true,
        email: true,
        name: true,
        role: true,
        isVerified: true,
      },
    });

    // 4. Send back the updated user object
    res.status(200).json(updatedUser);
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;