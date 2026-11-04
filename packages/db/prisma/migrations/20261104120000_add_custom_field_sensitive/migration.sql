-- Sensitive attendee fields (v0.8, D-E6). Additive only: one column on "EventCustomField", false for every field that
-- exists, so nothing changes for a reader that does not know the column. A sensitive field keeps its answers in
-- custom_data, but the application leaves the value out of lists, filters, exports, reports, passes, mail and logs.

-- AlterTable
ALTER TABLE "EventCustomField" ADD COLUMN     "sensitive" BOOLEAN NOT NULL DEFAULT false;
