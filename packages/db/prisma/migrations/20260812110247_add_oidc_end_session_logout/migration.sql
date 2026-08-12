-- AlterTable
ALTER TABLE "IdentityProvider" ADD COLUMN     "end_session_endpoint" TEXT;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "oidc_provider_id" TEXT;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_oidc_provider_id_fkey" FOREIGN KEY ("oidc_provider_id") REFERENCES "IdentityProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;
