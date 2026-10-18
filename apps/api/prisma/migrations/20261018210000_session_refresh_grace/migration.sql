-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "previousRefreshTokenHash" CHAR(64),
ADD COLUMN     "rotatedAt" TIMESTAMPTZ(3);

