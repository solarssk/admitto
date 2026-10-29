import type { AttendeeCompanionDto } from "../api/types.js";
import { shownCustomFields, validateCustomFieldsForm, type CustomDataFieldDef } from "./customData.js";

/** What the Edit dialog of a guest's companion holds while it is open: the name, and the answers as typed, by the key of the question. */
export interface CompanionFormState {
  name: string;
  answers: Record<string, string>;
}

/** The form of the companion as the page has it: every question about the companion has a box, empty until it is answered. */
export function companionFormFrom(companion: AttendeeCompanionDto, fields: readonly CustomDataFieldDef[]): CompanionFormState {
  const answers: Record<string, string> = {};
  for (const field of fields) answers[field.source_field] = companion.custom_data?.[field.source_field] ?? "";
  return { name: companion.name, answers };
}

/** Whether the form differs from the companion it was made from. An answer typed for a question that a condition now hides is not an
 * edit: it is not saved. */
export function companionFormChanged(form: CompanionFormState, base: CompanionFormState, fields: readonly CustomDataFieldDef[]): boolean {
  return (
    form.name !== base.name ||
    shownCustomFields(fields, form.answers).some((field) => (form.answers[field.source_field] ?? "") !== (base.answers[field.source_field] ?? ""))
  );
}

/** What is wrong with the form before it is sent, in a sentence, or null: the name has to be there, and the answers have to be what
 * the questions take (a required one answered, a choice among its options, a format). The server judges the same again. */
export function companionProblem(form: CompanionFormState, fields: readonly CustomDataFieldDef[]): string | null {
  if (form.name.trim() === "") return "Enter the companion's name.";
  return validateCustomFieldsForm([...fields], form.answers);
}

/**
 * The body of the save: the whole companion, as the server takes it (`PATCH .../companion` replaces the name and the answers).
 * Only the questions that are asked are sent, and only those that are answered: an empty answer is a question left out, which clears
 * it, and what is typed for a question that a condition hides is not sent.
 */
export function companionBody(form: CompanionFormState, fields: readonly CustomDataFieldDef[]): { name: string; custom_data: Record<string, string> } {
  const custom_data: Record<string, string> = {};
  for (const field of shownCustomFields(fields, form.answers)) {
    const answer = (form.answers[field.source_field] ?? "").trim();
    if (answer !== "") custom_data[field.source_field] = answer;
  }
  return { name: form.name.trim(), custom_data };
}
