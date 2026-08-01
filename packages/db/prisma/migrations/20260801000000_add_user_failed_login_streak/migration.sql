-- AlterTable
ALTER TABLE "User" ADD COLUMN     "failed_login_streak" INTEGER NOT NULL DEFAULT 0;
