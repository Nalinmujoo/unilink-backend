import express from 'express';
import { prisma } from '../index';
import { authMiddleware, AuthRequest } from '../middleware/auth'; // Import our middleware
import { z } from 'zod';
import { UserRole } from '@prisma/client'; // Import the enum
import multer from 'multer';
import path from 'path';
import sharp from 'sharp';

const router = express.Router();

// Configure Multer
// Use memoryStorage to hold the file as a buffer for sharp
const storage = multer.memoryStorage();

// Filter to only accept image files
const fileFilter = (
  req: any,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!') as any, false);
  }
};

// Initialize multer with storage and filter
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB file size limit
});

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

/**
 * POST /api/profile/upload
 * Uploads a new profile picture, processes it, and saves the URL.
 *
 */
router.post(
  '/upload',
  authMiddleware,
  upload.single('profileImage'), // 'profileImage' must match the form-data key
  async (req: AuthRequest, res) => {
    try {
      // 1. Check if file exists
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
      }

      // 2. Define filename and path
      // We'll use the user's ID as the filename and convert to webp
      const filename = `${req.user!.id}.webp`;
      const outputPath = path.join(process.cwd(), 'uploads', filename);

      // 3. Process the image with Sharp
      // This resizes to 500x500 (cropping to fit) and sets quality
      await sharp(req.file.buffer)
        .resize(500, 500, { fit: 'cover' }) // Matches app's aspect: [1, 1]
        .webp({ quality: 80 })
        .toFile(outputPath);

      // 4. Create the public URL
      const publicUrl = `/uploads/${filename}`;

      // 5. Update the user's profileImageUrl in the database
      const updatedUser = await prisma.user.update({
        where: { id: req.user!.id },
        data: {
          profileImageUrl: publicUrl,
        },
        select: {
          // Send back the updated user
          id: true,
          email: true,
          name: true,
          role: true,
          isVerified: true,
          profileImageUrl: true, // Send the new URL
        },
      });

      // 6. Respond with the updated user
      res.status(200).json(updatedUser);
    } catch (error) {
      console.error('Error uploading profile image:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
