import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from './index';

// This is the shape of the user object we'll attach to the socket
interface SocketUser {
  id: string;
  email: string;
  role: string;
}

// Augment the Socket type to include our user data
interface AuthSocket extends Socket {
  data: {
    user?: SocketUser;
  };
}

/**
 * Initializes the Socket.IO server and handles all real-time logic.
 * @param io - The Socket.IO Server instance
 */
export const initSocket = (io: Server) => {
  // Socket.IO Authentication Middleware
  // This runs ONCE when a user first connects
  io.use(async (socket: AuthSocket, next) => {
    // Get the token from the client's handshake
    const token = socket.handshake.auth.token;

    if (!token) {
      return next(new Error('Authentication error: No token provided'));
    }

    try {
      // 1. Verify the JWT
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as SocketUser;

      // 2. Find the user in the database (light check)
      const user = await prisma.user.findUnique({
        where: { id: payload.id },
        select: { id: true, email: true, role: true, isVerified: true },
      });

      if (!user || !user.isVerified) {
        return next(
          new Error('Authentication error: User not found or not verified')
        );
      }

      // 3. Attach user data to the socket object
      socket.data.user = {
        id: user.id,
        email: user.email,
        role: user.role,
      };
      next();
    } catch (err) {
      next(new Error('Authentication error: Invalid token'));
    }
  });

  // Main Connection Handler
  // This runs AFTER the middleware for every authenticated socket
  io.on('connection', (socket: AuthSocket) => {
    console.log(
      `[socket]: User connected: ${socket.data.user?.email} (ID: ${socket.id})`
    );

    // Join Chat Room Event
    // The client should emit this when they open a chat screen
    socket.on('join_room', (chatId: string) => {
      console.log(
        `[socket]: User ${socket.data.user?.email} joined room: ${chatId}`
      );
      socket.join(chatId); // Add the socket to the room
    });

    // Leave Chat Room Event
    socket.on('leave_room', (chatId: string) => {
      console.log(
        `[socket]: User ${socket.data.user?.email} left room: ${chatId}`
      );
      socket.leave(chatId); // Remove the socket from the room
    });

    // Send Message Event
    // This matches the logic from app/chat/[chatId].tsx
    socket.on(
      'send_message',
      async (data: { chatId: string; text: string }) => {
        try {
          const { chatId, text } = data;
          const senderId = socket.data.user!.id;

          // 1. Security Check: Verify user is a participant
          const chat = await prisma.chat.findFirst({
            where: {
              id: chatId,
              participants: { some: { id: senderId } },
            },
          });

          if (!chat) {
            console.warn(
              `[socket]: User ${senderId} tried to send to chat ${chatId} but is not a participant`
            );
            return; // Don't do anything
          }

          // 2. Create the message in the database
          const newMessage = await prisma.message.create({
            data: {
              text,
              chatId,
              senderId,
            },
            include: {
              sender: {
                select: { id: true, name: true },
              },
            },
          });

          // 3. Format the message for GiftedChat
          const formattedMessage = {
            _id: newMessage.id,
            text: newMessage.text,
            createdAt: newMessage.createdAt,
            user: {
              _id: newMessage.sender.id,
              name: newMessage.sender.name || 'User',
            },
          };

          // 4. Emit the new message to everyone in the room
          io.to(chatId).emit('new_message', formattedMessage);
        } catch (error) {
          console.error('[socket]: Error sending message:', error);
        }
      }
    );

    // Disconnect Handler
    socket.on('disconnect', () => {
      console.log(
        `[socket]: User disconnected: ${socket.data.user?.email} (ID: ${socket.id})`
      );
    });
  });
};
