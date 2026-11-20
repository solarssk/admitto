-- Bot protection per event (v0.8). Additive only: one column on "EventRegistrationSettings", safe for every reader that does not know it.
-- It is true for each event that exists, so every form keeps its check until a superadmin turns it off for the event. It counts only
-- while the organisation's own switch ("registration_bot_protection" in "SystemSettings") is on.

-- AlterTable
ALTER TABLE "EventRegistrationSettings" ADD COLUMN     "bot_protection_enabled" BOOLEAN NOT NULL DEFAULT true;
