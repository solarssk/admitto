import type { EventCustomFieldRules, ShowWhen } from "@admitto/shared";

/** A custom field as the checks of its conditions see it: what a condition depends on, and nothing else. */
export type ConditionField = {
  source_field: string;
  type: string;
  show_on_form: boolean;
  /** The options of a select field. */
  options: readonly string[] | null | undefined;
  rules: EventCustomFieldRules | null | undefined;
};

/** Why a save would break the conditions between the fields of an event: the code the admin API answers with.
 * - `invalid_show_when`: the condition is not one that can be kept. It names the field itself, a field the event
 *   does not have, one that is neither yes/no nor select, one that has a condition of its own, or an answer that field
 *   cannot have; or the field has a condition and other fields depend on it. Together these leave no chain and no cycle.
 * - `show_when_not_on_form`: a question with a condition would be on the form while the question it depends on
 *   is not, so a guest could never trigger it. This is checked both ways, for the dependent and for the one it depends on.
 * - `field_controls_others`: the change would leave other fields with a condition that no longer holds: the field
 *   they depend on is deleted, is no longer yes/no or select, or has lost the option they name. */
export type ShowWhenProblem = "invalid_show_when" | "show_when_not_on_form" | "field_controls_others";

/** True when `condition` names an answer that `controller` can have: `true` for a yes/no field, one of the
 * options for a select field, and nothing for any other type. */
function acceptsCondition(controller: ConditionField, condition: ShowWhen): boolean {
  if (controller.type === "boolean") return condition.value === true;
  if (controller.type === "select") {
    return typeof condition.value === "string" && (controller.options ?? []).includes(condition.value);
  }
  return false;
}

/** The fields of `fields`, other than the field `sourceField` itself, whose condition depends on it. */
function dependentsOf(sourceField: string, fields: readonly ConditionField[]): ConditionField[] {
  return fields.filter((field) => field.source_field !== sourceField && field.rules?.show_when?.field === sourceField);
}

/** True when another field of `fields` is shown only for an answer to the field `sourceField`. Such a field can be
 * neither deleted nor changed so that the answer is no longer possible. */
export function controlsOtherFields(sourceField: string, fields: readonly ConditionField[]): boolean {
  return dependentsOf(sourceField, fields).length > 0;
}

function ownConditionProblem(field: ConditionField, others: readonly ConditionField[]): ShowWhenProblem | null {
  const condition = field.rules?.show_when;
  if (!condition) return null;
  const controller = others.find((other) => other.source_field === condition.field);
  if (!controller) return "invalid_show_when";
  if (!acceptsCondition(controller, condition) || controller.rules?.show_when) return "invalid_show_when";
  // Another field that depends on this one would make a chain of two conditions.
  if (controlsOtherFields(field.source_field, others)) return "invalid_show_when";
  return field.show_on_form && !controller.show_on_form ? "show_when_not_on_form" : null;
}

function dependentsProblem(field: ConditionField, others: readonly ConditionField[]): ShowWhenProblem | null {
  for (const dependent of dependentsOf(field.source_field, others)) {
    const condition = dependent.rules?.show_when;
    if (condition && !acceptsCondition(field, condition)) return "field_controls_others";
    if (dependent.show_on_form && !field.show_on_form) return "show_when_not_on_form";
  }
  return null;
}

/** What is wrong with saving `field`, as it will be once saved, in an event whose fields are `fields`, or null when
 * its conditions all hold. `fields` are the event's fields as they are now: the one being saved may be among them
 * in its old form, and is left out. Pure: the caller loads them after it has taken the lock on the event's fields,
 * so no second save changes them in between.
 *
 * Two things are checked. The condition of the field itself (it names another field of the event, one that is a
 * yes/no or select field, has no condition of its own and has the named answer; no other field depends on this
 * one; and the field is on the form only when the one it depends on is). And the condition of every field that
 * depends on this one (this field is still yes/no or select, still has the option, and has not left the form). */
export function findShowWhenProblem(field: ConditionField, fields: readonly ConditionField[]): ShowWhenProblem | null {
  const others = fields.filter((other) => other.source_field !== field.source_field);
  return ownConditionProblem(field, others) ?? dependentsProblem(field, others);
}
