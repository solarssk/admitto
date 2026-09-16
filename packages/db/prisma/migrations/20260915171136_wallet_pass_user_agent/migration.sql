-- AlterTable
ALTER TABLE "WalletPass" ADD COLUMN     "user_agent" TEXT,
ADD COLUMN     "user_agent_captured_at" TIMESTAMP(3);
