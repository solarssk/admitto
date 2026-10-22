/**
 * The fields of the registration form, as HTML.
 *
 * Everything the organiser typed (a question's label, its note, its choices, the title of an extra
 * consent) goes through `esc` and ends up in element text or in a double-quoted attribute, nowhere
 * else: not in an `id`, a selector, a style or a script. The one address built from a name is the
 * form's own (`/r/<slug>`, and the paths of the legal texts), and the model only holds a slug that
 * is lowercase letters, digits, `_` and `-`. Elements the page script needs to find carry fixed
 * `data-*` names; the ids of the organiser's questions are their position (`f-q0`, `f-q1`, ...),
 * never their key.
 *
 * Each field that can say something has one message slot under it, which keeps its height whether
 * it shows the field's note or an error, so an error never moves what is next to it. The field is
 * described by its slot (`aria-describedby`), which is how a screen reader hears the error.
 *
 * The questions are drawn by type. {@link QUESTION_RENDERERS} is the one place that knows which
 * types the page can draw: a new type of answer is added there and in {@link FormQuestionType}.
 */
import { REGISTRANT_EMAIL_MAX, REGISTRANT_NAME_MAX, REGISTRANT_TEXT_MAX } from "@admitto/tickets";
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

/** The kinds of answer the page can draw. */
export type FormQuestionType = "text" | "select" | "boolean";

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

/** The slot under a field: its note (when it has one) and, hidden until the script needs it, the error. */
function slot(id: string, note: string | null): string {
  const hint = note ? `<span class="reg-slot__hint">${esc(note)}</span>` : "";
  return `<p class="at-hint reg-slot" id="m-${id}" data-slot>${hint}<span class="reg-slot__err at-hint--error">${icon("alert")}<span data-msg-text></span></span></p>`;
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

interface TextFieldSpec {
  id: string;
  errorKey: string;
  kind: "name" | "email" | "text";
  label: string;
  required: boolean;
  message: string;
  note: string | null;
  maxLength: number;
  inputType?: "text" | "email";
  autocomplete?: string;
  placeholder?: string;
  leadingIcon?: GuestIcon;
  /** `source_field` of an organiser's question; absent for a fixed field. */
  answerKey?: string;
}

/**
 * The `maxlength` of a text input. The browser counts the UTF-16 units of what is typed, while the server counts the
 * characters (code points) of the trimmed, composed text, so a value equal to the server's limit would stop a valid
 * answer of 100 emoji at 50 and let leading spaces eat the allowance. Twice the limit never blocks a valid answer and
 * still stops a huge paste; the server holds the exact limit. An address keeps its own limit: it is plain ASCII.
 */
function nativeMaxLength(spec: TextFieldSpec): number {
  return spec.kind === "email" ? spec.maxLength : spec.maxLength * 2;
}

function renderTextField(spec: TextFieldSpec): string {
  const input = `<input class="at-input" id="${spec.id}" name="${spec.id.slice(2)}"${attrs([
    ["type", spec.inputType ?? "text"],
    ["autocomplete", spec.autocomplete ?? "off"],
    ["maxlength", String(nativeMaxLength(spec))],
    ["placeholder", spec.placeholder],
    ["inputmode", spec.inputType === "email" ? "email" : undefined],
    ["autocapitalize", spec.inputType === "email" ? "none" : undefined],
    ["spellcheck", spec.inputType === "email" ? "false" : undefined],
    ["required", spec.required ? true : undefined],
    ["aria-describedby", `m-${spec.id}`],
    ["data-control", true],
  ])}>`;
  const control = spec.leadingIcon
    ? `<div class="at-inputgroup">${icon(spec.leadingIcon, "ic at-inputgroup__icon")}${input}</div>`
    : `<div class="at-control">${input}</div>`;
  const wrapper = fieldAttrs(spec.errorKey, spec.kind, spec.required, spec.message, [["data-custom", spec.answerKey]]);
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
  return fieldAttrs(customDataErrorKey(question.key), kind, question.required, message, [["data-custom", question.key]]);
}

function renderTextQuestion(question: FormQuestion, id: string): string {
  return renderTextField({
    id,
    errorKey: customDataErrorKey(question.key),
    kind: "text",
    label: question.label,
    required: question.required,
    message: "Answer this question.",
    note: question.description,
    maxLength: REGISTRANT_TEXT_MAX,
    answerKey: question.key,
  });
}

function option(value: string, text: string): string {
  return `<option${attrs([["value", value]])}>${esc(text)}</option>`;
}

function renderChoice(question: FormQuestion, id: string, kind: "select" | "choice", options: string): string {
  const message = kind === "select" ? "Choose one option." : "Choose Yes or No.";
  const select = `<select class="at-select" id="${id}" name="${id.slice(2)}"${attrs([
    ["required", question.required ? true : undefined],
    ["aria-describedby", `m-${id}`],
    ["data-control", true],
  ])}>${option("", "Choose one")}${options}</select>`;
  return `<div class="at-field"${questionKeyAttrs(question, kind, message)}>${labelOf(id, question.label, question.required)}<div class="at-control">${select}</div>${slot(id, question.description)}</div>`;
}

function renderSelectQuestion(question: FormQuestion, id: string): string {
  return renderChoice(question, id, "select", question.options.map((value) => option(value, value)).join(""));
}

/** A Yes/No question. Optional, it is one checkbox: ticked is "true", and unticked sends nothing, so a
 * guest who skipped it is not recorded as having said no. Required, the guest must answer, and a
 * checkbox cannot tell "no" from "not answered", so it is a list of Yes and No. */
function renderBooleanQuestion(question: FormQuestion, id: string): string {
  if (question.required) {
    return renderChoice(question, id, "choice", `${option("true", "Yes")}${option("false", "No")}`);
  }
  const note = question.description ? `<small>${esc(question.description)}</small>` : "";
  return `<label class="reg-opt at-check"${questionKeyAttrs(question, "flag", null)}><input type="checkbox" id="${id}" name="${id.slice(2)}" data-control><span class="at-check__box">${checkTick()}</span>${icon("plus")}<span class="reg-opt__text">${esc(question.label)}${note}</span></label>`;
}

/** How to draw each kind of question. A kind that is not here is not drawn (see `canDrawQuestion`). */
const QUESTION_RENDERERS: ReadonlyMap<FormQuestionType, (question: FormQuestion, id: string) => string> = new Map<
  FormQuestionType,
  (question: FormQuestion, id: string) => string
>([
  ["text", renderTextQuestion],
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

/** The "Additional details" section: the organiser's questions, in their order. Empty without questions. */
export function renderQuestions(questions: readonly FormQuestion[]): string {
  if (questions.length === 0) return "";
  const parts: string[] = [];
  let run: string[] = [];
  const endRun = () => {
    if (run.length > 0) parts.push(`<div class="reg-opts">${run.join("")}</div>`);
    run = [];
  };
  questions.forEach((question, index) => {
    const draw = QUESTION_RENDERERS.get(question.type);
    if (!draw) return;
    const html = draw(question, `f-q${index}`);
    if (isOptionRow(question)) {
      run.push(html);
      return;
    }
    endRun();
    parts.push(html);
  });
  endRun();
  return `<div class="reg-section"><p class="reg-section__label">Additional details</p>${parts.join("")}</div>`;
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
