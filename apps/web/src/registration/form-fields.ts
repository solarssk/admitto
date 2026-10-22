/**
 * The fields of the registration form, as HTML.
 *
 * Everything the organiser typed (a question's label, its note, its choices, its suggestions, the title of an extra
 * consent) goes through `esc` and ends up in element text or in a double-quoted attribute, nowhere
 * else: not in an `id`, a selector, a style or a script. The one address built from a name is the
 * form's own (`/r/<slug>`, and the paths of the legal texts), and the model only holds a slug that
 * is lowercase letters, digits, `_` and `-`. Elements the page script needs to find carry fixed
 * `data-*` names; the ids of the organiser's questions are their position (`f-q0`, `f-q1`, ...),
 * never their key. A suggestion is a row of the list (`<li>`) whose text is escaped and whose `data-value`
 * is the same text as an escaped attribute: the script reads it with `getAttribute` and sets it with
 * `textContent`, so the suggestions are data in the page, never code and never built into a script. The
 * condition of a question is two attributes, `data-show-when-field` (the key of the question it names) and
 * `data-show-when-value`; the script compares them as strings and builds no selector from them.
 *
 * Each field that can say something has one message slot under it, which keeps its height whether
 * it shows the field's note or an error, so an error never moves what is next to it. The field is
 * described by its slot (`aria-describedby`), which is how a screen reader hears the error.
 *
 * The questions are drawn by type. {@link QUESTION_RENDERERS} is the one place that knows which
 * types the page can draw: a new type of answer is added there (and to `EVENT_CUSTOM_FIELD_TYPES`).
 *
 * A question can carry an icon (`rules.icon`): a Yes/No row shows it before the text, a one-line field (text,
 * date, date and time, phone) shows it inside the box, as the mockup does. A choice list and a long text have
 * no place for one in the product's controls and draw none.
 *
 * A question with a condition (`rules.show_when`) is not in the main run. It waits, hidden and disabled and
 * without `required`, in a panel (`.reg-reveal`) that follows the question it names, which is a Yes/No or a
 * choice. All the questions that depend on one question share its panel, in the organiser's order. The page script
 * shows each of them when the condition is met (see ./form-script.ts); this module only writes the condition
 * down as data. A question whose controlling question is not on the form is not drawn at all: nothing can ever
 * show it.
 *
 * The format rules of a question (`rules`) are hints here and nothing more: a length, "digits only"
 * and an example are printed in the question's message slot, and "digits only" sets `inputmode` for a
 * numeric keypad. There is no `pattern`, `minlength`, `min` or `max` on any control, because a browser
 * rule would block a send in a way the server does not; the server is the one judge of an answer.
 * A control's `maxlength` is the longest raw text the server looks at, never less.
 */
import type { EventCustomFieldRules, EventCustomFieldType, ShowWhen } from "@admitto/shared";
import {
  REGISTRANT_EMAIL_MAX,
  REGISTRANT_LONG_TEXT_MAX,
  REGISTRANT_NAME_MAX,
  REGISTRANT_TEXT_MAX,
  registrantRawLimit,
} from "@admitto/tickets";
import { esc } from "../ticket-page.js";
import {
  ERROR_KEY_CHALLENGE,
  ERROR_KEY_COMPANY,
  ERROR_KEY_DEPARTMENT,
  ERROR_KEY_EMAIL,
  ERROR_KEY_FIRST_NAME,
  ERROR_KEY_LAST_NAME,
  ERROR_KEY_TERMS,
  customDataErrorKey,
} from "./form-contract.js";
import { checkTick, icon, type GuestIcon } from "./form-icons.js";
import type { FormConsent, FormQuestion, RegistrationFormModel } from "./form-model.js";
import { botChallengeCData } from "./bot-challenge.js";

/** The kinds of answer the page can draw: the types a custom field can have. */
export type FormQuestionType = EventCustomFieldType;

type Attribute = readonly [name: string, value: string | true | undefined];

/** Attributes as markup. A value is escaped; `true` is a bare attribute; `undefined` is left out. */
function attrs(list: readonly Attribute[]): string {
  return list
    .map(([name, value]) => {
      if (value === undefined) return "";
      return value === true ? ` ${name}` : ` ${name}="${esc(value)}"`;
    })
    .join("");
}

const REQUIRED_MARK = '<span class="reg-req" aria-hidden="true">*</span>';

/**
 * The slot under a field: its note (when it has one) and, hidden until the script needs it, the error. A slot with a note
 * keeps the height of that note, so an error that takes its place moves nothing. A slot without one (a name, the
 * company, the terms, the security check) takes no room until it has an error to show: the fields stand one gap apart,
 * as they do in the admin forms, and the error opens under its field, as an inline error does there.
 */
function slot(id: string, note: string | null): string {
  const hint = note ? `<span class="reg-slot__hint">${esc(note)}</span>` : "";
  const kind = note ? "at-hint reg-slot" : "at-hint reg-slot reg-slot--collapsed";
  return `<p class="${kind}" id="m-${id}" data-slot>${hint}<span class="reg-slot__err at-hint--error">${icon("alert")}<span data-msg-text></span></span></p>`;
}

function labelOf(id: string, text: string, required: boolean): string {
  return `<label class="at-label" for="${id}">${esc(text)}${required ? REQUIRED_MARK : ""}</label>`;
}

/** The wrapper every field has: the key of its error, what kind of field it is and what to say when
 * it is empty. The script reads these and nothing else to validate. */
function fieldAttrs(errorKey: string, kind: string, required: boolean, message: string | null, extra: readonly Attribute[] = []): string {
  return attrs([
    ["data-field", errorKey],
    ["data-kind", kind],
    ["data-required", required ? true : undefined],
    ["data-message", message || undefined],
    ...extra,
  ]);
}

/** The `required` and `disabled` of a control. A question under a condition starts disabled and without `required`:
 * while it is not asked, nothing of it is sent and no browser rule can stop the form. The page script turns both on
 * when the condition is met (and `data-required` on its field says it is required then). */
function stateAttrs(required: boolean, showWhen: ShowWhen | null | undefined): Attribute[] {
  return [
    ["required", required && !showWhen ? true : undefined],
    ["disabled", showWhen ? true : undefined],
  ];
}

/** The condition of a question as data on its field, and the field hidden until the script finds it met. `true` is the
 * answer of a Yes/No, written the way the script reads one: "true". */
function conditionAttrs(showWhen: ShowWhen | null | undefined): Attribute[] {
  if (!showWhen) return [];
  return [
    ["data-show-when-field", showWhen.field],
    ["data-show-when-value", showWhen.value === true ? "true" : showWhen.value],
    ["hidden", true],
  ];
}

interface TextFieldSpec {
  id: string;
  errorKey: string;
  kind: "name" | "email" | "text" | "phone" | "date" | "datetime";
  label: string;
  required: boolean;
  /** What to say when the field is required and empty. */
  message: string;
  /** What to say when the answer is not one: a date or time the browser cannot read, or an answer the server refused.
   * Absent: the page shows the message the server sends for the field. Always a text the page wrote itself. */
  invalid?: string;
  note: string | null;
  /** The longest answer in characters, as the server counts them. Absent for a date or a time, whose control has no length. */
  maxLength?: number;
  inputType?: "text" | "email" | "tel" | "date" | "datetime-local";
  /** `numeric` for an answer that is digits only. */
  inputMode?: "numeric";
  autocomplete?: string;
  placeholder?: string;
  leadingIcon?: GuestIcon;
  /** `source_field` of an organiser's question; absent for a fixed field. */
  answerKey?: string;
  /** The condition of an organiser's question; absent for a fixed field and a question that is always asked. */
  showWhen?: ShowWhen | null;
  /** What to offer while the guest types: a list of rows under the box (see {@link renderCombo}). Absent: a plain box. */
  suggestions?: readonly string[];
}

/**
 * The `maxlength` of a text input: the longest raw text the server looks at (`registrantRawLimit`). The browser counts the
 * UTF-16 units of what is typed, while the server counts the characters (code points) of the trimmed, composed text, so a
 * smaller cap would block some answer the server takes (100 emoji, a name with spaces around it). The exact limit is the
 * server's, which answers on the field; the cap only stops a huge paste.
 */
function nativeMaxLength(spec: TextFieldSpec): string | undefined {
  return spec.maxLength === undefined ? undefined : String(registrantRawLimit(spec.maxLength));
}

/** The ARIA 1.2 combobox attributes of a box that has a list of suggestions under it: the box is the combobox, the
 * list its popup. `aria-expanded` is kept up to date by the page script, which also sets `aria-activedescendant`. */
function comboAttrs(id: string, suggestions: readonly string[]): Attribute[] {
  if (suggestions.length === 0) return [];
  return [
    ["role", "combobox"],
    ["aria-autocomplete", "list"],
    ["aria-expanded", "false"],
    ["aria-controls", `${id}-list`],
  ];
}

/**
 * A box with a list of suggestions under it (`rules.suggestions` of a text question), after the product's searchable
 * select. The list is a panel of fixed rows, hidden until the guest focuses the box: one row for each suggestion, a
 * line "Not on the list" and a row that offers what was typed as it is. The page script filters the rows, marks what
 * matches and shows the panel. Any text is welcome, so the box is a plain text box that the list only helps.
 *
 * A suggestion is printed twice, as the text of its row and as the escaped `data-value` the script reads and picks.
 * The ids are positions (`f-q3-opt0`), never text.
 */
function renderCombo(id: string, control: string, suggestions: readonly string[]): string {
  const rows = suggestions
    .map(
      (text, index) =>
        `<li class="searchable-select__option" id="${id}-opt${index}" role="option" aria-selected="false"${attrs([["data-value", text]])}><span class="searchable-select__name">${esc(text)}</span></li>`,
    )
    .join("");
  const empty = '<li class="searchable-select__empty" role="presentation" data-combo-empty hidden>Not on the list. That is fine.</li>';
  const custom = `<li class="searchable-select__option combo__custom" id="${id}-custom" role="option" aria-selected="false" data-combo-custom hidden>${icon("plus")}<span class="searchable-select__name"></span></li>`;
  const list = `<ul class="searchable-select__list" id="${id}-list" role="listbox" aria-label="Suggestions">${rows}${empty}${custom}</ul>`;
  return `<div class="combo" data-combo>${control}<div class="searchable-select__panel combo__panel" data-combo-panel hidden>${list}</div></div>`;
}

function renderTextField(spec: TextFieldSpec): string {
  const suggestions = spec.suggestions ?? [];
  const input = `<input class="at-input" id="${spec.id}" name="${spec.id.slice(2)}"${attrs([
    ["type", spec.inputType ?? "text"],
    ["autocomplete", spec.autocomplete ?? "off"],
    ["maxlength", nativeMaxLength(spec)],
    ["placeholder", spec.placeholder],
    ["inputmode", spec.inputMode ?? (spec.inputType === "email" ? "email" : undefined)],
    ["autocapitalize", spec.inputType === "email" ? "none" : undefined],
    ["spellcheck", spec.inputType === "email" ? "false" : undefined],
    ...stateAttrs(spec.required, spec.showWhen),
    ["aria-describedby", `m-${spec.id}`],
    ...comboAttrs(spec.id, suggestions),
    ["data-control", true],
  ])}>`;
  const box = spec.leadingIcon
    ? `<div class="at-inputgroup">${icon(spec.leadingIcon, "ic at-inputgroup__icon")}${input}</div>`
    : `<div class="at-control">${input}</div>`;
  const control = suggestions.length > 0 ? renderCombo(spec.id, box, suggestions) : box;
  const wrapper = fieldAttrs(spec.errorKey, spec.kind, spec.required, spec.message, [
    ["data-custom", spec.answerKey],
    ["data-invalid", spec.invalid],
    ...conditionAttrs(spec.showWhen),
  ]);
  return `<div class="at-field"${wrapper}>${labelOf(spec.id, spec.label, spec.required)}${control}${slot(spec.id, spec.note)}</div>`;
}

function emailNote(model: RegistrationFormModel): string {
  return model.verifyEmail ? "We send a confirmation link to this address." : "We send our messages to this address.";
}

/** Two fields side by side on a wide screen, one under the other on a phone. */
function pair(first: string, second: string): string {
  return `<div class="reg-row">${first}${second}</div>`;
}

/** First and last name, the email, and the company and department when the event asks for them. */
export function renderPersonalFields(model: RegistrationFormModel): string {
  const name = (id: string, errorKey: string, label: string, message: string, autocomplete: string) =>
    renderTextField({ id, errorKey, kind: "name", label, required: true, message, note: null, maxLength: REGISTRANT_NAME_MAX, autocomplete });
  const profile = (id: string, errorKey: string, label: string, leadingIcon: GuestIcon, autocomplete?: string) =>
    renderTextField({ id, errorKey, kind: "text", label, required: false, message: "", note: null, maxLength: REGISTRANT_TEXT_MAX, leadingIcon, autocomplete });

  const parts = [
    pair(
      name("f-first_name", ERROR_KEY_FIRST_NAME, "First name", "Enter your first name.", "given-name"),
      name("f-last_name", ERROR_KEY_LAST_NAME, "Last name", "Enter your last name.", "family-name"),
    ),
    renderTextField({
      id: "f-email",
      errorKey: ERROR_KEY_EMAIL,
      kind: "email",
      label: "Email",
      required: true,
      message: "Enter a full address, like name@company.com.",
      note: emailNote(model),
      maxLength: REGISTRANT_EMAIL_MAX,
      inputType: "email",
      autocomplete: "email",
      placeholder: "name@company.com",
      leadingIcon: "mail",
    }),
  ];
  const company = model.askCompany ? profile("f-company", ERROR_KEY_COMPANY, "Company", "building", "organization") : "";
  const department = model.askDepartment ? profile("f-department", ERROR_KEY_DEPARTMENT, "Department", "users") : "";
  if (company && department) parts.push(pair(company, department));
  else parts.push(company || department);
  return parts.join("");
}

function questionKeyAttrs(question: FormQuestion, kind: string, message: string | null): string {
  return fieldAttrs(customDataErrorKey(question.key), kind, question.required, message, [
    ["data-custom", question.key],
    ...conditionAttrs(question.showWhen),
  ]);
}

/** What the renderers know besides the question. */
export interface QuestionContext {
  /** The IANA time zone the event's clock times are in. */
  timeZone: string;
  /** The id of the panel that follows this question and holds the questions that depend on its answer. Absent when
   * nothing depends on it. Only a Yes/No or a choice has one, and it names it in `aria-controls`. */
  panelId?: string;
}

type QuestionRenderer = (question: FormQuestion, id: string, context: QuestionContext) => string;

/** "1 digit", "6 digits". */
function countOf(count: number, unit: "digit" | "character"): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** What the length rules and "digits only" ask for, in words ("3 to 6 digits"), or null when they ask for nothing. */
function lengthClause(rules: EventCustomFieldRules): string | null {
  const unit = rules.digits_only ? "digit" : "character";
  const { min_length: min, max_length: max } = rules;
  if (min !== undefined && max !== undefined) return min === max ? `exactly ${countOf(min, unit)}` : `${min} to ${countOf(max, unit)}`;
  if (min !== undefined) return `at least ${countOf(min, unit)}`;
  if (max !== undefined) return `up to ${countOf(max, unit)}`;
  return rules.digits_only ? "digits only" : null;
}

/** The rules of a question as a hint, or null when there is nothing to say. Only a hint: the server decides. */
function rulesHint(rules: EventCustomFieldRules | null): string | null {
  if (!rules) return null;
  const length = lengthClause(rules);
  const parts: string[] = [];
  if (length) parts.push(`${length.charAt(0).toUpperCase()}${length.slice(1)}.`);
  if (rules.example) parts.push(`For example: ${rules.example}`);
  return parts.length > 0 ? parts.join(" ") : null;
}

/** The note under a question: the organiser's own words, then what its rules ask, then anything its type adds. */
function questionNote(question: FormQuestion, ...more: readonly string[]): string | null {
  const lines = [question.description, rulesHint(question.rules), ...more].filter((line): line is string => Boolean(line));
  return lines.length > 0 ? lines.join("\n") : null;
}

/** A numeric keypad for an answer that is digits only. */
function inputModeOf(question: FormQuestion): "numeric" | undefined {
  return question.rules?.digits_only ? "numeric" : undefined;
}

/**
 * What the page says when a long text, a date, a time or a phone number is not accepted: when the browser
 * cannot read a date or time, and when the server refuses the answer. It is the page's own sentence and
 * the server's text for the field is not shown, so nothing a response carries reaches the page. Absent for
 * the other types, which show the message the server sends.
 */
function invalidMessage(question: FormQuestion): string | undefined {
  const clause = question.rules ? lengthClause(question.rules) : null;
  switch (question.type) {
    case "long_text": {
      const limit = clause ?? "up to " + countOf(REGISTRANT_LONG_TEXT_MAX, "character");
      return `Check your answer. Use ${limit}.`;
    }
    case "date":
      return "Enter a valid date.";
    case "datetime":
      return "Enter a valid date and time.";
    case "phone":
      return clause ? `Enter a valid phone number. Use ${clause}.` : "Enter a valid phone number.";
    default:
      return undefined;
  }
}

/** A one-line control for a question: the spec of a fixed field, filled in from the question, with the question's icon
 * inside the box. */
function questionField(question: FormQuestion, id: string, own: Pick<TextFieldSpec, "kind" | "message"> & Partial<TextFieldSpec>): string {
  return renderTextField({
    id,
    errorKey: customDataErrorKey(question.key),
    label: question.label,
    required: question.required,
    note: questionNote(question),
    inputMode: inputModeOf(question),
    answerKey: question.key,
    showWhen: question.showWhen,
    leadingIcon: question.icon ?? undefined,
    ...own,
  });
}

/** A short text. With suggestions it is a box with a list under it that helps and never limits. */
function renderTextQuestion(question: FormQuestion, id: string): string {
  return questionField(question, id, {
    kind: "text",
    message: "Answer this question.",
    maxLength: REGISTRANT_TEXT_MAX,
    suggestions: question.suggestions,
  });
}

/** A long text is a box of several lines. Line breaks are kept; the server counts the characters. */
function renderLongTextQuestion(question: FormQuestion, id: string): string {
  const textarea = `<textarea class="at-textarea" id="${id}" name="${id.slice(2)}"${attrs([
    ["rows", "4"],
    ["maxlength", String(registrantRawLimit(REGISTRANT_LONG_TEXT_MAX))],
    ["inputmode", inputModeOf(question)],
    ...stateAttrs(question.required, question.showWhen),
    ["aria-describedby", `m-${id}`],
    ["data-control", true],
  ])}></textarea>`;
  const wrapper = fieldAttrs(customDataErrorKey(question.key), "longtext", question.required, "Answer this question.", [
    ["data-custom", question.key],
    ["data-invalid", invalidMessage(question)],
    ...conditionAttrs(question.showWhen),
  ]);
  return `<div class="at-field"${wrapper}>${labelOf(id, question.label, question.required)}${textarea}${slot(id, questionNote(question))}</div>`;
}

/** A date is the browser's own date control, which gives `YYYY-MM-DD`. */
function renderDateQuestion(question: FormQuestion, id: string): string {
  return questionField(question, id, { kind: "date", message: "Enter a date.", invalid: invalidMessage(question), inputType: "date" });
}

/** A date and time is the browser's own control, which gives `YYYY-MM-DDTHH:mm` with no zone. The answer is
 * read as the clock of the event, so the note names the event's time zone. */
function renderDateTimeQuestion(question: FormQuestion, id: string, context: QuestionContext): string {
  return questionField(question, id, {
    kind: "datetime",
    message: "Enter a date and time.",
    invalid: invalidMessage(question),
    inputType: "datetime-local",
    note: questionNote(question, `Time in the event's time zone (${context.timeZone}).`),
  });
}

/** A phone number is typed freely; the server accepts spaces, dashes, dots, brackets and a leading + and keeps the digits. */
function renderPhoneQuestion(question: FormQuestion, id: string): string {
  return questionField(question, id, {
    kind: "phone",
    message: "Enter a phone number.",
    invalid: invalidMessage(question),
    maxLength: REGISTRANT_TEXT_MAX,
    inputType: "tel",
  });
}

function option(value: string, text: string): string {
  return `<option${attrs([["value", value]])}>${esc(text)}</option>`;
}

/** What the empty choice says: on the button while nothing is chosen, and as the first row of the panel. */
const NO_CHOICE = "Choose one";

/** Past this many options a choice has a search box in its panel, as the admin's searchable select does. */
const SEARCH_FROM = 6;

/** One answer of a choice: the value that is kept, and the words the guest reads. */
type Choice = readonly [value: string, text: string];

/**
 * A choice, drawn as the admin's searchable select (its classes, so the same CSS): a button that shows the answer and,
 * under it, a panel of rows, with a search box past six of them. The real `<select>` stays in the form, out of sight and
 * hidden from assistive technology: it holds the answer, which the page script reads and a browser restores, and the
 * panel only writes into it. The button is what a guest sees and uses, so the label, the message slot and the focus go
 * to it. A text of the organiser's is printed as the words of its row and as the escaped `data-value` the script picks;
 * the ids are positions, never text.
 */
function renderChoice(question: FormQuestion, id: string, kind: "select" | "choice", choices: readonly Choice[], context: QuestionContext): string {
  const message = kind === "select" ? "Choose one option." : "Choose Yes or No.";
  const native = `<select class="at-select reg-sr" id="${id}" name="${id.slice(2)}"${attrs([
    ...stateAttrs(question.required, question.showWhen),
    ["tabindex", "-1"],
    ["aria-hidden", "true"],
    ["aria-describedby", `m-${id}`],
    ["aria-controls", context.panelId],
    ["data-control", true],
  ])}>${option("", NO_CHOICE)}${choices.map(([value, text]) => option(value, text)).join("")}</select>`;
  const trigger = `<button type="button" class="searchable-select__trigger" id="${id}-trigger"${attrs([
    ["aria-expanded", "false"],
    ["aria-controls", context.panelId ? `${id}-panel ${context.panelId}` : `${id}-panel`],
    ["aria-labelledby", `${id}-label ${id}-text`],
    ["aria-describedby", `m-${id}`],
    ["disabled", question.showWhen ? true : undefined],
    ["data-picker-trigger", true],
  ])}><span class="searchable-select__placeholder" id="${id}-text" data-picker-text>${NO_CHOICE}</span>${icon("chevron-down", "ic searchable-select__chevron")}</button>`;
  const rows = [["", NO_CHOICE] as const, ...choices]
    .map(
      ([value, text], index) =>
        `<li><button type="button" class="searchable-select__option" id="${id}-opt${index}"${attrs([["data-value", value]])}><span class="searchable-select__name">${esc(text)}</span></button></li>`,
    )
    .join("");
  const search =
    choices.length > SEARCH_FROM
      ? '<input type="text" class="searchable-select__search" autocomplete="off" placeholder="Search options…" aria-label="Search options" data-picker-search>'
      : "";
  const empty = '<li class="searchable-select__empty" data-picker-empty hidden>No options found</li>';
  const panel = `<div class="searchable-select__panel picker__panel" id="${id}-panel" data-picker-panel hidden>${search}<ul class="searchable-select__list"${attrs([["aria-label", question.label]])}>${rows}${empty}</ul></div>`;
  const label = `<label class="at-label" id="${id}-label" for="${id}-trigger">${esc(question.label)}${question.required ? REQUIRED_MARK : ""}</label>`;
  return `<div class="at-field"${questionKeyAttrs(question, kind, message)}>${label}<div class="picker" data-picker>${trigger}${native}${panel}</div>${slot(id, question.description)}</div>`;
}

function renderSelectQuestion(question: FormQuestion, id: string, context: QuestionContext): string {
  return renderChoice(question, id, "select", question.options.map((value) => [value, value] as const), context);
}

/** A Yes/No question. Optional, it is one checkbox: ticked is "true", and unticked sends nothing, so a
 * guest who skipped it is not recorded as having said no. Required, the guest must answer, and a
 * checkbox cannot tell "no" from "not answered", so it is a list of Yes and No. */
function renderBooleanQuestion(question: FormQuestion, id: string, context: QuestionContext): string {
  if (question.required) {
    return renderChoice(question, id, "choice", [["true", "Yes"], ["false", "No"]], context);
  }
  const note = question.description ? `<small>${esc(question.description)}</small>` : "";
  // A row with no icon is a plain checkbox and its text, like the terms. `reg-opt--bare` lets a run that has rows with
  // icons keep the text of such a row in line with the others.
  const picture = question.icon ? icon(question.icon) : "";
  const checkbox = `<input type="checkbox" id="${id}" name="${id.slice(2)}"${attrs([
    ...stateAttrs(false, question.showWhen),
    ["aria-controls", context.panelId],
    ["data-control", true],
  ])}>`;
  return `<label class="reg-opt at-check${question.icon ? "" : " reg-opt--bare"}"${questionKeyAttrs(question, "flag", null)}>${checkbox}<span class="at-check__box">${checkTick()}</span>${picture}<span class="reg-opt__text">${esc(question.label)}${note}</span></label>`;
}

/** How to draw each kind of question. A kind that is not here is not drawn (see `canDrawQuestion`). */
const QUESTION_RENDERERS: ReadonlyMap<FormQuestionType, QuestionRenderer> = new Map<FormQuestionType, QuestionRenderer>([
  ["text", renderTextQuestion],
  ["long_text", renderLongTextQuestion],
  ["date", renderDateQuestion],
  ["datetime", renderDateTimeQuestion],
  ["phone", renderPhoneQuestion],
  ["select", renderSelectQuestion],
  ["boolean", renderBooleanQuestion],
]);

/** True for a type of answer the page can draw. The model refuses to open a form that has a required
 * question this says no to. */
export function canDrawQuestion(type: string): type is FormQuestionType {
  return QUESTION_RENDERERS.has(type as FormQuestionType);
}

/** An optional Yes/No question is a row of its own; a run of them is grouped in one block. */
function isOptionRow(question: FormQuestion): boolean {
  return question.type === "boolean" && !question.required;
}

/** True for a question whose answer can show others: a Yes/No or a choice that is itself always asked. A question
 * with a condition of its own is not one, so there is no chain: the server refuses chains, and the page does not
 * rely on that. */
function canControl(question: FormQuestion): boolean {
  return (question.type === "boolean" || question.type === "select") && question.showWhen === null;
}

/** The questions among `questions` that can control others, by key. */
export function controllersByKey(questions: readonly FormQuestion[]): ReadonlyMap<string, FormQuestion> {
  return new Map(questions.filter(canControl).map((question) => [question.key, question]));
}

/** True when a question with this condition has a question to wait for: it has none, or the question it names is one
 * of `controllers`. Otherwise nothing could show it, and the page leaves it out. */
function canBeShown(showWhen: ShowWhen | null | undefined, controllers: ReadonlyMap<string, FormQuestion>): boolean {
  return !showWhen || controllers.has(showWhen.field);
}

/** The answers a Yes/No or a choice can be given on this page, in the form `isQuestionShown` reads them: "true" for a
 * ticked Yes/No, and "false" as well when it is a list of Yes and No (a required one), and the text of an option for a
 * choice. */
function answersOf(question: FormQuestion): readonly string[] {
  if (question.type === "select") return question.options;
  return question.required ? ["true", "false"] : ["true"];
}

/** True when a guest of this page can show a question with this condition: it has none, or the question it names is
 * one of `controllers` and can be given the answer the condition asks for (an option that was removed, or "false" of
 * a tick, cannot be). Stricter than `canBeShown`, which the page uses to place a question, not to judge it. */
export function canBeMet(showWhen: ShowWhen | null | undefined, controllers: ReadonlyMap<string, FormQuestion>): boolean {
  if (!showWhen) return true;
  const controller = controllers.get(showWhen.field);
  return controller !== undefined && answersOf(controller).includes(showWhen.value === true ? "true" : showWhen.value);
}

/** A question and the id of its control. The id is its position in the list, never its key. */
interface Placed {
  question: FormQuestion;
  id: string;
}

/** The questions of the main run, in the organiser's order, and the ones that wait in a panel, by the key of the
 * question they depend on. A question that cannot be shown is in neither. */
function placeQuestions(questions: readonly FormQuestion[]): { main: Placed[]; panels: Map<string, Placed[]> } {
  const controllers = controllersByKey(questions);
  const main: Placed[] = [];
  const panels = new Map<string, Placed[]>();
  questions.forEach((question, index) => {
    const placed = { question, id: `f-q${index}` };
    const condition = question.showWhen;
    if (!condition) main.push(placed);
    else if (canBeShown(condition, controllers)) panels.set(condition.field, [...(panels.get(condition.field) ?? []), placed]);
  });
  return { main, panels };
}

/** The panel that follows a question and holds the questions that depend on it. It is hidden here; the page script
 * shows it while at least one of them is asked. */
function renderReveal(id: string, entries: readonly Placed[], context: QuestionContext): string {
  return `<div class="reg-reveal" id="${id}" data-reveal hidden>${renderGroup(entries, new Map(), context)}</div>`;
}

/** The questions of `entries` in order, a run of optional Yes/No rows in one block, and after each question that has
 * one the panel of the questions that depend on it. A panel is drawn once, under the first question with its key,
 * so that two questions with one key (the page does not rely on a key being unique) cannot repeat its ids. A run in
 * which some row has an icon is marked, so that a row without one can keep its text in line. */
function renderGroup(entries: readonly Placed[], panels: Map<string, Placed[]>, context: QuestionContext): string {
  const parts: string[] = [];
  let run: string[] = [];
  let runHasIcon = false;
  const endRun = () => {
    if (run.length > 0) parts.push(`<div class="${runHasIcon ? "reg-opts reg-opts--icons" : "reg-opts"}">${run.join("")}</div>`);
    run = [];
    runHasIcon = false;
  };
  for (const { question, id } of entries) {
    const draw = QUESTION_RENDERERS.get(question.type);
    if (!draw) continue;
    const waiting = panels.get(question.key);
    panels.delete(question.key);
    const panelId = `${id}-reveal`;
    const html = draw(question, id, { ...context, panelId: waiting ? panelId : undefined }) + (waiting ? renderReveal(panelId, waiting, context) : "");
    if (isOptionRow(question)) {
      run.push(html);
      runHasIcon ||= question.icon !== null;
    } else {
      endRun();
      parts.push(html);
    }
  }
  endRun();
  return parts.join("");
}

/** The "Additional details" section: the organiser's questions, in their order. Empty without questions. */
export function renderQuestions(questions: readonly FormQuestion[], context: QuestionContext): string {
  const { main, panels } = placeQuestions(questions);
  if (main.length === 0) return "";
  return `<div class="reg-section"><p class="reg-section__label">Additional details</p>${renderGroup(main, panels, context)}</div>`;
}

/** A link to a legal text. It opens in a new tab: the form keeps what the guest has typed. */
function legalLink(path: string, text: string): string {
  return `<a href="${esc(path)}" target="_blank" rel="noopener noreferrer">${esc(text)}<span class="reg-sr"> (opens in a new tab)</span></a>`;
}

function renderTermsRow(model: RegistrationFormModel): string {
  const message = "Accept the event terms to continue.";
  return `<div${fieldAttrs(ERROR_KEY_TERMS, "terms", true, message)}><label class="at-check"><input type="checkbox" id="f-terms" name="terms" required aria-describedby="m-f-terms" data-control><span class="at-check__box">${checkTick()}</span><span>I accept the ${legalLink(model.termsPath, "event terms")}${REQUIRED_MARK}</span></label>${slot("f-terms", null)}</div>`;
}

function renderConsentRow(consent: FormConsent, index: number): string {
  const text = `${esc(consent.title)}<small>Optional. ${legalLink(consent.path, "Read what you agree to")}.</small>`;
  return `<label class="at-check"><input type="checkbox" id="f-consent-${index}" name="consent-${index}" data-consent="${esc(consent.key)}"><span class="at-check__box">${checkTick()}</span><span>${text}</span></label>`;
}

/** The Turnstile widget. Cloudflare's script finds the `cf-turnstile` element and draws the widget in
 * it; the callbacks are functions the page script puts on `window`. `data-cdata` binds the answer to
 * this event, and the server refuses a token made for another. */
function renderChallenge(model: RegistrationFormModel): string {
  const widget = `<div class="cf-turnstile"${attrs([
    ["data-sitekey", model.turnstileSiteKey],
    ["data-cdata", botChallengeCData(model.event.slug)],
    ["data-callback", "admittoTurnstileDone"],
    ["data-error-callback", "admittoTurnstileError"],
    ["data-expired-callback", "admittoTurnstileExpired"],
    ["data-theme", "light"],
    ["data-size", "flexible"],
    ["data-response-field", "false"],
  ])}></div>`;
  const wrapper = fieldAttrs(ERROR_KEY_CHALLENGE, "challenge", true, "Complete the security check.");
  return `<div${wrapper}><div class="reg-captcha" tabindex="-1" data-control>${widget}</div>${slot("challenge", null)}</div>`;
}

/** The label of the send button, by who decides (D-B1). */
function submitLabel(mode: RegistrationFormModel["mode"]): string {
  return mode === "approval" ? "Send registration" : "Register";
}

/** "Before you send": the terms, the extra consents, the challenge, the button and the privacy link. */
export function renderAgreement(model: RegistrationFormModel): string {
  const checks = [renderTermsRow(model), ...model.consents.map((consent, index) => renderConsentRow(consent, index))].join("");
  const button = `<button class="at-btn at-btn--primary at-btn--block at-btn--lg" type="submit" id="reg-submit" disabled>${icon("send", "ic reg-btn-icon")}<span id="reg-submit-label">${esc(submitLabel(model.mode))}</span></button>`;
  const fine = `<p class="reg-fine">How we use your details is in the ${legalLink(model.privacyPath, "privacy notice")}.</p>`;
  return `<div class="reg-section"><p class="reg-section__label">Before you send</p><div class="reg-checks">${checks}</div>${renderChallenge(model)}${button}${fine}</div>`;
}
