-- AlterTable
ALTER TABLE "IdentityProvider" ADD COLUMN     "end_session_endpoint" TEXT;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "oidc_provider_id" TEXT;

-- AddForeignKey
-- NOT VALID: a validated constraint requires a full table scan under a lock that blocks writes
-- to Session for its duration - on a busy self-hosted install that's a stall for sign-in/logout
-- traffic mid-deploy, to confirm something already guaranteed (every pre-existing row has this
-- brand new column at NULL, which trivially satisfies the constraint). NOT VALID still enforces
-- it for every write from this point forward; see the same reasoning in
-- 20260714210009_add_attendee_ticket_type_fk/migration.sql.
ALTER TABLE "Session" ADD CONSTRAINT "Session_oidc_provider_id_fkey" FOREIGN KEY ("oidc_provider_id") REFERENCES "IdentityProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
