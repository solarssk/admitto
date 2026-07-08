-- AlterTable
ALTER TABLE "EmailDelivery" ALTER COLUMN "status" SET DEFAULT 'queued',
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "EventItem" ADD COLUMN     "description" TEXT;

-- RenameForeignKey
ALTER TABLE "CheckIn" RENAME CONSTRAINT "CheckIn_attendee_event_fkey" TO "CheckIn_attendee_id_event_id_fkey";

-- RenameIndex
ALTER INDEX "OidcGroupRoleMapping_provider_id_group_role_scope_type_scope_id" RENAME TO "OidcGroupRoleMapping_provider_id_group_role_scope_type_scop_key";
