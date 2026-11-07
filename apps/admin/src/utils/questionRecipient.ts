/** Whose answer a question asks for, as far as these helpers read it: a registry field, or the field of a check of conditions
 * (`ConditionField`), which may carry `null`. */
type HasRecipient = { applies_to?: string | null };

/** A question about the person the guest brings rather than the guest (`applies_to`). Absent reads as the guest's, as it does on the
 * server, so a fixture or an older answer without the key is a question about the guest. */
export function isCompanionQuestion(field: HasRecipient): boolean {
  return field.applies_to === "companion";
}

/** The questions about the guest themselves: the ones an attendee's own form, import, list and wallet pass are made of. A question
 * about a companion is answered into the companion's row, which none of them reads, and a form that asked it would send an answer the
 * server refuses. */
export function guestQuestions<T extends HasRecipient>(fields: readonly T[]): T[] {
  return fields.filter((field) => !isCompanionQuestion(field));
}

/** The questions about the person the guest brings. */
export function companionQuestions<T extends HasRecipient>(fields: readonly T[]): T[] {
  return fields.filter(isCompanionQuestion);
}
