-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "timezone" TEXT;

-- AlterTable
ALTER TABLE "SecurityAuditLog" ADD COLUMN     "actor_timezone" TEXT;

-- AlterTable
ALTER TABLE "OidcAuthState" ADD COLUMN     "timezone" TEXT;
