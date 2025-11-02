import express, { Express, Request, Response } from 'express';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { initSocket } from './socket';
import path from 'path';

import authRouter from './routes/auth';
import profileRouter from './routes/profile';
import vehiclesRouter from './routes/vehicles';
import ridesRouter from './routes/rides';
import requestsRouter from './routes/requests';
import bookingsRouter from './routes/bookings';
import chatsRouter from './routes/chats';

// Load environment variables from .env file
dotenv.config();

// Initialize Express app
const app: Express = express();
const port = process.env.PORT || 8000;

// Initialize Prisma Client
export const prisma = new PrismaClient();

// --- Middleware ---
// Tell Express to parse JSON bodies
app.use(express.json());

// --- Routes ---
// A simple test route
app.get('/', (req: Request, res: Response) => {
  res.send('Welcome to the Ride-Share API!');
});

app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// All routes in authRouter will be prefixed with /api/auth
app.use('/api/auth', authRouter);
app.use('/api/profile', profileRouter);
app.use('/api/vehicles', vehiclesRouter);
app.use('/api/rides', ridesRouter);
app.use('/api/requests', requestsRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/chats', chatsRouter);

// Socket.IO setup
// 1. Create the HTTP server
const httpServer = createServer(app);

// 2. Initialize the Socket.IO server
const io = new Server(httpServer, {
  cors: {
    origin: '*', // Allow all origins for simplicity
    // In prod restrict this to the app/website URL
  },
});

// 3. Pass the 'io' server to our socket logic file
initSocket(io);

// --- Server Startup ---
async function main() {
  // We now listen on the httpServer because Socket.IO needs to attach to a
  // standard Node.js http server, not directly to an Express app
  httpServer.listen(port, () => {
    console.log(`[server]: Server is running at http://localhost:${port}`);
  });
}

// Start the server
main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    // Disconnect Prisma on server shutdown
    await prisma.$disconnect();
  });
