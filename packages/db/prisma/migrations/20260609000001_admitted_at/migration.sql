-- Step 3 (ADR 0001): atomic single-use check-in via compare-and-set on admitted_at.
-- NULL = not yet admitted. Set atomically on first VALID check-in; never reset except by explicit admin revert.
-- SQLite supports nullable column addition without table recreation.
ALTER TABLE "Attendee" ADD COLUMN "admitted_at" DATETIME;
ALTER TABLE "Attendee" ADD COLUMN "admitted_by" TEXT;
