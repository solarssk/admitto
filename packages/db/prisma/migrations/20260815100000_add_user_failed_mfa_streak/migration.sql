-- AlterTable
ALTER TABLE "User" ADD COLUMN     "failed_mfa_streak" INTEGER NOT NULL DEFAULT 0;
