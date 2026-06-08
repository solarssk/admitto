-- Add optional profile fields to Attendee for attendee import (ticket_type, company, department).
ALTER TABLE "Attendee" ADD COLUMN "ticket_type" TEXT;
ALTER TABLE "Attendee" ADD COLUMN "company" TEXT;
ALTER TABLE "Attendee" ADD COLUMN "department" TEXT;
