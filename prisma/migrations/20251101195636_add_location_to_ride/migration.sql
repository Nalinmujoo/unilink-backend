/*
  Warnings:

  - Added the required column `dstDescription` to the `Ride` table without a default value. This is not possible if the table is not empty.
  - Added the required column `dstLat` to the `Ride` table without a default value. This is not possible if the table is not empty.
  - Added the required column `dstLng` to the `Ride` table without a default value. This is not possible if the table is not empty.
  - Added the required column `seatsAvailable` to the `Ride` table without a default value. This is not possible if the table is not empty.
  - Added the required column `srcDescription` to the `Ride` table without a default value. This is not possible if the table is not empty.
  - Added the required column `srcLat` to the `Ride` table without a default value. This is not possible if the table is not empty.
  - Added the required column `srcLng` to the `Ride` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "RideStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Ride" ADD COLUMN     "dstDescription" TEXT NOT NULL,
ADD COLUMN     "dstLat" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "dstLng" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "seatsAvailable" INTEGER NOT NULL,
ADD COLUMN     "srcDescription" TEXT NOT NULL,
ADD COLUMN     "srcLat" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "srcLng" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "status" "RideStatus" NOT NULL DEFAULT 'SCHEDULED';
