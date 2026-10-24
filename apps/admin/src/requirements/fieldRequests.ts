import type { EventCustomFieldRules, EventCustomFieldType } from "@admitto/shared";
import type { CreateEventCustomFieldBody, EventCustomFieldDto, UpdateEventCustomFieldPatch } from "../api/types.js";
import { sameAllRules } from "./fieldRules.js";

/** What the field editor saves: the values of the form as the server takes them. */
export interface FieldSave {
  type: EventCustomFieldType;
  label: string;
  /** Trimmed; empty for none. */
  description: string;
  required: boolean;
  /** The options of a single choice field, trimmed, with no empty one. */
  options: string[];
  /** All the rules the field has once it is saved, the ones of the form and the ones it has no control for (`rulesToSave`): null for
   * none. A save with rules replaces all the rules of the field, so a rule that is left out here is lost. */
  rules: EventCustomFieldRules | null;
}

/** The save that leaves `field` as it is: what the editor holds for a field it has just opened. */
export function fieldSaveOf(field: EventCustomFieldDto): FieldSave {
  return {
    type: field.type,
    label: field.label,
    description: field.description ?? "",
    required: field.required,
    options: field.type === "select" ? (field.options ?? []) : [],
    rules: field.rules,
  };
}

/** True when two saves leave a field the same, the rules of every kind included. */
export function sameFieldSave(a: FieldSave, b: FieldSave): boolean {
  return (
    a.type === b.type &&
    a.label === b.label &&
    a.description === b.description &&
    a.required === b.required &&
    JSON.stringify(a.options) === JSON.stringify(b.options) &&
    sameAllRules(a.rules, b.rules)
  );
}

/** The body that creates a field. Only what is set is sent: a rule that is not set is no key, and `show_on_form` is left out
 * unless the field is made on the Registration page, so the API's own default (off the form) applies. */
export function createFieldBody(sourceField: string, save: FieldSave, showOnForm: boolean): CreateEventCustomFieldBody {
  return {
    source_field: sourceField,
    label: save.label,
    description: save.description || undefined,
    type: save.type,
    required: save.required,
    options: save.type === "select" ? save.options : undefined,
    ...(save.rules ? { rules: save.rules } : {}),
    ...(showOnForm ? { show_on_form: true } : {}),
  };
}

/** The body that edits a field. The server updates only the keys it receives, so a key that did not change is left out:
 * - `type` only when it changed. The server refuses a single choice type that comes without its options, so an edit of a
 *   choice field that leaves its options alone must not name the type.
 * - `options` only when they changed (or the type moved away from a single choice, which clears them with null): sending
 *   the same list again could rewrite the stored options with a round-trip artifact.
 * - `rules` only when they changed: an object replaces them, null clears them. `save.rules` is what the field keeps (the icon and
 *   the condition of any type, the format rules of a type that takes them, the suggestions of a text field), so a type that no
 *   longer takes format rules or suggestions loses those and nothing else, and the server is never sent rules that do not fit
 *   the type. */
export function updateFieldPatch(field: EventCustomFieldDto, save: FieldSave): UpdateEventCustomFieldPatch {
  const optionsChanged =
    save.type === "select" ? JSON.stringify(save.options) !== JSON.stringify(field.options ?? []) : field.type === "select";
  return {
    label: save.label,
    // null (not undefined) so the server can tell "clear the previous description" apart from "leave it untouched".
    description: save.description || null,
    ...(save.type === field.type ? {} : { type: save.type }),
    required: save.required,
    ...(optionsChanged ? { options: save.type === "select" ? save.options : null } : {}),
    ...(sameAllRules(save.rules, field.rules) ? {} : { rules: save.rules }),
  };
}
