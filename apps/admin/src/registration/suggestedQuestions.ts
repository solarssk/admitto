import {
  MAX_CUSTOM_FIELDS_PER_EVENT,
  SUGGESTED_EVENT_FIELDS,
  type SuggestedEventField,
  type SuggestedFieldsPlan,
} from "@admitto/shared";
import type { EventCustomFieldDto } from "../api/types.js";
import { customFieldTypeLabel } from "../requirements/customFieldType.js";
import { answerLabel } from "../requirements/fieldDependencies.js";
import { pluralSuffix } from "../utils/pluralize.js";

/** What "Add suggested questions" does with one question of the set: add it, leave the one the event has under its key as it is, or
 * leave it out because it cannot be added (see `SuggestedFieldsPlan`). */
export type SuggestedRowState = "add" | "present" | "blocked";

export interface SuggestedRow {
  readonly key: string;
  /** The question a guest reads. */
  readonly label: string;
  readonly state: SuggestedRowState;
  /** What kind of answer it takes, and the question it waits for: "Text. Shown only when “Do you need a parking space?” is Yes". */
  readonly meta: string;
  /** Why a question that cannot be added is not; empty for the others. */
  readonly note: string;
}

const quoted = (name: string): string => `“${name}”`;

/** What a question of the set that depends on another is called in a sentence: the label of the field the event has under that key, and
 * when it has none yet, the label of the suggested question that will be added under it. */
function controllerName(key: string, fields: readonly EventCustomFieldDto[]): string {
  return fields.find((field) => field.source_field === key)?.label ?? SUGGESTED_EVENT_FIELDS.find((suggested) => suggested.source_field === key)?.label ?? key;
}

function metaOf(suggested: SuggestedEventField, fields: readonly EventCustomFieldDto[]): string {
  const kind = customFieldTypeLabel(suggested.type);
  const parts = [suggested.options ? `${kind}: ${suggested.options.join(", ")}` : kind];
  const condition = suggested.rules?.show_when;
  if (condition) parts.push(`Shown only when ${quoted(controllerName(condition.field, fields))} is ${answerLabel(condition.value)}`);
  return parts.join(". ");
}

/** Why a question that depends on another field of the event cannot be added: that field is not what it needs to be. */
function blockedNote(suggested: SuggestedEventField, fields: readonly EventCustomFieldDto[]): string {
  const condition = suggested.rules?.show_when;
  return condition ? `It needs ${quoted(controllerName(condition.field, fields))} to be a Yes / No question on the registration form.` : "";
}

/** What the plan does with the question: every question of the set is in one of its three lists, and a question that is neither to add nor
 * left out is one the event has. */
function stateOf(plan: SuggestedFieldsPlan, key: string): SuggestedRowState {
  if (plan.add.some((suggested) => suggested.source_field === key)) return "add";
  if (plan.blocked.some((suggested) => suggested.source_field === key)) return "blocked";
  return "present";
}

/** The questions of the set in their own order, each with what will happen to it in an event that has these fields. */
export function suggestedRows(plan: SuggestedFieldsPlan, fields: readonly EventCustomFieldDto[]): SuggestedRow[] {
  return SUGGESTED_EVENT_FIELDS.map((suggested) => {
    const state = stateOf(plan, suggested.source_field);
    return {
      key: suggested.source_field,
      label: suggested.label,
      state,
      meta: metaOf(suggested, fields),
      note: state === "blocked" ? blockedNote(suggested, fields) : "",
    };
  });
}

/** What the window says under its title: that the questions can be changed afterwards, or why there is nothing to confirm. */
export function dialogMessage(plan: SuggestedFieldsPlan): string {
  if (plan.add.length > 0) return "These questions go on the registration form. You can change or remove them afterwards.";
  return plan.blocked.length > 0
    ? "None of the suggested questions can be added right now."
    : "Every suggested question is already in your list.";
}

/** The sentence for questions that would take the event over its limit of fields: how many it has, what adding them would make, and how
 * many to delete. Empty when they fit. The server refuses them all in that case, so the window does not offer to try. */
export function limitMessage(plan: SuggestedFieldsPlan, existing: number): string {
  if (plan.overLimitBy === 0) return "";
  const adding = plan.add.length;
  return `This event has ${existing} of ${MAX_CUSTOM_FIELDS_PER_EVENT} fields, and adding ${adding} question${pluralSuffix(adding)} would take it to ${existing + adding}. Delete ${plan.overLimitBy} field${pluralSuffix(plan.overLimitBy)} first, or add the questions you want one at a time with Add field.`;
}

/** The label of the confirm button. */
export function confirmLabel(count: number): string {
  return count > 0 ? `Add ${count} question${pluralSuffix(count)}` : "Add questions";
}

/** What the toast says once the server has answered: how many questions were added (none when another admin had added them already). */
export function addedMessage(count: number): string {
  return count > 0 ? `Added ${count} suggested question${pluralSuffix(count)}.` : "The suggested questions are already in your list.";
}
