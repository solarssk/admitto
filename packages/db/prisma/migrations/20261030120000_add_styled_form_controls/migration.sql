-- The guest form's boxes in the product's own style (v0.8, D-E9). Additive only: one column on "EventRegistrationSettings",
-- safe for every reader that does not know it. It is false for each event that exists, so a form keeps the browser's own
-- date, time and phone boxes until an organiser switches the event's styled boxes on.

-- AlterTable
ALTER TABLE "EventRegistrationSettings" ADD COLUMN     "styled_form_controls" BOOLEAN NOT NULL DEFAULT false;
