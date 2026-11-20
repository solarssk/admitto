-- Where a registration request came from (v0.8). Additive only: nullable columns on "Registration" and one boolean on
-- "EventRegistrationSettings", safe for every reader that does not know them. The four "submitted_*" columns are personal data of the guest
-- and go with the row (erasure inventory). "keep_origin" is true for each event that exists, so a new request keeps its origin until
-- the organiser of the event turns it off; it changes only requests that come after it.

-- AlterTable
ALTER TABLE "Registration" ADD COLUMN     "submitted_country" TEXT,
ADD COLUMN     "submitted_ip" TEXT,
ADD COLUMN     "submitted_region" TEXT,
ADD COLUMN     "submitted_timezone" TEXT;

-- AlterTable
ALTER TABLE "EventRegistrationSettings" ADD COLUMN     "keep_origin" BOOLEAN NOT NULL DEFAULT true;
