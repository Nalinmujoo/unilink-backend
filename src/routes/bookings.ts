import express from 'express';
import { prisma } from '../index';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { z } from 'zod';
import { BookingStatus, Prisma, UserRole } from '@prisma/client';

const router = express.Router();

const getBookingsSchema = z.object({
  as: z.nativeEnum(UserRole), // Need to specify 'as' a DRIVER or RIDER
});

/**
 * GET /api/bookings
 * Gets all bookings for the current user, either as a rider or driver.
 * Query Param: ?as=RIDER or ?as=DRIVER
 */
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    // 1. Validate the query param
    const result = getBookingsSchema.safeParse(req.query);
    if (!result.success) {
      return res
        .status(400)
        .json({ error: 'You must specify "?as=RIDER" or "?as=DRIVER"' });
    }

    const { as } = result.data;
    const userId = req.user!.id;

    let whereClause: Prisma.BookingWhereInput;

    // 2. Build the WHERE clause based on the role
    if (as === 'RIDER') {
      whereClause = { riderId: userId };
    } else {
      // as === 'DRIVER'
      whereClause = { driverId: userId };
    }

    // 3. Find all bookings matching the role
    const bookings = await prisma.booking.findMany({
      where: whereClause,
      include: {
        ride: {
          include: {
            driver: { select: { name: true } },
            vehicle: true,
          },
        },
        rider: {
          select: { name: true, profileImageUrl: true },
        },
      },
      orderBy: {
        ride: { departureTime: 'desc' }, // Show newest trips first
      },
    });

    res.status(200).json(bookings);
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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

/**
 * POST /api/bookings/:bookingId/cancel
 * Cancels a booking (Rider or Driver action).
 * Handles logic for both standard bookings and accepted requests.
 */
router.post(
  '/:bookingId/cancel',
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.id;
      const { bookingId } = req.params;

      // 1. Find the booking and verify the user is part of it
      const booking = await prisma.booking.findFirst({
        where: {
          id: bookingId,
          OR: [
            { riderId: userId }, // User is the rider
            { driverId: userId }, // User is the driver
          ],
          // We can cancel PENDING or CONFIRMED bookings
          status: { in: ['PENDING', 'CONFIRMED'] },
        },
      });

      if (!booking) {
        return res.status(404).json({
          error: 'Booking not found or you do not have permission to cancel it',
        });
      }

      // 2. Check which scenario we are in
      if (booking.rideRequestId === null) {
        // // SCENARIO 1: Standard Booking
        // (Rider booked a seat on a driver's posted ride)

        await prisma.$transaction(async (tx) => {
          // Update booking to CANCELLED
          await tx.booking.update({
            where: { id: booking.id },
            data: { status: 'CANCELLED' },
          });

          // If the booking was confirmed, add the seats back to the ride
          if (booking.status === 'CONFIRMED') {
            await tx.ride.update({
              where: { id: booking.rideId },
              data: {
                seatsAvailable: {
                  increment: booking.seatsBooked,
                },
              },
            });
          }
        });
      } else {
        // // SCENARIO 2: Accepted Request Booking
        // (Driver accepted a rider's request)

        await prisma.$transaction(async (tx) => {
          // Update booking to CANCELLED
          await tx.booking.update({
            where: { id: booking.id },
            data: { status: 'CANCELLED' },
          });

          // Update the auto-created Ride to CANCELLED
          await tx.ride.update({
            where: { id: booking.rideId },
            data: { status: 'CANCELLED' },
          });

          // Re-open the original RideRequest by setting it back to PENDING
          await tx.rideRequest.update({
            where: { id: booking.rideRequestId! }, // We know this is not null
            data: { status: 'PENDING' },
          });
        });
      }

      // 3. Respond with success
      res.status(200).json({ message: 'Booking successfully cancelled' });
    } catch (error) {
      console.error('Error cancelling booking:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
