/**
 * How the staff queue reads the guest registrations of an event (D-B11, D-F5): what a request may ask
 * for, and the one filter that the list, and a later delete "by filter", both use. Nothing here
 * touches the database, so a filter is checked before anything runs.
 *
 * A filter is strict: a value outside its closed list, or a search text that cannot be searched for,
 * is refused, never read as "no filter". A filter that was silently dropped would select every
 * registration of the event, which a delete by filter must never do.
 */
import type { Prisma } from "@admitto/db/client";
import { REGISTRATION_STATUS, type RegistrationStatus } from "@admitto/db/status";
import { REGISTRANT_EMAIL_MAX, normalizeRegistrantText } from "./registrant-input.js";
import { registrationMailMisfit } from "./registration-mail-queue.js";

/**
 * The most registration ids one bulk request (admit, reject or delete) may carry. The same limit as the
 * attendee bulk routes (`BULK_SEND_LIMIT`), kept here so the three registration routes share one number
 * (audit CP-12).
 */
export const MAX_REGISTRATION_BULK_IDS = 500;

/** The longest search text: a whole address, which is the longest thing a search can look for. */
export const REGISTRATION_SEARCH_MAX_LENGTH = REGISTRANT_EMAIL_MAX;

/** The most words a search may hold. Each word must be found, so a longer list narrows nothing more. */
export const REGISTRATION_SEARCH_MAX_WORDS = 8;

/**
 * "Registered more than ... ago", as a closed list (hours `h`, days `d`) so that a value is never read
 * as a number: D-F5 deletes by age.
 */
export const REGISTRATION_AGE_FILTERS = ["1h", "24h", "3d", "7d", "14d", "30d", "90d", "180d", "365d"] as const;

export type RegistrationAgeFilter = (typeof REGISTRATION_AGE_FILTERS)[number];

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export function isRegistrationAgeFilter(value: string): value is RegistrationAgeFilter {
  return (REGISTRATION_AGE_FILTERS as readonly string[]).includes(value);
}

export function isRegistrationStatus(value: string): value is RegistrationStatus {
  return (REGISTRATION_STATUS as readonly string[]).includes(value);
}

/** A registration is older than the filter when it was made before this moment. */
export function registrationAgeCutoff(age: RegistrationAgeFilter, now: Date): Date {
  const amount = Number.parseInt(age, 10);
  return new Date(now.getTime() - amount * (age.endsWith("h") ? HOUR_MS : DAY_MS));
}

/**
 * The words of a search text, or null when it cannot be searched for: too long, too many words, or
 * with a control, invisible or direction-changing character (which no registration can hold, because
 * the form refuses them). The text is trimmed, composed to NFC and split on any run of white space, so
 * the spacing a person types does not matter. An empty text has no words.
 */
export function parseRegistrationSearch(raw: string): string[] | null {
  const clean = normalizeRegistrantText(raw, REGISTRATION_SEARCH_MAX_LENGTH);
  if (clean === null) return null;
  const words = clean.split(/\s+/u).filter((word) => word !== "");
  return words.length <= REGISTRATION_SEARCH_MAX_WORDS ? words : null;
}

export interface RegistrationListFilter {
  /** One of the five states; left out, every state. */
  status?: RegistrationStatus;
  /** Only registrations made more than this long ago (`created_at`). */
  olderThan?: RegistrationAgeFilter;
  /** From `parseRegistrationSearch`: each word must be in the first name, the last name or the address. */
  words?: readonly string[];
}

/** A filter as it arrives from a query string or a body, before it is checked. */
export interface RegistrationFilterInput {
  status?: string;
  olderThan?: string;
  q?: string;
}

/** The names of the request parameters a filter can refuse. */
export type RegistrationFilterField = "status" | "older_than" | "q";

export type RegistrationFilterResult =
  | { ok: true; filter: RegistrationListFilter }
  | { ok: false; invalid: RegistrationFilterField[] };

/** `undefined` for a value that is left out or blank, null for one outside the closed list. */
function parseChoice<T extends string>(
  raw: string | undefined,
  isChoice: (value: string) => value is T,
): T | null | undefined {
  const value = raw?.trim();
  if (value === undefined || value === "") return undefined;
  return isChoice(value) ? value : null;
}

/** Checks a filter. The result names the parameters that failed, never their values. */
export function parseRegistrationFilter(input: RegistrationFilterInput): RegistrationFilterResult {
  const status = parseChoice(input.status, isRegistrationStatus);
  const olderThan = parseChoice(input.olderThan, isRegistrationAgeFilter);
  const words = input.q === undefined ? [] : parseRegistrationSearch(input.q);

  if (status !== null && olderThan !== null && words !== null) {
    return { ok: true, filter: { status, olderThan, words } };
  }
  const invalid: RegistrationFilterField[] = [];
  if (status === null) invalid.push("status");
  if (olderThan === null) invalid.push("older_than");
  if (words === null) invalid.push("q");
  return { ok: false, invalid };
}

/**
 * `contains` puts the word between two `%` and hands it to `ILIKE` as it is, which reads `%` and `_` in the
 * word as wildcards and `\` as the escape. Escaped, they are the characters a person typed.
 */
function escapeLikePattern(word: string): string {
  return word.replaceAll("\\", String.raw`\\`).replaceAll("%", String.raw`\%`).replaceAll("_", String.raw`\_`);
}

function wordIsFound(word: string): Prisma.RegistrationWhereInput {
  const contains = escapeLikePattern(word);
  return {
    OR: [
      { first_name: { contains, mode: "insensitive" } },
      { last_name: { contains, mode: "insensitive" } },
      { email: { contains, mode: "insensitive" } },
    ],
  };
}

/**
 * The registrations of one event that a filter selects. Always limited to the event, so an id from
 * another event is never in the result. Only the names and the address are searched: not the answers
 * (`custom_data`), which can hold fields that are sensitive (D-E6).
 */
export function registrationListWhere(
  eventId: string,
  filter: RegistrationListFilter,
  now: Date,
): Prisma.RegistrationWhereInput {
  const { status, olderThan, words = [] } = filter;
  return {
    event_id: eventId,
    ...(status ? { status } : {}),
    ...(olderThan ? { created_at: { lt: registrationAgeCutoff(olderThan, now) } } : {}),
    ...(words.length > 0 ? { AND: words.map(wordIsFound) } : {}),
  };
}

/**
 * A queued registration mail that staff may send again (D-B15): it failed, the worker is not trying it again by
 * itself, and its registration still fits it (registrationMailMisfit), as the worker would cancel it otherwise. One
 * that is still being tried (`retryable`), waits, went out, or was cancelled because the registration changed is not
 * offered.
 */
export function canRetryRegistrationMail(
  mail: { template_name: string; status: string; retryable: boolean | null },
  registration: { status: string; confirm_expires_at: Date | null },
  nowMs: number,
): boolean {
  return (
    mail.status === "failed" &&
    mail.retryable !== true &&
    registrationMailMisfit(mail.template_name, registration, nowMs) === null
  );
}
