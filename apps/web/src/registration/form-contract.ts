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
 *   {@link RegistrationSubmitErrorKey}, {@link customDataErrorKey} and {@link companionAnswerErrorKey}. A message is
 *   shown as text.
 *   For the answer to a long text, a date, a date and time or a phone number only the key counts: the
 *   page says a sentence of its own for it (the field carries it as `data-invalid`) and ignores the
 *   message, so nothing the server sends for those fields reaches the page.
 * - `403 { error: "access_denied" }`: only for an event whose way in is the password, and only when the password
 *   is wrong, missing or not one. The page goes back to its password screen with its own sentence under the field, keeps
 *   what the guest typed in the form, and asks for the check again. The same answer, byte for byte, whatever the address
 *   of the guest is and whichever way the password is wrong.
 * - `429` or `503`: the page says "Try again in a moment." Any other status gets a general message.
 *
 * The route (./submit-route.ts) also answers with statuses that get the general message: the one 404 of a form that is
 * not open (or that closed while the guest typed), `409 { error: "full" }` for an event that is full and has no waiting
 * list, and `400` or `415` for a body that is not a form this page sends. The page has no sentence of its own for them.
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
   * that a date or time is complete, and no format or rule of a question: the server judges every answer.
   *
   * A question with a condition (`rules.show_when`) is asked only while the answer to the question it names is the
   * one that shows it. The page leaves a question that is not asked out of the object, whatever its box holds (the
   * guest may have typed something before changing the answer that shows it), and it neither checks nor requires
   * it. The server does not depend on that: `buildRegistrantCustomData` does not read the answer to a question
   * whose condition the other answers do not meet, and does not require it, so a body that carries one is not
   * refused and its answer is not stored. The route that answers this body must not rely on the page for it. */
  custom_data?: Record<string, string>;
  /** Always `true`: the page does not send a form whose terms are not accepted. */
  terms: boolean;
  /** Keys (`LegalDocument.key`) of the extra consents the guest ticked. */
  consents: string[];
  /** The guest the registrant brings (D-E5). Only when the event takes one (`max_companions` above 0) and the guest ticked
   * "I am bringing a guest"; left out otherwise. A body that has it for an event that takes none is refused as a body the
   * page did not send (400), the answer to any key the contract does not have, so the answer does not tell a stranger the
   * setting; more of them than the event takes is a 422 under {@link ERROR_KEY_COMPANIONS}. The server judges every piece. */
  companions?: RegistrationSubmitCompanion[];
  /** The Cloudflare Turnstile token. Single use. */
  challenge: string;
  /** The shared password of the event, typed on the page's password screen, for an event whose way in is the password
   * and for no other: an event that is open to the public link ignores it. The page keeps it in a variable of its script
   * from "Continue" to the send and puts it nowhere else (not in an address, a cookie or storage). Absent when the page
   * has no password screen. The server judges it: the page only sees that something was typed. */
  password?: string;
}

/** One companion of the body: the name as typed, trimmed, and the answers to the event's questions about a companion, by the
 * field's `source_field`, in the same form as `custom_data` (a question not answered is not in the object, and the object is
 * left out when there is none). A key that is not a question about a companion that is on the form is ignored, without an error:
 * the guest's own questions, an unknown key, `__proto__`. */
export interface RegistrationSubmitCompanion {
  name: string;
  answers?: Record<string, string>;
}

/** `200` answer. */
export interface RegistrationSubmitOk {
  ok: true;
}

/** `400` or `422` answer. */
export interface RegistrationSubmitInvalid {
  errors: Record<string, string>;
}

/** The `error` of the `403` answer to a wrong password. One code for every reason, and no field: it says nothing about the
 * form, the address or what is wrong with the password. */
export const ACCESS_DENIED_ERROR = "access_denied";

/** `403` answer. */
export interface RegistrationSubmitDenied {
  error: typeof ACCESS_DENIED_ERROR;
}

/** The names of the fixed fields in `errors`. */
export type RegistrationSubmitErrorKey =
  | "first_name"
  | "last_name"
  | "email"
  | "company"
  | "department"
  | "terms"
  | "challenge"
  | "companions"
  | "companion_name";

export const ERROR_KEY_FIRST_NAME: RegistrationSubmitErrorKey = "first_name";
export const ERROR_KEY_LAST_NAME: RegistrationSubmitErrorKey = "last_name";
export const ERROR_KEY_EMAIL: RegistrationSubmitErrorKey = "email";
export const ERROR_KEY_COMPANY: RegistrationSubmitErrorKey = "company";
export const ERROR_KEY_DEPARTMENT: RegistrationSubmitErrorKey = "department";
export const ERROR_KEY_TERMS: RegistrationSubmitErrorKey = "terms";
export const ERROR_KEY_CHALLENGE: RegistrationSubmitErrorKey = "challenge";
/** The row "I am bringing a guest": a refusal of the number of companions, as a whole. */
export const ERROR_KEY_COMPANIONS: RegistrationSubmitErrorKey = "companions";
/** The one name field of the companion. */
export const ERROR_KEY_COMPANION_NAME: RegistrationSubmitErrorKey = "companion_name";

/** The name of a question's error in `errors`. The prefix keeps a question called `terms` or `email`
 * apart from the fixed field of that name. */
export function customDataErrorKey(sourceField: string): string {
  return `custom_data.${sourceField}`;
}

/** The name of the error of a question about the companion. `name`, `email` and the other fixed columns cannot be a question's
 * key (`isReservedCustomDataSourceField`), so no question can take the place of {@link ERROR_KEY_COMPANION_NAME}, and the
 * prefix keeps these apart from the guest's own questions (`custom_data.<key>`), which may have the same key. */
export function companionAnswerErrorKey(sourceField: string): string {
  return `companion_${sourceField}`;
}
