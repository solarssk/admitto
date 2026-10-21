/**
 * The bot challenge of the public registration form (D-C2): checks the Cloudflare Turnstile token
 * a guest's browser sends with the form.
 *
 * Every path that is not a confirmed pass is a refusal, returned as a value so that a caller can
 * only let a guest through on `{ ok: true }`. Missing keys, a database that cannot be read, a
 * network error, a timeout, a non-2xx answer, a body that is not the expected JSON, a wrong host
 * or a token made for another event all end in `{ ok: false }`. There is no development exception:
 * without keys the form is closed, also for `localhost`. Cloudflare's published test keys cannot
 * pass the host and event checks below either (they answer for `example.com` and carry no
 * binding); a local run uses a real widget that lists `localhost` as a hostname.
 *
 * The verifier takes no part in logging. It never writes the token, the secret or the answer
 * anywhere, and a caller that wants an operator signal counts outcomes itself instead of writing a
 * line per anonymous request (the system log ring holds 1000 entries).
 */

import type { PrismaClient } from "@admitto/db";
import { NO_COMPRESSION_HEADERS } from "@admitto/shared";
import { resolveInstanceBaseUrl } from "../instance-base-url.js";
import { readJsonCapped } from "../weather/read-json-capped.js";
import { resolveTurnstileKeys, type TurnstileSettingsDb } from "./turnstile-settings.js";

/** The one host the secret is ever sent to. Fixed, never read from settings or a request. */
export const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** The whole exchange, response body included, gets this long. No retry: a retry would spend
 * the single-use token again and double the time a stuck guest waits. */
export const BOT_CHALLENGE_TIMEOUT_MS = 5_000;

/** Cloudflare documents 2048 characters as the longest token, so a longer one cannot be genuine
 * and is not sent upstream. */
export const MAX_BOT_CHALLENGE_TOKEN_LENGTH = 2_048;

/** A real answer is about 150 bytes. */
const MAX_SITEVERIFY_RESPONSE_BYTES = 16 * 1024;

/**
 * Why a token did not pass.
 * - `not_configured`: no usable keys, the form is closed.
 * - `missing_token`: the request carried no token (or not a string).
 * - `rejected`: Cloudflare says the token is invalid, expired or already used.
 * - `wrong_host`: solved on a host that is not the instance's (or the event's own address).
 * - `wrong_binding`: solved for another event.
 * - `secret_rejected`: Cloudflare refused the saved secret key, or the saved keys are Cloudflare's
 *   own test keys, which can never pass. The guest did nothing wrong.
 * - `unavailable`: no usable answer (network error, timeout, non-2xx, malformed or oversized body).
 */
export type BotChallengeFailure =
  | "not_configured"
  | "missing_token"
  | "rejected"
  | "wrong_host"
  | "wrong_binding"
  | "secret_rejected"
  | "unavailable";

export type BotChallengeResult = { ok: true } | { ok: false; reason: BotChallengeFailure };

/** The status a refused submission answers with: 400 when the guest's token is at fault, 503 when
 * the check could not be made or the instance is not set up for it. */
export function botChallengeFailureStatus(reason: BotChallengeFailure): 400 | 503 {
  switch (reason) {
    case "missing_token":
    case "rejected":
    case "wrong_host":
    case "wrong_binding":
      return 400;
    case "not_configured":
    case "secret_rejected":
    case "unavailable":
      return 503;
  }
}

/**
 * The `data-cdata` value of the widget for an event, and the value the verifier requires back.
 * Cloudflare allows letters, digits, `_` and `-` (up to 255); an event slug is lowercase letters,
 * digits, `_` and `-` up to 80 characters (the create-event schema), so the prefix keeps it valid.
 */
export function botChallengeCData(slug: string): string {
  return `reg-${slug}`;
}

export interface BotChallengeDeps {
  /** Injected in tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface BotChallengeInput {
  /** The token field of the request body, as parsed (anything). */
  token: unknown;
  /**
   * Host names a genuine challenge can have been solved on: the instance's own host and the
   * event's verified address. Build it with `resolveChallengeHosts`, from configuration only.
   * Never from the `Host` header of the request, which the sender controls: a check against it
   * would compare the answer with whatever the sender claimed.
   */
  expectedHosts: readonly string[];
  slug: string;
}

/** Lowercase host name without port, userinfo, path or a trailing dot. Null when it is not a host. */
function hostnameOf(raw: string): string | null {
  try {
    const host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase();
    const bare = host.endsWith(".") ? host.slice(0, -1) : host;
    return bare === "" ? null : bare;
  } catch {
    return null;
  }
}

/**
 * The host names a genuine challenge can have been solved on, from configuration: the instance URL
 * (the URL the app was started with, else `BASE_URL`, else the saved instance URL) and, when the
 * event has a verified address of its own (D-C6), that. Nothing here reads a request. Without a
 * usable instance URL its host is left out, so the check refuses instead of guessing.
 */
export async function resolveChallengeHosts(
  db: PrismaClient,
  options: { injectedBaseUrl?: string; eventHost?: string | null; env?: NodeJS.ProcessEnv } = {},
): Promise<string[]> {
  const hosts: string[] = [];
  try {
    const baseUrl = await resolveInstanceBaseUrl(db, options.env ?? process.env, options.injectedBaseUrl);
    const instanceHost = hostnameOf(baseUrl);
    if (instanceHost !== null) hosts.push(instanceHost);
  } catch {
    // No instance URL: the Health check says so, and the check below refuses.
  }
  const eventHost = options.eventHost ? hostnameOf(options.eventHost) : null;
  if (eventHost !== null) hosts.push(eventHost);
  return hosts;
}

function expectedHostSet(hosts: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (const host of hosts) {
    const name = hostnameOf(host);
    if (name !== null) set.add(name);
  }
  return set;
}

/** Cloudflare marks an answer given for one of its published test keys. Saved by mistake, such
 * keys close the form for everyone, which is an operator problem, not the guest's. */
function usesTestingKey(fields: Record<string, unknown>): boolean {
  const metadata = fields["metadata"];
  return (
    metadata !== null &&
    typeof metadata === "object" &&
    (metadata as Record<string, unknown>)["result_with_testing_key"] === true
  );
}

/** Codes that blame our secret, not the guest's token. */
const SECRET_ERROR_CODES = new Set(["missing-input-secret", "invalid-input-secret"]);
/** Codes that blame the service or our request, not the guest's token. */
const SERVICE_ERROR_CODES = new Set(["internal-error", "bad-request"]);

function errorCodes(data: Record<string, unknown>): string[] {
  const codes = data["error-codes"];
  return Array.isArray(codes) ? codes.filter((code): code is string => typeof code === "string") : [];
}

interface SiteverifyAnswer {
  ok: boolean;
  body: unknown;
}

/** One POST. Null when no answer came back at all; an answer whose body cannot be read has
 * `body: undefined` and is judged by the caller as "no usable answer". */
async function postSiteverify(
  secret: string,
  token: string,
  deps: BotChallengeDeps,
): Promise<SiteverifyAnswer | null> {
  const fetchFn = deps.fetch ?? fetch;
  try {
    const response = await fetchFn(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      // The secret is in the body: a redirect must never carry it to another host.
      redirect: "error",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        ...NO_COMPRESSION_HEADERS,
      },
      // No remoteip: the visitor's address stays out of what Cloudflare receives from the server.
      body: new URLSearchParams({ secret, response: token }).toString(),
      signal: AbortSignal.timeout(deps.timeoutMs ?? BOT_CHALLENGE_TIMEOUT_MS),
    });
    let body: unknown;
    try {
      body = await readJsonCapped(response, MAX_SITEVERIFY_RESPONSE_BYTES);
    } catch {
      body = undefined;
    }
    return { ok: response.ok, body };
  } catch {
    return null;
  }
}

function judge(answer: SiteverifyAnswer, hosts: Set<string>, cdata: string): BotChallengeResult {
  const data = answer.body;
  if (data === null || typeof data !== "object" || Array.isArray(data)) return { ok: false, reason: "unavailable" };
  const fields = data as Record<string, unknown>;
  if (typeof fields["success"] !== "boolean") return { ok: false, reason: "unavailable" };

  const codes = errorCodes(fields);
  if (codes.some((code) => SECRET_ERROR_CODES.has(code))) return { ok: false, reason: "secret_rejected" };
  // A non-2xx answer never passes, whatever its body says.
  if (!answer.ok || codes.some((code) => SERVICE_ERROR_CODES.has(code))) return { ok: false, reason: "unavailable" };
  if (usesTestingKey(fields)) return { ok: false, reason: "secret_rejected" };
  if (fields["success"] !== true) return { ok: false, reason: "rejected" };

  const hostname = fields["hostname"];
  if (typeof hostname !== "string") return { ok: false, reason: "unavailable" };
  if (!hosts.has(hostname.toLowerCase())) return { ok: false, reason: "wrong_host" };
  if (fields["cdata"] !== cdata) return { ok: false, reason: "wrong_binding" };
  return { ok: true };
}

/** Checks one token against Cloudflare with the given secret. No database. */
export async function verifyTurnstileToken(
  secret: string,
  input: BotChallengeInput,
  deps: BotChallengeDeps = {},
): Promise<BotChallengeResult> {
  const { token } = input;
  if (typeof token !== "string" || token === "") return { ok: false, reason: "missing_token" };
  if (token.length > MAX_BOT_CHALLENGE_TOKEN_LENGTH) return { ok: false, reason: "rejected" };

  const answer = await postSiteverify(secret, token, deps);
  if (answer === null) return { ok: false, reason: "unavailable" };
  return judge(answer, expectedHostSet(input.expectedHosts), botChallengeCData(input.slug));
}

/**
 * The check the registration routes call: loads the keys, and refuses without touching Cloudflare
 * when they are not both saved and readable.
 */
export async function verifyBotChallenge(
  db: TurnstileSettingsDb,
  input: BotChallengeInput,
  deps: BotChallengeDeps = {},
): Promise<BotChallengeResult> {
  // Read at every call, never cached: a rotated secret works at once, and replicas cannot differ.
  let keys: Awaited<ReturnType<typeof resolveTurnstileKeys>>;
  try {
    keys = await resolveTurnstileKeys(db);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (keys.state !== "ready") return { ok: false, reason: "not_configured" };
  return verifyTurnstileToken(keys.secret, input, deps);
}
