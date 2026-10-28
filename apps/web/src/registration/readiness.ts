/**
 * Whether an event may have guest registration on (PR 99a): what has to be in place, counted by ONE function,
 * {@link evaluateRegistrationReadiness}, for the screen that shows it (`GET .../registration/settings`) and for the save
 * that decides (`PUT`, which refuses to turn registration on, or to change the way in or the consents of an event that has
 * it on, while anything is missing).
 *
 * The answer is a list of checks, each a fixed key and whether it is met. It is never a sentence: a key is for the screen
 * to word, and an answer that names no more than a key can hold no text an organiser typed, no address and no exception.
 * A check that does not apply is not in the list (no `password` check for an event whose way in is the link, no
 * `access_method_enabled` check while no way in is chosen), so a key that is there is always one the organiser can act on.
 *
 * What it promises, pinned to the public page by registration-readiness.test.ts:
 *  - An event that is ready opens its form: `resolveRegistration` (./form-model.ts) finds it `open`.
 *  - Each key that closes the form is a condition of the page itself: the way in (`access_method`,
 *    `access_method_enabled`, `bot_protection`, `password`), the texts (`legal_documents`), the questions (`form_questions`)
 *    and the event (`event_not_archived`, `event_not_ended`). The rules behind them are the page's own functions, not
 *    copies: `resolveAccessMethodAvailability`, `evaluateLegalGate`, `drawQuestions`, `isOver`.
 *  - Three keys are about what the form leads to, not about the form: `required_fields` (a question a guest must answer and
 *    the form does not ask, which an import can leave behind), `mail_provider` (without one every mail the form queues
 *    fails in the worker) and `instance_url` (without one the worker does not send registration mail at all).
 *
 * The facts come in two parts so that the save can read the second under its locks: the system's (the environment:
 * `loadReadinessEnvironment`, no lock to take) and the event's (its texts and questions, read by the caller).
 */
import type { PrismaClient } from "@admitto/db";
import { resolveMailConfig } from "@admitto/mailer-config";
import type { RegistrantFormField } from "@admitto/tickets";
import { resolveInstanceBaseUrl } from "../instance-base-url.js";
import { evaluateLegalGate, type LegalGateRow } from "../legal/registration-gate.js";
import {
  resolveAccessMethodAvailability,
  SELECTABLE_ACCESS_METHODS,
  type AccessMethodAvailability,
  type SelectableAccessMethod,
} from "./access-methods.js";
import { isRequiredFieldOffForm } from "./field-on-form.js";
import type { FormQuestionType } from "./form-fields.js";
import { drawQuestions } from "./form-model.js";
import { resolveTurnstileKeys } from "./turnstile-settings.js";

/** The vocabulary of the checks, in the order they are listed. */
export const READINESS_KEYS = [
  "access_method",
  "access_method_enabled",
  "bot_protection",
  "password",
  "legal_documents",
  "form_questions",
  "required_fields",
  "mail_provider",
  "instance_url",
  "event_not_archived",
  "event_not_ended",
] as const;

export type RegistrationReadinessKey = (typeof READINESS_KEYS)[number];

export interface RegistrationReadinessCheck {
  key: RegistrationReadinessKey;
  ok: boolean;
}

/** What the system, not the event, decides. */
export interface ReadinessEnvironment {
  /** Every way in, with whether the system administrator enabled it and whether it can be used now. */
  availability: readonly AccessMethodAvailability[];
  /** The Turnstile keys are saved and the secret reads back. */
  botProtectionReady: boolean;
  /** A mail provider resolves for the event, as it does for the worker. */
  mailConfigured: boolean;
  /** The address guests' links point to (the one the worker uses), or null when none is known. */
  instanceBaseUrl: string | null;
}

/** What the event itself holds, read by the caller (under its locks, when the caller is a save). */
export interface EventReadinessFacts {
  archived: boolean;
  ended: boolean;
  legalRows: readonly LegalGateRow[];
  fields: readonly RegistrantFormField[];
}

export interface ReadinessInput {
  /** The settings as they stand or would be saved. `password_set` is whether a password is stored, never the password. */
  settings: { access_methods: readonly string[]; consent_keys: readonly string[]; password_set: boolean };
  environment: ReadinessEnvironment;
  event: EventReadinessFacts;
}

/** The way in an event has chosen, when it is exactly one that can be chosen in this release. */
export function chosenAccessMethod(methods: readonly string[]): SelectableAccessMethod | null {
  const only = methods.length === 1 ? methods[0] : undefined;
  return SELECTABLE_ACCESS_METHODS.find((method) => method === only) ?? null;
}

/**
 * The checks of an event, in the order of {@link READINESS_KEYS}. Pure: nothing here touches the database or the
 * network, so every key can be tried alone.
 */
export function evaluateRegistrationReadiness({ settings, environment, event }: ReadinessInput): RegistrationReadinessCheck[] {
  const method = chosenAccessMethod(settings.access_methods);
  const checks: RegistrationReadinessCheck[] = [{ key: "access_method", ok: method !== null }];
  if (method !== null) {
    const entry = environment.availability.find((candidate) => candidate.method === method);
    checks.push({ key: "access_method_enabled", ok: entry?.enabled === true });
  }
  checks.push({ key: "bot_protection", ok: environment.botProtectionReady });
  if (method === "password") checks.push({ key: "password", ok: settings.password_set });
  checks.push(
    { key: "legal_documents", ok: evaluateLegalGate(event.legalRows, settings.consent_keys).missing.length === 0 },
    { key: "form_questions", ok: drawQuestions(event.fields) !== null },
    { key: "required_fields", ok: !event.fields.some(isRequiredFieldOffForm) },
    { key: "mail_provider", ok: environment.mailConfigured },
    { key: "instance_url", ok: environment.instanceBaseUrl !== null },
    { key: "event_not_archived", ok: !event.archived },
    { key: "event_not_ended", ok: !event.ended },
  );
  return checks;
}

/** The keys of the checks that are not met: what a refusal names, and nothing else. */
export function readinessBlockers(checks: readonly RegistrationReadinessCheck[]): RegistrationReadinessKey[] {
  return checks.filter((check) => !check.ok).map((check) => check.key);
}

/** A question the guest will be asked: what the organiser sees to notice a field an import left on the form. */
export interface PublicFieldDto {
  /** The `source_field` of the question. */
  key: string;
  label: string;
  type: FormQuestionType;
  required: boolean;
}

/**
 * The questions the form asks, as the page draws them: the ones on the form, in the organiser's order, without a question
 * nobody can meet the condition of. Empty when the page cannot be drawn at all (`form_questions` is then not met), because
 * a form that is not shown asks nothing. The fixed fields (name, address, and company and department when switched on)
 * are not in the list.
 */
export function publicFieldsOf(fields: readonly RegistrantFormField[]): PublicFieldDto[] {
  return (drawQuestions(fields) ?? []).map((question) => ({
    key: question.key,
    label: question.label,
    type: question.type,
    required: question.required,
  }));
}

/** Whether `attempt` finishes without throwing. What it throws is none of the caller's business: the answer is a yes or a no. */
async function succeeds(attempt: () => Promise<unknown>): Promise<boolean> {
  try {
    await attempt();
    return true;
  } catch {
    return false;
  }
}

async function instanceBaseUrlOrNull(db: PrismaClient, env: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    return await resolveInstanceBaseUrl(db, env);
  } catch {
    return null;
  }
}

/**
 * Reads what the system decides, with the same functions the public page and the worker use: which ways in are enabled
 * and the Turnstile keys (the page's), the mail provider of the event and the address of the instance (the worker's, which
 * sends no registration mail without them). Nothing in the answer is a key, a secret or an address of a guest.
 */
export async function loadReadinessEnvironment(
  db: PrismaClient,
  eventId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ReadinessEnvironment> {
  const [availability, keys, mailConfigured, instanceBaseUrl] = await Promise.all([
    resolveAccessMethodAvailability(db),
    resolveTurnstileKeys(db),
    succeeds(() => resolveMailConfig(eventId, db, env)),
    instanceBaseUrlOrNull(db, env),
  ]);
  return { availability, botProtectionReady: keys.state === "ready", mailConfigured, instanceBaseUrl };
}
