import express from 'express';
import { prisma } from '../index';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = express.Router();

/**
 * GET /api/chats
 * Gets all of the current user's chat conversations.
 *
 */
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    // Find all chats where the user is a participant
    const chats = await prisma.chat.findMany({
      where: {
        participants: {
          some: { id: userId },
        },
      },
      orderBy: {
        updatedAt: 'desc', // Order by the most recent message
      },
      include: {
        // Include the *other* participant's details
        participants: {
          where: {
            id: { not: userId }, // Exclude the current user
          },
          select: {
            id: true,
            name: true,
            // profileImageUrl: true, // We will add this field later
          },
        },
        // Include only the *last* message sent
        messages: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
      },
    });

    // Format the data to match what the app needs
    const formattedChats = chats.map((chat) => {
      const otherUser = chat.participants[0];
      const lastMessage = chat.messages[0];

      return {
        id: chat.id,
        otherUserName: otherUser?.name || 'Deleted User',
        otherUserAvatar: null, // Placeholder for now
        lastMessage: lastMessage?.text || 'No messages yet.',
        lastMessageTime: lastMessage?.createdAt || chat.createdAt,
        unreadCount: 0, // We will implement this later
      };
    });

    res.status(200).json(formattedChats);
  } catch (error) {
    console.error('Error fetching chats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
