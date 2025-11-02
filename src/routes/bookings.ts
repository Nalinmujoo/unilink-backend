import express from 'express';
import { prisma } from '../index';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { z } from 'zod';
import { BookingStatus } from '@prisma/client';

const router = express.Router();

/**
 * POST /api/bookings/:bookingId/confirm
 * Confirms a pending booking (Driver action).
 * This is a transactional operation:
 * 1. Updates Booking status to CONFIRMED.
 * 2. Decrements the Ride's available seats.
 * 3. Creates a new Chat for the driver and rider.
 */
router.post(
  '/:bookingId/confirm',
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      // 1. Get Driver ID and Booking ID
      const driverId = req.user!.id;
      const { bookingId } = req.params;

      // 2. Find the pending booking
      const booking = await prisma.booking.findUnique({
        where: {
          id: bookingId,
          driverId: driverId, // Ensure this driver owns the booking
          status: 'PENDING', // Only confirm pending bookings
        },
        include: {
          ride: true, // Include the ride to check seat availability
        },
      });

      if (!booking) {
        return res.status(404).json({
          error: 'Pending booking not found or you are not the driver',
        });
      }

      // 3. Check seat availability
      if (booking.ride.seatsAvailable < booking.seatsBooked) {
        // This is a safety check, in case multiple bookings are confirmed at once
        return res.status(400).json({
          error: 'Not enough seats available to confirm this booking',
        });
      }

      // 4. Perform the transaction
      const [confirmedBooking] = await prisma.$transaction([
        // Step 1: Update the Booking status
        prisma.booking.update({
          where: { id: booking.id },
          data: { status: 'CONFIRMED' },
        }),

        // Step 2: Decrement the Ride's available seats
        prisma.ride.update({
          where: { id: booking.rideId },
          data: {
            seatsAvailable: {
              decrement: booking.seatsBooked,
            },
          },
        }),

        // Step 3: Create the Chat
        prisma.chat.create({
          data: {
            bookingId: booking.id,
            participants: {
              connect: [
                { id: driverId }, // Connect the driver
                { id: booking.riderId }, // Connect the rider
              ],
            },
          },
        }),
      ]);

      // 5. Respond with the confirmed booking
      res.status(200).json(confirmedBooking);
    } catch (error) {
      console.error('Error confirming booking:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
