-- DropForeignKey
ALTER TABLE "public"."AuthVerification" DROP CONSTRAINT "AuthVerification_userId_fkey";

-- AddForeignKey
ALTER TABLE "AuthVerification" ADD CONSTRAINT "AuthVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
