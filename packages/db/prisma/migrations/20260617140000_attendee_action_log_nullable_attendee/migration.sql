-- Allow event-scoped bulk audit entries (e.g. attendees_imported) without a single attendee_id.
ALTER TABLE "AttendeeActionLog" ALTER COLUMN "attendee_id" DROP NOT NULL;
