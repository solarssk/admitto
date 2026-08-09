-- Records when an admin dismisses the Communication bounce notifier for an attendee.
ALTER TABLE "Attendee" ADD COLUMN "email_bounce_dismissed_at" TIMESTAMP(3);
