import { acceptsCondition, dependentsOf, findShowWhenProblem, type ConditionField, type ShowWhen } from "@admitto/shared";
import type { EventCustomFieldDto } from "../api/types.js";
import { disambiguatedLabel, findDuplicateLabels } from "./duplicateLabels.js";

/** What is wrong with saving a field, as far as the other fields of the event go: the question a condition depends on, and the questions
 * that depend on this one. The checks are the server's own (`findShowWhenProblem` of `@admitto/shared`), so a save that the editor
 * lets through is not refused with a 422 or a 409, and one that it holds back would have been. */
export type FieldDependencyProblem =
  /** Other fields are shown for an answer that this field would no longer have: its type changes, or an option they name goes. */
  | { kind: "controls_others"; dependents: readonly EventCustomFieldDto[] }
  /** The field is on the registration form, and the question its condition depends on is not. */
  | { kind: "controller_not_on_form"; controller: EventCustomFieldDto }
  /** Any other condition that cannot be kept; the editor offers only choices that can, so this is the safety net. */
  | { kind: "condition_cannot_be_kept" };

/** The name a field goes by in a sentence: its label, and its key when another field of the event has the same label. */
export function fieldNameIn(field: Pick<EventCustomFieldDto, "label" | "source_field">, fields: readonly EventCustomFieldDto[]): string {
  return disambiguatedLabel(field.label, field.source_field, findDuplicateLabels(fields.map((other) => other.label)));
}

/** The fields that another field can depend on: a yes/no or a single choice question of the event that has no condition of its own,
 * and is not the field itself. (A condition on a question that has one would make a chain.) */
export function conditionCandidates(fields: readonly EventCustomFieldDto[], sourceField: string): EventCustomFieldDto[] {
  return fields.filter(
    (field) => field.source_field !== sourceField && (field.type === "boolean" || field.type === "select") && !field.rules?.show_when,
  );
}

/** The fields of the event that are shown only for an answer to this one. */
export function dependentsIn(fields: readonly EventCustomFieldDto[], sourceField: string): EventCustomFieldDto[] {
  return dependentsOf(sourceField, fields);
}

/** What the answer of a condition is called: Yes for a yes/no question, the text of the option, in quotes, for a choice question. */
export function answerLabel(value: ShowWhen["value"]): string {
  return value === true ? "Yes" : `“${value}”`;
}

/** What the server would say about saving `saved` in an event whose fields are `fields` (the field may be among them in its old form), in
 * a form that says which fields it is about; null when nothing is wrong. */
export function dependencyProblem(saved: ConditionField, fields: readonly EventCustomFieldDto[]): FieldDependencyProblem | null {
  const problem = findShowWhenProblem(saved, fields);
  if (problem === null) return null;
  if (problem === "field_controls_others") {
    const dependents = dependentsOf(saved.source_field, fields).filter(
      (field) => field.rules?.show_when !== undefined && !acceptsCondition(saved, field.rules.show_when),
    );
    return { kind: "controls_others", dependents };
  }
  const controller = fields.find((field) => field.source_field === saved.rules?.show_when?.field);
  if (problem === "show_when_not_on_form" && controller && saved.show_on_form && !controller.show_on_form) {
    return { kind: "controller_not_on_form", controller };
  }
  return { kind: "condition_cannot_be_kept" };
}

/** `A`, `A and B`, `A, B and C`. */
function joinWithAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

const quoted = (name: string): string => `“${name}”`;

/** The fields that wait for an answer to this one, each with the answer it waits for: `“Plate” (for Yes)`. */
function dependentsWithAnswers(dependents: readonly EventCustomFieldDto[], fields: readonly EventCustomFieldDto[]): string {
  return joinWithAnd(
    dependents.map((field) => {
      const answer = field.rules?.show_when ? ` (for ${answerLabel(field.rules.show_when.value)})` : "";
      return `${quoted(fieldNameIn(field, fields))}${answer}`;
    }),
  );
}

/** The sentence for a save that the other fields of the event hold back. */
export function dependencyMessage(problem: FieldDependencyProblem, fields: readonly EventCustomFieldDto[]): string {
  switch (problem.kind) {
    case "controls_others": {
      const many = problem.dependents.length > 1;
      return `${dependentsWithAnswers(problem.dependents, fields)} ${many ? "are" : "is"} shown only for an answer to this field, so this change can't be saved. Remove ${many ? "their conditions" : "its condition"} first, or undo the change.`;
    }
    case "controller_not_on_form": {
      const name = quoted(fieldNameIn(problem.controller, fields));
      return `${name} is not on the registration form. A question with a condition can be on the form only when the question it depends on is too. Put ${name} on the form first, or choose another question.`;
    }
    case "condition_cannot_be_kept":
      return "This condition can't be kept. Choose another question and answer, or remove the condition.";
  }
}

/** Why a field that other fields depend on cannot have a condition itself, in a sentence; empty when none depend on it. */
export function ownConditionBlockedMessage(dependents: readonly EventCustomFieldDto[], fields: readonly EventCustomFieldDto[]): string {
  if (dependents.length === 0) return "";
  const names = joinWithAnd(dependents.map((field) => quoted(fieldNameIn(field, fields))));
  return `${names} ${dependents.length > 1 ? "are" : "is"} shown only for an answer to this field, so it can't have a condition itself.`;
}

/** The sentence for the delete of a field that other fields depend on; empty when none do. */
export function deleteBlockedMessage(field: EventCustomFieldDto, fields: readonly EventCustomFieldDto[]): string {
  const dependents = dependentsIn(fields, field.source_field);
  if (dependents.length === 0) return "";
  const many = dependents.length > 1;
  return `${quoted(fieldNameIn(field, fields))} can't be deleted yet: ${dependentsWithAnswers(dependents, fields)} ${many ? "are" : "is"} shown only for an answer to it. Remove ${many ? "their conditions" : "its condition"} first.`;
}

/** The line under the name of a field that is shown only for an answer to another: "Shown only when “Parking” is Yes". Null for a field
 * that is always asked. The name of a question the event no longer has is its key (a condition that cannot be kept is refused by the
 * server, so this is only a record that was edited by hand). */
export function conditionLine(field: EventCustomFieldDto, fields: readonly EventCustomFieldDto[]): string | null {
  const condition = field.rules?.show_when;
  if (!condition) return null;
  const controller = fields.find((other) => other.source_field === condition.field);
  const name = controller ? fieldNameIn(controller, fields) : condition.field;
  return `Shown only when ${quoted(name)} is ${answerLabel(condition.value)}`;
}
