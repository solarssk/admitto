/**
 * What `POST /r/:slug` makes of the body a guest's browser sent (the contract is ./form-contract.ts): the shape of
 * the whole, then each piece of it, with the one sentence it gets when it is refused.
 *
 * Every refusal is a sentence written here, chosen by the field and the kind of answer, and never a word of the
 * guest's input or of an exception. The input boundary of `@admitto/tickets` (registrant-input.ts) judges the
 * values; a refusal there carries no field key, so this module asks again about one field at a time to learn which
 * one it was. The page shows these sentences as text, except for a long text, a date, a time and a phone number,
 * where it uses a sentence of its own and takes only the key from the answer.
 */
import {
  RegistrantInputError,
  buildRegistrantCustomData,
  pickRegistrantFormFields,
  pickRegistrantProfileFields,
  registrantEmailSchema,
  registrantNameSchema,
  type RegistrantFormField,
  type RegistrantSubmission,
  type RegistrationCompanion,
} from "@admitto/tickets";
import {
  ERROR_KEY_COMPANIONS,
  ERROR_KEY_COMPANION_NAME,
  ERROR_KEY_COMPANY,
  ERROR_KEY_DEPARTMENT,
  ERROR_KEY_EMAIL,
  ERROR_KEY_FIRST_NAME,
  ERROR_KEY_LAST_NAME,
  ERROR_KEY_TERMS,
  companionAnswerErrorKey,
  customDataErrorKey,
  type RegistrationSubmitBody,
  type RegistrationSubmitCompanion,
} from "./form-contract.js";

/** The keys of the body, and no others: a key the page does not send makes the whole body malformed. Naming every
 * key of {@link RegistrationSubmitBody} is checked by the compiler, so a field added to the contract cannot be
 * forgotten here. */
const BODY_KEYS: Readonly<Record<keyof RegistrationSubmitBody, true>> = {
  first_name: true,
  last_name: true,
  email: true,
  company: true,
  department: true,
  custom_data: true,
  terms: true,
  consents: true,
  companions: true,
  challenge: true,
  password: true,
};

/** The body as it came, key by key. Nothing is judged yet: a value of the wrong type is the problem of its field.
 * Only `custom_data` has a shape already, because `readEnvelope` refuses a body whose `custom_data` is anything but an
 * object or nothing. `password` is read for every event and judged for only one whose way in is the password
 * (./submit-route.ts): the field checks below never look at it. */
export type SubmissionEnvelope = {
  readonly [K in Exclude<keyof RegistrationSubmitBody, "custom_data">]: unknown;
} & { readonly custom_data: Record<string, unknown> | null | undefined };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function ownValue(record: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(record, key)?.value;
}

/**
 * The body as an envelope, or null when it is not a form the page could have sent: not an object, an object with a
 * key the contract does not have, or `custom_data` that is neither an object nor absent.
 */
export function readEnvelope(raw: unknown): SubmissionEnvelope | null {
  if (!isPlainRecord(raw)) return null;
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(BODY_KEYS, key)) return null;
  }
  const customData = ownValue(raw, "custom_data");
  if (customData !== undefined && customData !== null && !isPlainRecord(customData)) return null;
  return {
    first_name: ownValue(raw, "first_name"),
    last_name: ownValue(raw, "last_name"),
    email: ownValue(raw, "email"),
    company: ownValue(raw, "company"),
    department: ownValue(raw, "department"),
    custom_data: customData,
    terms: ownValue(raw, "terms"),
    consents: ownValue(raw, "consents"),
    companions: ownValue(raw, "companions"),
    challenge: ownValue(raw, "challenge"),
    password: ownValue(raw, "password"),
  };
}

/** What a guest is told about a refused field. A fixed set: see the head of this file. */
export const SUBMIT_MESSAGES = {
  firstName: "Enter your first name, up to 100 characters and without links.",
  lastName: "Enter your last name, up to 100 characters and without links.",
  email: "Enter a valid email address.",
  company: "Check the company name. It can have up to 100 characters.",
  department: "Check the department. It can have up to 100 characters.",
  terms: "Accept the event terms to continue.",
  challenge: "The security check did not pass. Try again.",
  answerMissing: "Answer this question.",
  companionName: "Enter your guest's full name, up to 100 characters and without links.",
  tooManyCompanions: "This event does not take that many guests.",
} as const;

/** The sentence for an answer that is there but is not accepted, by the type of the question. */
const INVALID_ANSWER_MESSAGES: ReadonlyMap<string, string> = new Map([
  ["text", "Check this answer. It is too long or does not follow the rules shown."],
  ["long_text", "Check this answer. It is too long or has characters we cannot accept."],
  ["date", "Enter a valid date."],
  ["datetime", "Enter a valid date and time."],
  ["phone", "Enter a valid phone number."],
  ["select", "Choose one of the options."],
  ["boolean", "Choose Yes or No."],
]);

const INVALID_ANSWER_FALLBACK = "Check this answer.";

export function invalidAnswerMessage(field: RegistrantFormField): string {
  return INVALID_ANSWER_MESSAGES.get(field.type ?? "text") ?? INVALID_ANSWER_FALLBACK;
}

const isEmptyAnswer = (raw: unknown): boolean =>
  raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "");

/** Whose answers a set of questions asks for, and the name of the error of a refused one: the guest's own, or a companion's. */
type AnswerSet = { appliesTo: "guest" | "companion"; errorKey: (sourceField: string) => string };
const GUEST_ANSWERS: AnswerSet = { appliesTo: "guest", errorKey: customDataErrorKey };
const COMPANION_ANSWERS: AnswerSet = { appliesTo: "companion", errorKey: companionAnswerErrorKey };

/** Whether the boundary refuses this set of questions with these answers. Anything but its own refusal is a bug of
 * ours and is let through to the caller. */
function boundaryRefuses(
  fields: readonly RegistrantFormField[],
  answers: Record<string, unknown>,
  appliesTo: AnswerSet["appliesTo"],
): boolean {
  try {
    buildRegistrantCustomData(fields, answers, appliesTo);
    return false;
  } catch (error) {
    if (error instanceof RegistrantInputError) return true;
    throw error;
  }
}

/** The answers of `input` to these questions, and no others. */
function answersTo(input: Record<string, unknown> | undefined, keys: readonly string[]): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    const answer = input ? ownValue(input, key) : undefined;
    if (answer !== undefined) {
      Object.defineProperty(picked, key, { value: answer, enumerable: true, configurable: true, writable: true });
    }
  }
  return picked;
}

/**
 * The questions whose answers the boundary refused, with the sentence for each.
 *
 * The boundary is asked about the whole set first and its answer decides: this function only names the questions
 * after a refusal, so it cannot let through what the boundary would not. A question that is always asked is tried
 * alone. One that waits for another answer (`rules.show_when`) is tried together with the question it names, as the
 * boundary would see it, unless that question has failed itself: then the answer to it is not known, and only the
 * question it names is reported.
 */
function refusedAnswers(
  fields: readonly RegistrantFormField[],
  input: Record<string, unknown> | undefined,
  appliesTo: AnswerSet["appliesTo"],
): Map<string, string> {
  const onForm = pickRegistrantFormFields(fields, appliesTo);
  const byKey = new Map(onForm.map((field) => [field.source_field, field]));
  const refused = new Map<string, string>();
  const refuse = (field: RegistrantFormField) => {
    const raw = input ? ownValue(input, field.source_field) : undefined;
    refused.set(field.source_field, isEmptyAnswer(raw) ? SUBMIT_MESSAGES.answerMissing : invalidAnswerMessage(field));
  };
  for (const field of onForm) {
    if (!field.rules?.show_when && boundaryRefuses([field], answersTo(input, [field.source_field]), appliesTo)) refuse(field);
  }
  for (const field of onForm) {
    const controller = byKey.get(field.rules?.show_when?.field ?? "");
    if (!controller || refused.has(controller.source_field)) continue;
    const keys = [controller.source_field, field.source_field];
    if (boundaryRefuses([controller, field], answersTo(input, keys), appliesTo)) refuse(field);
  }
  return refused;
}

/** What the questions came to: the answers to store, the sentences for the questions that were refused, or a body
 * the boundary refuses although no single question is to blame (too many keys). */
type AnswersCheck =
  | { kind: "ok"; answers: Record<string, string> | undefined }
  | { kind: "refused"; errors: Map<string, string> }
  | { kind: "malformed" };

/** The answers to the organiser's questions of `who` (the guest's, or a companion's). Only the questions on the form are
 * read, and a question that is not asked (`rules.show_when`) is not read at all, however the answers to the others are:
 * see buildRegistrantCustomData. */
function checkAnswers(
  fields: readonly RegistrantFormField[],
  answers: Record<string, unknown> | null | undefined,
  who: AnswerSet,
): AnswersCheck {
  const input = answers ?? undefined;
  try {
    return { kind: "ok", answers: buildRegistrantCustomData(fields, input, who.appliesTo) };
  } catch (error) {
    if (!(error instanceof RegistrantInputError)) throw error;
  }
  const refused = refusedAnswers(fields, input, who.appliesTo);
  if (refused.size === 0) return { kind: "malformed" };
  return {
    kind: "refused",
    errors: new Map([...refused].map(([key, message]) => [who.errorKey(key), message])),
  };
}

/** The first name, the last name and the address, or null when any is refused (`errors` then says which). */
function checkIdentity(
  envelope: SubmissionEnvelope,
  errors: Map<string, string>,
): { first_name: string; last_name: string; email: string } | null {
  const firstName = registrantNameSchema.safeParse(envelope.first_name);
  if (!firstName.success) errors.set(ERROR_KEY_FIRST_NAME, SUBMIT_MESSAGES.firstName);
  const lastName = registrantNameSchema.safeParse(envelope.last_name);
  if (!lastName.success) errors.set(ERROR_KEY_LAST_NAME, SUBMIT_MESSAGES.lastName);
  const email = registrantEmailSchema.safeParse(envelope.email);
  if (!email.success) errors.set(ERROR_KEY_EMAIL, SUBMIT_MESSAGES.email);
  if (!firstName.success || !lastName.success || !email.success) return null;
  return { first_name: firstName.data, last_name: lastName.data, email: email.data };
}

/** `company` or `department`: not read when the event does not ask for it, refused when it is asked and hostile. */
function checkProfileField(
  name: "company" | "department",
  asked: boolean,
  raw: unknown,
): { ok: true; value: string | undefined } | { ok: false } {
  if (!asked) return { ok: true, value: undefined };
  try {
    const picked = pickRegistrantProfileFields(
      { company: name === "company", department: name === "department" },
      { company: raw, department: raw },
    );
    return { ok: true, value: name === "company" ? picked.company : picked.department };
  } catch (error) {
    if (error instanceof RegistrantInputError) return { ok: false };
    throw error;
  }
}

/** The optional company and department. A refusal goes to `errors`; what is accepted is returned. */
function checkProfile(
  envelope: SubmissionEnvelope,
  rules: SubmissionRules,
  errors: Map<string, string>,
): { company?: string; department?: string } {
  const company = checkProfileField("company", rules.askCompany, envelope.company);
  if (!company.ok) errors.set(ERROR_KEY_COMPANY, SUBMIT_MESSAGES.company);
  const department = checkProfileField("department", rules.askDepartment, envelope.department);
  if (!department.ok) errors.set(ERROR_KEY_DEPARTMENT, SUBMIT_MESSAGES.department);
  return {
    ...(company.ok && company.value !== undefined ? { company: company.value } : {}),
    ...(department.ok && department.value !== undefined ? { department: department.value } : {}),
  };
}

/** The extra consents the guest ticked: only keys of the consents the event shows, each once. Null when the list
 * is not that (a stale page, or a body the page did not send). */
export function checkConsents(raw: unknown, allowedKeys: readonly string[]): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > allowedKeys.length) return null;
  const allowed = new Set(allowedKeys);
  const ticked = new Set<string>();
  for (const key of raw as unknown[]) {
    if (typeof key !== "string" || !allowed.has(key)) return null;
    ticked.add(key);
  }
  return [...ticked];
}

/** The keys of one companion in the body, and no others: as for the body (see BODY_KEYS), a key the page does not send makes
 * the whole body malformed. */
const COMPANION_KEYS: Readonly<Record<keyof RegistrationSubmitCompanion, true>> = { name: true, answers: true };

/** One companion as it came, key by key. The name is not judged yet: a value of the wrong type is the problem of the field. */
type CompanionEntry = { name: unknown; answers: Record<string, unknown> | undefined };

/** The companion, or null when it is not one the page could have sent: not an object, an object with a key the contract does
 * not have, or answers that are neither an object nor absent. */
function readCompanionEntry(raw: unknown): CompanionEntry | null {
  if (!isPlainRecord(raw)) return null;
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(COMPANION_KEYS, key)) return null;
  }
  const answers = ownValue(raw, "answers");
  if (answers !== undefined && answers !== null && !isPlainRecord(answers)) return null;
  return { name: ownValue(raw, "name"), answers: answers ?? undefined };
}

/** What the companions of the body came to: the ones to store, or a body the page did not send. */
type CompanionsCheck = { kind: "ok"; companions: RegistrationCompanion[] } | { kind: "malformed" };

/**
 * One companion of the body: the name goes through the schema of a registrant's name before it can reach
 * `Registration.companions`, and the answers through the boundary for a companion, so that only the questions about a companion
 * that are on the form are read, whatever else the object holds (a question about the guest, an unknown key, `__proto__`). A
 * refusal goes to `errors` and the companion is not stored (null); `"malformed"` is a refusal that no single field is to blame for.
 */
function judgeCompanion(
  entry: CompanionEntry,
  fields: readonly RegistrantFormField[],
  errors: Map<string, string>,
): RegistrationCompanion | null | "malformed" {
  const name = registrantNameSchema.safeParse(entry.name);
  if (!name.success) errors.set(ERROR_KEY_COMPANION_NAME, SUBMIT_MESSAGES.companionName);
  const answers = checkAnswers(fields, entry.answers, COMPANION_ANSWERS);
  if (answers.kind === "malformed") return "malformed";
  if (answers.kind === "refused") {
    for (const [key, message] of answers.errors) errors.set(key, message);
    return null;
  }
  return name.success ? { name: name.data, custom_data: answers.answers ?? null } : null;
}

/**
 * The companions the guest brings (D-E5). Absent is none. A body that has the key for an event that takes none is not one the
 * page sent, whatever it holds, and is refused as any other shape the page does not send; more than the event takes is a
 * refusal of its own, with a sentence, before any entry is read. Every refusal goes to `errors`, so that the guest sees all
 * that is wrong at once.
 */
function checkCompanions(raw: unknown, rules: SubmissionRules, errors: Map<string, string>): CompanionsCheck {
  if (raw === undefined) return { kind: "ok", companions: [] };
  // The page never sends the key for an event that takes none, not even as null: it is a shape the page did not send.
  if (rules.companionMax === 0) return { kind: "malformed" };
  if (raw === null) return { kind: "ok", companions: [] };
  if (!Array.isArray(raw)) return { kind: "malformed" };
  if (raw.length > rules.companionMax) {
    errors.set(ERROR_KEY_COMPANIONS, SUBMIT_MESSAGES.tooManyCompanions);
    return { kind: "ok", companions: [] };
  }
  const companions: RegistrationCompanion[] = [];
  for (const item of raw as unknown[]) {
    const entry = readCompanionEntry(item);
    if (entry === null) return { kind: "malformed" };
    const judged = judgeCompanion(entry, rules.fields, errors);
    if (judged === "malformed") return { kind: "malformed" };
    if (judged !== null) companions.push(judged);
  }
  return { kind: "ok", companions };
}

/** What the event gives the check: its fixed questions, its organiser's questions and the consents it shows. */
export type SubmissionRules = {
  askCompany: boolean;
  askDepartment: boolean;
  fields: readonly RegistrantFormField[];
  /** Keys of the extra consents the form shows: the texts of this event that are published. */
  consentKeys: readonly string[];
  /** How many companions the form takes: 0 when it offers none (`fields` then holds the companion questions all the same,
   * and none is read). */
  companionMax: number;
  now: Date;
};

export type CheckedSubmission =
  | { kind: "valid"; registrant: RegistrantSubmission }
  /** `errors`: the key the page puts a sentence under, and the sentence. */
  | { kind: "invalid"; errors: Map<string, string> }
  /** Not a form the page sent: the whole request is refused with no word about any field. */
  | { kind: "malformed" };

/**
 * Judges every piece of the envelope at once, so that the guest sees all that is wrong in one answer. `terms` must be
 * `true` (D-F3: the proof of consent is the time it was accepted, so there is no registration without it), and
 * consents are recorded only for the texts the event shows. The registrant it returns holds what to store, with the
 * time of the acceptance.
 */
export function checkSubmission(envelope: SubmissionEnvelope, rules: SubmissionRules): CheckedSubmission {
  const errors = new Map<string, string>();
  const identity = checkIdentity(envelope, errors);
  const profile = checkProfile(envelope, rules, errors);
  if (envelope.terms !== true) errors.set(ERROR_KEY_TERMS, SUBMIT_MESSAGES.terms);
  const answers = checkAnswers(rules.fields, envelope.custom_data, GUEST_ANSWERS);
  const consents = checkConsents(envelope.consents, rules.consentKeys);
  const companions = checkCompanions(envelope.companions, rules, errors);
  if (answers.kind === "malformed" || consents === null || companions.kind === "malformed") return { kind: "malformed" };
  if (answers.kind === "refused") {
    for (const [key, message] of answers.errors) errors.set(key, message);
  }
  if (identity === null || errors.size > 0) return { kind: "invalid", errors };

  const acceptedAt = rules.now.toISOString();
  return {
    kind: "valid",
    registrant: {
      ...identity,
      ...profile,
      ...(answers.kind === "ok" && answers.answers !== undefined ? { custom_data: answers.answers } : {}),
      ...(companions.companions.length > 0 ? { companions: companions.companions } : {}),
      accepted_at: rules.now,
      consents: Object.fromEntries(consents.map((key) => [key, acceptedAt])),
    },
  };
}
