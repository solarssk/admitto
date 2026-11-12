/**
 * The check of an event's own address for guests (D-C6, PR 120): does `https://<address>/.well-known/admitto-domain-check` reach THIS
 * instance, for THIS event? It is the only writer of `custom_domain_status`, `custom_domain_verified_at`, `custom_domain_checked_at`
 * and `custom_domain_check_result`; the guests' links and the host routing start to use the address when the first check finds it
 * working (`custom_domain_verified_at`), and stop being asked about it only when the address is changed or removed.
 *
 * The address is chosen by a superadmin, so the request is made with the client the other outbound calls of an operator-chosen
 * address use (nothing here is a second SSRF guard):
 * - `resolveSafeHostname` and `awaitWithAbortSignal` (`@admitto/shared`) resolve the name and refuse a private, loopback,
 *   link-local or metadata address;
 * - `withPinnedFetch` (`@admitto/mailer`) connects to the address that was validated, with the name kept for the TLS name check, so a
 *   second lookup at connect time cannot be answered differently.
 * One deadline covers the lookup, the connection and the reading of the answer. The request follows no redirect (a 3xx is the answer
 * of something that is not this instance), and only the first kilobyte of an answer is read.
 *
 * What is found is one of six words (`CustomDomainCheckResult`). The name resolving to a private address, as a name of the
 * organisation's internal DNS does, is `not_verifiable_from_server`: information, not a fault, and the status stays `unchecked`.
 *
 * The certificate's expiry date is NOT read. The client of the pinned fetch hands back the response and not the connection, and
 * reading the certificate would take a second client with its own socket, which is a second thing to keep safe. An expired certificate
 * shows as `tls_failed` on the next check, which is when it matters.
 */
import type { LookupAddress } from "node:dns";
import type { PrismaClient } from "@admitto/db";
import { verifyDomainCheck } from "@admitto/crypto";
import { withPinnedFetch } from "@admitto/mailer";
import {
  DOMAIN_CHECK_PATH,
  statusOfCheckResult,
  type CustomDomainCheckResult,
  type CustomDomainStatus,
} from "@admitto/shared";
import { awaitWithAbortSignal, resolveSafeHostname, SafeHostnameError } from "@admitto/shared/ssrf-guard";

/** The whole check, the lookup and the reading of the answer included. */
export const DOMAIN_CHECK_TIMEOUT_MS = 5_000;
/** The proof is `{"ok":true,"mac":"<43 characters>"}`; an answer longer than this is not it. */
export const DOMAIN_CHECK_MAX_BODY_BYTES = 1_024;
/** An address is looked at again when its last check is older than this (the daily refresh). */
export const DOMAIN_CHECK_REFRESH_MS = 24 * 3_600_000;
/** Addresses one run of the refresh checks: each can take its whole deadline, and a run must not hold up a worker tick. */
export const DOMAIN_CHECK_SWEEP_BATCH = 5;

export interface DomainCheckDeps {
  /** The lookup (a test replaces it); the default refuses a name that resolves to a private address. */
  resolve?: (hostname: string) => Promise<LookupAddress[]>;
  /** The pinned request (a test replaces it). */
  fetchPinned?: typeof withPinnedFetch;
  /** The host name of the instance, lower case, or null: an event's address cannot be the instance's own. */
  instanceHostname?: string | null;
  timeoutMs?: number;
}

/** Codes of a refused certificate or a failed handshake, from `node:tls` and OpenSSL. */
const TLS_CODES: ReadonlySet<string> = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_REVOKED",
  "CERT_UNTRUSTED",
  "CERT_SIGNATURE_FAILURE",
  "HOSTNAME_MISMATCH",
  "EPROTO",
]);
const TLS_CODE_PREFIXES = ["ERR_TLS_", "ERR_SSL_"] as const;

/** Whether an error, or what caused it (undici wraps the reason in `TypeError: fetch failed`), is a refused certificate or a failed handshake. */
function isTlsFailure(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current instanceof Error && depth < 5; depth += 1) {
    const code = (current as NodeJS.ErrnoException).code;
    if (typeof code === "string" && (TLS_CODES.has(code) || TLS_CODE_PREFIXES.some((prefix) => code.startsWith(prefix)))) return true;
    current = current.cause;
  }
  return false;
}

/** The result for a name that did not resolve to a usable address. */
function resultOfLookupFailure(error: unknown): CustomDomainCheckResult {
  // A private address is how an internal DNS answers: the server cannot judge the name, which is not a fault of it.
  return error instanceof SafeHostnameError && error.code === "hostname_blocked" ? "not_verifiable_from_server" : "dns_failed";
}

/** The first `max` bytes of the body as text, or null when it is longer (the rest is not read). */
async function readCapped(response: Response, max: number): Promise<string | null> {
  const body: ReadableStream<Uint8Array> | null = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** The `mac` of a body that is `{"ok":true,"mac":"<text>"}`, else null. */
function macOf(text: string): string | null {
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body !== "object" || body === null) return null;
    const { ok, mac } = body as { ok?: unknown; mac?: unknown };
    return ok === true && typeof mac === "string" ? mac : null;
  } catch {
    return null;
  }
}

/** What an answer from the address says: this instance's proof for this event, or not. */
async function judgeAnswer(response: Response, eventId: string, domain: string): Promise<CustomDomainCheckResult> {
  const isJson = response.status === 200 && (response.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
  // The body is read (or dropped) inside the handler: the connection is closed when the handler returns, and waits for a body that nobody reads.
  const text = isJson ? await readCapped(response, DOMAIN_CHECK_MAX_BODY_BYTES) : await response.body?.cancel().then(() => null);
  const mac = text === null || text === undefined ? null : macOf(text);
  return mac !== null && verifyDomainCheck(eventId, domain, mac) ? "ok" : "wrong_target";
}

/**
 * Asks the address for its proof. Never throws: whatever goes wrong is one of the words. Nothing of the address' answer, and no text
 * of an error, is kept or returned.
 */
export async function probeEventDomain(eventId: string, domain: string, deps: DomainCheckDeps = {}): Promise<CustomDomainCheckResult> {
  if (deps.instanceHostname === domain) return "wrong_target";
  const signal = AbortSignal.timeout(deps.timeoutMs ?? DOMAIN_CHECK_TIMEOUT_MS);
  let records: LookupAddress[];
  try {
    records = await awaitWithAbortSignal((deps.resolve ?? resolveSafeHostname)(domain), signal);
  } catch (error) {
    return resultOfLookupFailure(error);
  }
  try {
    return await (deps.fetchPinned ?? withPinnedFetch)(
      `https://${domain}${DOMAIN_CHECK_PATH}`,
      domain,
      records,
      { method: "GET", headers: { Accept: "application/json" }, signal, redirect: "manual" },
      (response) => judgeAnswer(response, eventId, domain),
    );
  } catch (error) {
    return isTlsFailure(error) ? "tls_failed" : "unreachable";
  }
}

/** What the columns of an address say, as the panel reads them. */
export interface DomainCheckState {
  custom_domain: string | null;
  custom_domain_status: CustomDomainStatus;
  custom_domain_check_result: CustomDomainCheckResult | null;
  custom_domain_verified_at: Date | null;
  custom_domain_checked_at: Date | null;
}

const STATE_SELECT = {
  custom_domain: true,
  custom_domain_status: true,
  custom_domain_check_result: true,
  custom_domain_verified_at: true,
  custom_domain_checked_at: true,
} as const;

export type RecordedCheck =
  /** The address was changed or removed while the check ran: its result says nothing about the new one, and nothing is written. */
  | { kind: "stale" }
  /** A check that finished after this one began has written already: its result is at least as fresh, and nothing is written. */
  | { kind: "superseded" }
  | { kind: "recorded"; firstVerified: boolean; wentFailing: boolean };

/**
 * Writes what a check found, under the lock of the event's settings row, so two checks of one address at once leave one consistent
 * state: they write one after the other, each judged against what the row holds when its turn comes.
 * - A result for an address the row no longer holds is dropped (`stale`).
 * - A result is dropped when another check finished after this one began (`superseded`), so a slow check never overwrites a newer one.
 * - The first `ok` sets `custom_domain_verified_at`. Nothing ever clears it but a change of the address (D-C6: a later failure only
 *   warns, there is no silent return to the instance's address).
 * The time written is read here, after the request, never the time the check began.
 */
export function recordDomainCheck(
  db: PrismaClient,
  input: { eventId: string; domain: string; result: CustomDomainCheckResult; startedAt: Date; now?: () => Date },
): Promise<RecordedCheck> {
  const { eventId, domain, result, startedAt } = input;
  return db.$transaction(async (tx) => {
    // The lock comes first: the row is read below only once it is held.
    await tx.$queryRaw`SELECT 1 FROM "EventRegistrationSettings" WHERE "event_id" = ${eventId} FOR UPDATE`;
    const row = await tx.eventRegistrationSettings.findUnique({ where: { event_id: eventId }, select: STATE_SELECT });
    if (row?.custom_domain !== domain) return { kind: "stale" } as const;
    if (row.custom_domain_checked_at !== null && row.custom_domain_checked_at > startedAt) return { kind: "superseded" } as const;
    const checkedAt = (input.now ?? (() => new Date()))();
    const status = statusOfCheckResult(result);
    const firstVerified = result === "ok" && row.custom_domain_verified_at === null;
    await tx.eventRegistrationSettings.update({
      where: { event_id: eventId },
      data: {
        custom_domain_status: status,
        custom_domain_check_result: result,
        custom_domain_checked_at: checkedAt,
        ...(firstVerified ? { custom_domain_verified_at: checkedAt } : {}),
      },
    });
    return { kind: "recorded", firstVerified, wentFailing: status === "failing" && row.custom_domain_status === "ok" } as const;
  });
}

/** The state of an event's address, or null when the event has no settings row. */
export async function readDomainCheckState(db: PrismaClient, eventId: string): Promise<DomainCheckState | null> {
  const row = await db.eventRegistrationSettings.findUnique({ where: { event_id: eventId }, select: STATE_SELECT });
  if (row === null) return null;
  return {
    ...row,
    // The table's CHECKs keep both to their words; this keeps the types honest.
    custom_domain_status: row.custom_domain_status === "ok" || row.custom_domain_status === "failing" ? row.custom_domain_status : "unchecked",
    custom_domain_check_result: row.custom_domain_check_result as CustomDomainCheckResult | null,
  };
}

/**
 * Checks the address of one event now and records what was found. Gives the state after it, or null when the event has no address.
 * `recorded` is what `recordDomainCheck` made of the result, so a caller can log a first verification or a fall to `failing`.
 */
export async function checkEventDomain(
  db: PrismaClient,
  eventId: string,
  deps: DomainCheckDeps & { now?: () => Date } = {},
): Promise<{ state: DomainCheckState | null; recorded: RecordedCheck | null }> {
  const before = await readDomainCheckState(db, eventId);
  if (before?.custom_domain == null) return { state: before, recorded: null };
  const startedAt = (deps.now ?? (() => new Date()))();
  const result = await probeEventDomain(eventId, before.custom_domain, deps);
  const recorded = await recordDomainCheck(db, { eventId, domain: before.custom_domain, result, startedAt, now: deps.now });
  return { state: await readDomainCheckState(db, eventId), recorded };
}

export interface RefreshEventDomainsResult {
  /** Addresses checked in this run. */
  checked: number;
  /** Addresses that were found working for the first time. */
  verified: number;
  /** Addresses that worked and no longer do. */
  failing: number;
  /** Addresses whose check could not be made or written (the database failed). */
  errors: number;
  /** The run stopped at its limit: more addresses may be due. */
  more: boolean;
}

/**
 * The daily refresh, run by the worker job `registration_mail` on each tick: the addresses of events that are not archived whose last
 * check is older than a day, or that were never checked (so an address a superadmin has just set is looked at within a tick), the
 * oldest first, a few at a time. An address checked a minute ago is not looked at again, whatever the tick.
 */
export async function refreshEventDomains(
  db: PrismaClient,
  deps: DomainCheckDeps & { now?: () => Date; limit?: number } = {},
): Promise<RefreshEventDomainsResult> {
  const limit = deps.limit ?? DOMAIN_CHECK_SWEEP_BATCH;
  const now = (deps.now ?? (() => new Date()))();
  const due = await db.eventRegistrationSettings.findMany({
    where: {
      custom_domain: { not: null },
      event: { archived_at: null },
      OR: [{ custom_domain_checked_at: null }, { custom_domain_checked_at: { lt: new Date(now.getTime() - DOMAIN_CHECK_REFRESH_MS) } }],
    },
    select: { event_id: true },
    orderBy: [{ custom_domain_checked_at: { sort: "asc", nulls: "first" } }, { event_id: "asc" }],
    take: limit + 1,
  });
  const result: RefreshEventDomainsResult = { checked: 0, verified: 0, failing: 0, errors: 0, more: due.length > limit };
  for (const { event_id } of due.slice(0, limit)) {
    try {
      const { recorded } = await checkEventDomain(db, event_id, deps); // NOSONAR - one after the other on purpose: a tick opens one connection at a time to hosts we do not control
      result.checked += 1;
      if (recorded?.kind === "recorded") {
        if (recorded.firstVerified) result.verified += 1;
        if (recorded.wentFailing) result.failing += 1;
      }
    } catch {
      result.errors += 1;
    }
  }
  // A batch that recorded nothing leaves the same rows first in the next run: do not ask for an immediate tick.
  result.more = result.more && result.checked > 0;
  return result;
}
