-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "RideRequest" (
    "id" TEXT NOT NULL,
    "desiredDepartureTime" TIMESTAMP(3) NOT NULL,
    "canPayAmount" DECIMAL(65,30) NOT NULL,
    "passengerCount" INTEGER NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "srcDescription" TEXT NOT NULL,
    "srcLat" DOUBLE PRECISION NOT NULL,
    "srcLng" DOUBLE PRECISION NOT NULL,
    "dstDescription" TEXT NOT NULL,
    "dstLat" DOUBLE PRECISION NOT NULL,
    "dstLng" DOUBLE PRECISION NOT NULL,
    "riderId" TEXT NOT NULL,

    CONSTRAINT "RideRequest_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "RideRequest" ADD CONSTRAINT "RideRequest_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
