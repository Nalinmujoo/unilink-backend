import express, { Express, Request, Response } from 'express';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import authRouter from './routes/auth';
import profileRouter from './routes/profile';
import vehiclesRouter from './routes/vehicles';
import ridesRouter from './routes/rides';
import requestsRouter from './routes/requests';

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

// All routes in authRouter will be prefixed with /api/auth
app.use('/api/auth', authRouter);
app.use('/api/profile', profileRouter);
app.use('/api/vehicles', vehiclesRouter);
app.use('/api/rides', ridesRouter);
app.use('/api/requests', requestsRouter);

// --- Server Startup ---
async function main() {
  // You can add any async startup logic here
  // (e.g., connecting to other services)

  app.listen(port, () => {
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