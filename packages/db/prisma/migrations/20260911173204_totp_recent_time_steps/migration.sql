-- AlterTable
ALTER TABLE "UserMfaMethod" ADD COLUMN     "recent_totp_time_steps" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
