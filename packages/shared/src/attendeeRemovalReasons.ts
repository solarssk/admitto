/**
 * Why an attendee is removed from an event (the hard delete, for mistakes). A fixed list and no
 * free text: a note would be personal data in the audit trail, and the audit trail keeps ids,
 * counts and this code only.
 */
export const ATTENDEE_REMOVAL_REASONS = [
  "duplicate",
  "test_person",
  "wrong_import",
  "added_by_mistake",
  "other",
] as const;

export type AttendeeRemovalReason = (typeof ATTENDEE_REMOVAL_REASONS)[number];

/** What the screens call each reason. */
export const ATTENDEE_REMOVAL_REASON_LABELS: Record<AttendeeRemovalReason, string> = {
  duplicate: "Duplicate entry",
  test_person: "Test person",
  wrong_import: "Wrong import file",
  added_by_mistake: "Added by mistake",
  other: "Other",
};
