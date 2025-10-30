import express from 'express';
import { prisma } from '../index';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { sendVerificationEmail } from '../utils/mailService'; // Import our mailer

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

export default router;