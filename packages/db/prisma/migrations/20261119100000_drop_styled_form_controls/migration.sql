-- The guest form always draws its own date, time and phone boxes (v0.8), so the per-event switch is gone and one implementation is kept.
-- Nothing reads the column any more. It held only a display choice of the organiser, no personal data, and 0.8 is not released yet.
-- destructive-approved: the column is dead after this change (the form no longer reads it, the settings route no longer accepts it),
-- so dropping it loses no data an organiser could still use.
ALTER TABLE "EventRegistrationSettings" DROP COLUMN "styled_form_controls";
