import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../index'; // Import our Prisma client

// We need to "augment" the Express Request type to have a 'user' property
// This tells TypeScript that 'req.user' is a valid property we're adding.
export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

/**
 * Middleware to authenticate a user with a JWT.
 */
export const authMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // 1. Get the 'authorization' header
    const authHeader = req.headers.authorization;

    // 2. Check if it exists and starts with 'Bearer '
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    // 3. Extract the token
    const token = authHeader.split(' ')[1];

    // 4. Verify the token
    let decodedPayload: any;
    try {
      decodedPayload = jwt.verify(token, process.env.JWT_SECRET!);
    } catch (err) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    // 5. 'decodedPayload' looks like { id, email, role, iat, exp }
    // We'll use the 'id' to find the user in our database.
    const user = await prisma.user.findUnique({
      where: { id: decodedPayload.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isVerified: true,
      },
    });

    // 6. Check if user exists
    if (!user || !user.isVerified) {
      return res.status(401).json({ error: 'Unauthorized: User not found or not verified' });
    }

    // 7. Attach the user object to the request
    req.user = user;

    // 8. Call 'next()' to pass to the next route handler
    next();
  } catch (error) {
    console.error('Error in auth middleware:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};