import express from 'express';
import { prisma } from '../index';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { sendVerificationEmail } from '../utils/mailService'; // Import our mailer
import jwt from 'jsonwebtoken';

const router = express.Router();

// --- Zod Validation Schemas ---
const signupSchema = z.object({
  email: z
    .email()
    .refine(
      (email) => email.endsWith('.edu'),
      'Email must be a valid .edu address'
    ),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  name: z.string().min(2, 'Name must be at least 2 characters long'),
});

const verifySchema = z.object({
  email: z.email({ message: 'Invalid email address' }),
  otp: z.string().length(6, 'OTP must be 6 digits'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'), // Just check it's not empty
});

// --- Helper: Generate 6-digit OTP ---
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * POST /api/auth/signup
 * Handles new user registration.
 */
router.post('/signup', async (req, res) => {
  try {
    // 1. Validate the request body
    const result = signupSchema.safeParse(req.body);
    if (!result.success) {
      // safeParse doesn't throw, so we check `success`
      return res.status(400).json({ error: result.error.issues[0].message });
    }
    const { email, password, name } = result.data;
    const lowerEmail = email.toLowerCase();

    // 2. Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: lowerEmail },
    });

    if (existingUser) {
      if (existingUser.isVerified) {
        // User exists and is verified. They should log in.
        return res.status(400).json({ error: 'User already exists' });
      } else {
        // User signed up but never verified.
        // We'll delete the old one so they can re-register.
        // The `onDelete: Cascade` in our schema will also delete their old OTP.
        await prisma.user.delete({ where: { email: lowerEmail } });
      }
    }

    // 3. Hash the password
    const hashedPassword = await bcrypt.hash(password, 10); // 10 salt rounds

    // 4. Create the User and their OTP in one transaction
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const newUser = await prisma.user.create({
      data: {
        email: lowerEmail,
        name,
        password: hashedPassword,
        // Create the related AuthVerification record at the same time
        authVerification: {
          create: {
            otp,
            expiresAt,
          },
        },
      },
    });

    // 5. Send the verification email
    try {
      await sendVerificationEmail(lowerEmail, otp);
    } catch (emailError) {
      console.error('Failed to send verification email:', emailError);
      // Even if email fails, the user was created.
      // They can use the "resend" flow later.
      // But we should let the client know something went wrong.
      return res.status(500).json({ error: 'Failed to send verification email' });
    }

    // 6. Respond to the client
    res.status(201).json({
      message: 'Signup successful. Please check your .edu email for an OTP.',
      // We don't send the user or token yet, only after verification.
    });
  } catch (error) {
    console.error('Error during signup:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// We will add /verify and /login here next
/**
 * POST /api/auth/verify
 * Verifies a user's email with an OTP.
 */
router.post('/verify', async (req, res) => {
  try {
    // 1. Validate the request body
    const result = verifySchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: result.error.issues[0].message });
    }
    const { email, otp } = result.data;
    const lowerEmail = email.toLowerCase();

    // 2. Find the unverified user
    const user = await prisma.user.findUnique({
      where: { email: lowerEmail },
      include: { authVerification: true }, // Also get their verification data
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (user.isVerified) {
      return res.status(400).json({ error: 'User is already verified' });
    }
    if (!user.authVerification) {
      return res.status(400).json({ error: 'No OTP found for this user' });
    }

    // 3. Check if OTP is correct and not expired
    const isMatch = user.authVerification.otp === otp;
    const isExpired = new Date() > user.authVerification.expiresAt;

    if (isExpired) {
      return res.status(400).json({ error: 'OTP has expired' });
    }
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    // 4. Success! Update the user and delete the OTP
    // We do this in a transaction so if one fails, both fail.
    const [, updatedUser] = await prisma.$transaction([
      // Delete the OTP first
      prisma.authVerification.delete({
        where: { id: user.authVerification.id },
      }),
      // Then update the user
      prisma.user.update({
        where: { id: user.id },
        data: { isVerified: true },
      }),
    ]);

    // 5. Create a JWT token for the new user
    const token = jwt.sign(
      {
        id: updatedUser.id,
        email: updatedUser.email,
        role: updatedUser.role,
      },
      process.env.JWT_SECRET!,
      {
        expiresIn: '7d',
      }
    );

    // 6. Send back the token and user data
    res.status(200).json({
      token,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
      },
    });
  } catch (error) {
    console.error('Error during verification:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/login
 * Handles login for existing, verified users.
 */
router.post('/login', async (req, res) => {
  try {
    // 1. Validate the request body
    const result = loginSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: result.error.issues[0].message });
    }
    const { email, password } = result.data;
    const lowerEmail = email.toLowerCase();

    // 2. Find the user by email
    const user = await prisma.user.findUnique({
      where: { email: lowerEmail },
    });

    // 3. Check if user exists
    // We use a generic error for security (don't tell them if email or pass was wrong)
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // 4. Check if their email is verified
    if (!user.isVerified) {
      // This is a special case, so it's okay to be specific
      return res.status(403).json({
        error: 'Please verify your email before logging in. (Check for OTP)',
      });
    }

    // 5. Check if password matches
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // 6. Success! Create a JWT token
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET!,
      {
        expiresIn: '7d',
      }
    );

    // 7. Send back the token and user data
    res.status(200).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;