/**
 * What the registration page (`GET /r/:slug`) and its submit route (`POST /r/:slug`, PR 95c) agree on.
 *
 * The page script sends one JSON body and reads one of three answers. The route that answers it
 * imports these names, so the page and the route cannot disagree about a field. This is the contract
 * of the page's own script, not an API for other clients: nothing promises that it stays as it is.
 *
 * Request: `Content-Type: application/json`, at most {@link MAX_REGISTRATION_BODY_BYTES} bytes
 * (see ./submit-guards.ts), sent with `fetch` from the same origin.
 *
 * Answers:
 * - `200 { ok: true }`: the page shows "Check your inbox". The same answer for a new address, an
 *   address that already registered and an address of an attendee, so a stranger learns nothing
 *   about who is on the list.
 * - `400` or `422` with `{ errors: { <field>: <message> } }`: the page shows each message under its
 *   field, focuses the first one and keeps what the guest typed. The fields are named by
 *   {@link RegistrationSubmitErrorKey} and {@link customDataErrorKey}. A message is shown as text.
 *   For the answer to a long text, a date, a date and time or a phone number only the key counts: the
 *   page says a sentence of its own for it (the field carries it as `data-invalid`) and ignores the
 *   message, so nothing the server sends for those fields reaches the page.
 * - `429` or `503`: the page says "Try again in a moment." Any other status gets a general message.
 */

/** The body of the submit request. Optional keys are left out when the guest gave no value. */
export interface RegistrationSubmitBody {
  first_name: string;
  last_name: string;
  email: string;
  /** Only when the event asks for it (`ask_company`). */
  company?: string;
  /** Only when the event asks for it (`ask_department`). */
  department?: string;
  /** Answers to the questions on the form, by the field's `source_field`. Every value is a string,
   * trimmed at both ends: `"true"` for a ticked Yes/No question; a long text with its line breaks as
   * `\n`; a date as `YYYY-MM-DD`; a date and time as `YYYY-MM-DDTHH:mm`, a clock time with no zone that
   * the server reads in the event's time zone; a phone number as the guest typed it (the server keeps
   * an optional `+` and the digits). A question the guest did not answer is not in the object, and the
   * object is left out when there is none. The page checks that a required question has an answer and
   * that a date or time is complete, and no format or rule of a question: the server judges every answer. */
  custom_data?: Record<string, string>;
  /** Always `true`: the page does not send a form whose terms are not accepted. */
  terms: boolean;
  /** Keys (`LegalDocument.key`) of the extra consents the guest ticked. */
  consents: string[];
  /** The Cloudflare Turnstile token. Single use. */
  challenge: string;
}

/** `200` answer. */
export interface RegistrationSubmitOk {
  ok: true;
}

/** `400` or `422` answer. */
export interface RegistrationSubmitInvalid {
  errors: Record<string, string>;
}

/** The names of the fixed fields in `errors`. */
export type RegistrationSubmitErrorKey =
  | "first_name"
  | "last_name"
  | "email"
  | "company"
  | "department"
  | "terms"
  | "challenge";

export const ERROR_KEY_FIRST_NAME: RegistrationSubmitErrorKey = "first_name";
export const ERROR_KEY_LAST_NAME: RegistrationSubmitErrorKey = "last_name";
export const ERROR_KEY_EMAIL: RegistrationSubmitErrorKey = "email";
export const ERROR_KEY_COMPANY: RegistrationSubmitErrorKey = "company";
export const ERROR_KEY_DEPARTMENT: RegistrationSubmitErrorKey = "department";
export const ERROR_KEY_TERMS: RegistrationSubmitErrorKey = "terms";
export const ERROR_KEY_CHALLENGE: RegistrationSubmitErrorKey = "challenge";

/** The name of a question's error in `errors`. The prefix keeps a question called `terms` or `email`
 * apart from the fixed field of that name. */
export function customDataErrorKey(sourceField: string): string {
  return `custom_data.${sourceField}`;
}
