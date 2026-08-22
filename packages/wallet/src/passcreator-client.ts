import { NO_COMPRESSION_HEADERS } from "@admitto/shared";
import { emitSystemLog } from "@admitto/shared/system-log";
import { WalletProviderError } from "./types.js";
import type { WalletPassInput, WalletPassRegistrationStatus, WalletPassResult } from "./types.js";
import type { WalletPassProvider } from "./provider.js";
import { PASSCREATOR_DEFAULT_BASE_URL, type PassCreatorConfig } from "./passcreator-config.js";
import { toPassCreatorData } from "./passcreator-mapper.js";

/** Injectable fetch (for tests without real network). Defaults to global fetch. */
export type FetchFn = typeof fetch;

/** The 4 pass-lifecycle webhook events Admitto subscribes to and handles
 * (developer.passcreator.com/en/webhooks/pass-hooks) - pass_created/pass_updated exist too but
 * aren't subscribed, since we already know about creates/updates ourselves (we initiated them). */
export type PassCreatorWebhookEventType =
  | "first_pushnotification_registered"
  | "pushnotification_registered"
  | "pushnotification_unregistered"
  | "pass_voided";

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;

type PassCreatorEnvelope<T> = {
  success: boolean;
  errors?: string[];
  data?: T;
};

type PassCreatorPassData = {
  identifier: string;
  downloadPage?: string;
  iPhoneUri: string;
  androidUri: string;
};

type PassCreatorSearchRow = {
  identifier: string;
  userProvidedId?: string;
  downloadPage?: string;
  linkToPassPage?: string;
  iPhoneUri?: string;
  androidUri?: string;
  noOfActiveRegistrationsAppleWallet?: number;
  noOfInactiveRegistrationsAppleWallet?: number;
  noOfActiveRegistrationsGoogleWallet?: number;
  noOfInactiveRegistrationsGoogleWallet?: number;
  firstDownloadedAt?: string | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Single-line, length-capped preview of a response body for diagnostic error messages - never
 * the outgoing request (so never the API key), just what PassCreator sent back. */
function previewBody(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > 300 ? `${collapsed.slice(0, 300)}…` : collapsed;
}

/** Narrows an `errors` field of unknown shape (from a body we deliberately parse without a fixed
 * schema - see subscribeWebhook/listWebhooks below) down to the string[] toProviderError expects,
 * rather than trusting it and letting a non-array value (e.g. a bare string) throw inside
 * `.join()` instead of surfacing the intended WalletProviderError. */
function extractErrorStrings(errors: unknown): string[] | undefined {
  return Array.isArray(errors) ? errors.filter((error): error is string => typeof error === "string") : undefined;
}

function toResult(data: PassCreatorPassData): WalletPassResult {
  return {
    providerPassId: data.identifier,
    downloadUrl: data.downloadPage,
    appleUrl: data.iPhoneUri,
    androidUrl: data.androidUri,
  };
}

/**
 * HTTP client implementing WalletPassProvider for PassCreator (ADR 0009, ADR 0041).
 * Auth header confirmed live: `Authorization: <api_key>`, no "Bearer" prefix.
 */
export class PassCreatorClient implements WalletPassProvider {
  readonly provider = "passcreator";

  private readonly apiKey: string;
  private readonly templateId: string;
  private readonly baseUrl: string;
  private readonly fieldMapping?: Record<string, string>;
  private readonly fetchFn: FetchFn;

  constructor(config: PassCreatorConfig, fetchFn: FetchFn = fetch) {
    const baseUrl = config.baseUrl ?? PASSCREATOR_DEFAULT_BASE_URL;
    // Defense in depth: every application caller already resolves baseUrl through a path that
    // rejects a non-HTTPS override (resolvePassCreatorBaseUrl in apps/web/src/config.ts), but this
    // client sends the API key in a plain Authorization header - a future caller (or a test) that
    // skips that resolver must not be able to leak the key over plaintext by construction.
    if (!baseUrl.startsWith("https://")) {
      throw new Error(`PassCreatorClient: baseUrl must be HTTPS, got "${baseUrl}"`);
    }
    this.apiKey = config.apiKey;
    this.templateId = config.templateId;
    this.baseUrl = baseUrl;
    this.fieldMapping = config.fieldMapping;
    this.fetchFn = fetchFn;
  }

  async createPass(input: WalletPassInput): Promise<WalletPassResult> {
    const envelope = await this.request<PassCreatorPassData>(
      "POST",
      "/api/v3/pass?async=false",
      { data: toPassCreatorData(input, this.templateId, this.fieldMapping, true) },
    );
    return toResult(envelope);
  }

  async updatePass(providerPassId: string, input: WalletPassInput): Promise<WalletPassResult> {
    const envelope = await this.request<PassCreatorPassData>(
      "PATCH",
      `/api/v3/pass/${encodeURIComponent(providerPassId)}`,
      { data: toPassCreatorData(input, this.templateId, this.fieldMapping, false) },
    );
    return toResult(envelope);
  }

  /**
   * Sends a custom, attendee-visible push notification via the v3 bulk-update endpoint's
   * `pushNotificationText` field (developer.passcreator.com/en/api/v3/pass), passing
   * `filter.identifiers` even for a single recipient - the per-pass `sendpushnotification`
   * endpoint lives on API v1, which PassCreator's own docs mark deprecated for new integrations
   * (ADR 0041 §2.2), so we never use it here regardless of recipient count.
   *
   * PassCreator processes a bulk update asynchronously (202 + a `process` tracking URL in the
   * response) - this only confirms PassCreator accepted the request, not that every device has
   * actually shown the notification. The `process` status response shape isn't documented
   * anywhere found so far, so it isn't polled here; needs live confirmation before this can
   * report actual delivery outcome instead of just "accepted".
   */
  async sendPushMessage(providerPassIds: string[], text: string): Promise<void> {
    await this.request<{ process?: string }>("PATCH", "/api/v3/pass/bulk", {
      data: { pushNotificationText: text },
      filter: { identifiers: providerPassIds },
    });
  }

  async voidPass(passUid: string): Promise<void> {
    await this.setVoided(passUid, true);
  }

  async restorePass(passUid: string): Promise<void> {
    await this.setVoided(passUid, false);
  }

  /** Idempotent (ADR 0041 §3): a pass already gone (404) counts as deleted, not an error. */
  async deletePass(providerPassId: string): Promise<void> {
    const path = `/api/v3/pass/${encodeURIComponent(providerPassId)}`;
    const res = await this.requestRaw("DELETE", path);
    const ok = res.ok || res.status === 404;
    this.logOutcome("DELETE", path, ok, res.status);
    if (!ok) {
      throw this.toProviderError(res.status);
    }
  }

  /**
   * Probes the API key + template ID pair for "Test connection" (Event Settings -> Wallet).
   * Uses the v2 template-read endpoint (v3 has no template-management operations - ADR 0041 §3),
   * assumed to share v3's {success, data, errors} envelope shape pending live confirmation.
   */
  async describeTemplate(): Promise<{ name: string | null }> {
    const data = await this.request<{ name?: string }>(
      "GET",
      `/api/v2/pass-template/${encodeURIComponent(this.templateId)}/describe`,
    );
    return { name: data.name ?? null };
  }

  /** PEM-formatted public key used to verify a signed webhook payload
   * (developer.passcreator.com/en/signatures/verify-a-signature).
   *
   * CONFIRMED LIVE (2026-08-19, via a direct probe from the running container - see
   * wallet_webhook_public_key_fetch_failed in prod logs for the failures this fixes): `GET
   * /api/hook/publickey` returns 200 with a bare top-level `{"publicKey": "-----BEGIN PUBLIC
   * KEY-----\n...\n-----END PUBLIC KEY-----\n"}` - not the usual v3 `{success, data, errors}`
   * envelope, and not `data.publicKey` either. Both of those were unconfirmed guesses (as was a
   * raw-PEM-text response) that this endpoint never actually returns. */
  async getWebhookPublicKey(): Promise<string> {
    const path = "/api/hook/publickey";
    const res = await this.requestRaw("GET", path);
    const text = await res.text();
    if (!res.ok) {
      this.logOutcome("GET", path, false, res.status);
      throw this.toProviderError(res.status, [previewBody(text)]);
    }
    let pem: unknown;
    try {
      pem = (JSON.parse(text) as { publicKey?: unknown }).publicKey;
    } catch {
      // Fall through to the error below.
    }
    if (typeof pem === "string" && pem.includes("-----BEGIN PUBLIC KEY-----")) {
      this.logOutcome("GET", path, true, res.status);
      return pem.trim();
    }
    this.logOutcome("GET", path, false, res.status);
    throw this.toProviderError(502, [
      `Public key missing or unrecognized shape in response: ${previewBody(text)}`,
    ]);
  }

  /** Subscribes `targetUrl` to receive one webhook event type for this template
   * (developer.passcreator.com/en/webhooks/webhook-endpoints). Call once per event type - the
   * endpoint doesn't document a way to subscribe to several at once. NOT idempotent: PassCreator
   * creates a separate subscription entry per call, even for an identical (templateId, targetUrl,
   * event) triple - callers must check listWebhooks() first, this endpoint won't dedupe for them.
   *
   * Uses requestRaw + res.ok (like setVoided/deletePass below), not the shared request() helper -
   * live testing (2026-08-13) found this endpoint returns HTTP 201 with a body that doesn't match
   * the v3 {success,data,errors} envelope request() requires, so every call looked like a failure
   * to us even though PassCreator's own dashboard confirmed the subscription was created. Still
   * checks the body for an explicit `success: false` - a 2xx status alone doesn't rule out a
   * logical failure PassCreator reported in the body (CodeRabbit review). */
  async subscribeWebhook(targetUrl: string, event: PassCreatorWebhookEventType): Promise<void> {
    const path = `/api/hook/subscribe/${encodeURIComponent(this.templateId)}`;
    const res = await this.requestRaw(
      "POST",
      path,
      { target_url: targetUrl, event, signPayload: true, retryEnabled: true },
    );
    if (!res.ok) {
      this.logOutcome("POST", path, false, res.status);
      throw this.toProviderError(res.status);
    }
    const body: unknown = await res.json().catch(() => null);
    const bodyFailed = body && typeof body === "object" && (body as { success?: unknown }).success === false;
    this.logOutcome("POST", path, !bodyFailed, res.status);
    if (bodyFailed) {
      throw this.toProviderError(res.status, extractErrorStrings((body as { errors?: unknown }).errors));
    }
  }

  /** Removes every subscription (across all event types and templates) tied to `targetUrl`
   * (developer.passcreator.com/en/webhooks/webhook-endpoints, confirmed 2026-08-19): `POST
   * /api/hook/unsubscribe` with just `{target_url}` in the body - no templateId in the path (unlike
   * subscribeWebhook) and no `event` field, because it isn't scoped to one event: it deletes the
   * whole registration for that URL. There's no way to remove a single (targetUrl, event) pair
   * without taking every other event on that same URL down with it - callers that share one
   * targetUrl across several event types must account for that before calling this. */
  async unsubscribeWebhook(targetUrl: string): Promise<void> {
    const path = "/api/hook/unsubscribe";
    const res = await this.requestRaw("POST", path, { target_url: targetUrl });
    if (!res.ok) {
      this.logOutcome("POST", path, false, res.status);
      throw this.toProviderError(res.status);
    }
    const body: unknown = await res.json().catch(() => null);
    const bodyFailed = body && typeof body === "object" && (body as { success?: unknown }).success === false;
    this.logOutcome("POST", path, !bodyFailed, res.status);
    if (bodyFailed) {
      throw this.toProviderError(res.status, extractErrorStrings((body as { errors?: unknown }).errors));
    }
  }

  /** Every currently active webhook subscription across the whole PassCreator account
   * (developer.passcreator.com/en/webhooks/webhook-endpoints "List Active Hooks") - not scoped to
   * this client's own templateId, so callers must filter by passTemplate themselves. Used to check
   * for an existing (passTemplate, targetUrl, event) subscription before calling subscribeWebhook,
   * since that endpoint creates a duplicate rather than deduping.
   *
   * Parses the response defensively rather than through the shared request() helper, for the same
   * reason as subscribeWebhook above: this endpoint's exact envelope shape on success isn't
   * confirmed (unlike v3 endpoints), and request()'s strict `data !== undefined` check turned a
   * real HTTP 200 success into a thrown error here too. Accepts a bare array, a v3-style
   * `{data: [...]}` wrapper, or any other successful shape (falls back to an empty list rather
   * than guessing wrong) - but a body that explicitly reports `success: false` still throws, so a
   * genuine documented failure isn't swallowed. */
  async listWebhooks(): Promise<
    { targetUrl: string | null; event: string; passTemplate: string | null }[]
  > {
    const path = "/api/hook/list";
    const res = await this.requestRaw("GET", path);
    if (!res.ok) {
      this.logOutcome("GET", path, false, res.status);
      throw this.toProviderError(res.status);
    }
    const body: unknown = await res.json().catch(() => null);
    const bodyFailed = body && typeof body === "object" && (body as { success?: unknown }).success === false;
    this.logOutcome("GET", path, !bodyFailed, res.status);
    if (bodyFailed) {
      throw this.toProviderError(res.status, extractErrorStrings((body as { errors?: unknown }).errors));
    }
    const data =
      body && typeof body === "object" && "data" in body ? (body as { data: unknown }).data : body;
    const rows = Array.isArray(data) ? data : [];
    // Each row is also of unknown shape - a row that isn't an object (or is missing a field) must
    // fall back to a default rather than throw, same reasoning as the success:false check above
    // (CodeRabbit review).
    return rows
      .filter((row): row is Record<string, unknown> => row !== null && typeof row === "object")
      .map((row) => ({
        targetUrl: typeof row.target_url === "string" ? row.target_url : null,
        event: typeof row.event === "string" ? row.event : "",
        passTemplate: typeof row.pass_template === "string" ? row.pass_template : null,
      }));
  }

  async findByUserProvidedId(userProvidedId: string): Promise<WalletPassResult | null> {
    const row = await this.searchByUserProvidedId(userProvidedId);
    if (!row) return null;
    return {
      providerPassId: row.identifier,
      downloadUrl: row.downloadPage ?? row.linkToPassPage,
      appleUrl: row.iPhoneUri ?? "",
      androidUrl: row.androidUri ?? "",
    };
  }

  /** Polled by the wallet-sync worker job (apps/cli), not on any request path. */
  async getRegistrationStatus(userProvidedId: string): Promise<WalletPassRegistrationStatus | null> {
    const row = await this.searchByUserProvidedId(userProvidedId);
    if (!row) return null;
    return {
      appleActiveRegistrations: row.noOfActiveRegistrationsAppleWallet ?? 0,
      appleInactiveRegistrations: row.noOfInactiveRegistrationsAppleWallet ?? 0,
      googleActiveRegistrations: row.noOfActiveRegistrationsGoogleWallet ?? 0,
      googleInactiveRegistrations: row.noOfInactiveRegistrationsGoogleWallet ?? 0,
      firstDownloadedAt: row.firstDownloadedAt ?? null,
    };
  }

  /** Shared by findByUserProvidedId and getRegistrationStatus - same search endpoint, different
   * fields of the same row.
   *
   * Uses the documented Query Language (developer.passcreator.com/en/api/v3/query-language) via
   * the base64url-encoded `query` parameter, not the plain `?userProvidedId=` shorthand - live
   * testing (2026-08-13) found that shorthand does NOT filter at all (it returns every pass under
   * the account/template regardless of the value queried, newest-created first - `rows[0]` was
   * silently wrong for anything but the single most-recently-created pass). The query-language
   * `equals` filter was verified live to correctly return exactly one matching row
   * (resultsTotal: 1) regardless of how many other passes exist, so it scales correctly instead of
   * depending on the true match happening to land within whatever page a naive list call returns.
   * The row's own echoed userProvidedId is still checked against the query as defense in depth,
   * not because the filter is expected to misbehave.
   *
   * Each filter object also sets `type: "text"`, matching the example PassCreator support sent us
   * when we reported the shorthand-search bug above - not documented as a required property in the
   * query-language reference's own JSON Schema (which only requires field/operator/value), but
   * included here to match their example exactly. */
  private async searchByUserProvidedId(userProvidedId: string): Promise<PassCreatorSearchRow | null> {
    const query = {
      templateId: this.templateId,
      groups: [[{ field: "userProvidedId", operator: "equals", type: "text", value: [userProvidedId] }]],
    };
    const encoded = Buffer.from(JSON.stringify(query)).toString("base64url");
    const rows = await this.request<PassCreatorSearchRow[]>("GET", `/api/v3/pass?query=${encoded}`);
    const row = rows.find((r) => r.userProvidedId === userProvidedId);
    if (!row) {
      console.error(
        `PassCreator query-language search returned no row matching userProvidedId=${userProvidedId} (received ${rows.length} row(s))`,
      );
      return null;
    }
    return row;
  }

  /** Void/restore uses a separate, non-v3 endpoint (ADR 0041 §3) and returns 204, no body. */
  private async setVoided(passUid: string, voided: boolean): Promise<void> {
    const path = `/api/pass/${encodeURIComponent(passUid)}`;
    const res = await this.requestRaw("PUT", path, { voided });
    this.logOutcome("PUT", path, res.ok, res.status);
    if (!res.ok) {
      throw this.toProviderError(res.status);
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.requestRaw(method, path, body);
    let envelope: PassCreatorEnvelope<T>;
    try {
      envelope = (await res.json()) as PassCreatorEnvelope<T>;
    } catch {
      // Non-JSON body (e.g. an upstream proxy's HTML 502 page) - map by HTTP status instead of
      // letting the raw SyntaxError escape and break the documented WalletProviderError contract.
      this.logOutcome(method, path, false, res.status);
      throw this.toProviderError(res.status);
    }
    if (!envelope.success || envelope.data === undefined) {
      this.logOutcome(method, path, false, res.status);
      throw this.toProviderError(res.status, envelope.errors);
    }
    this.logOutcome(method, path, true, res.status);
    return envelope.data;
  }

  /** Logs a PassCreator operation's fully-validated outcome - each call site reports its own
   * true/false after checking the operation-specific response shape (a 2xx envelope can still
   * carry `success: false`, and deletePass treats 404 as a successful idempotent delete), rather
   * than requestRaw guessing purely from Response.ok, which misclassified both of those cases
   * (bot review). Only failures are actually relayed: an event-wide wallet push can call this
   * once per attendee (hundreds per job), and relaying every routine success risked bursting past
   * the ops-ingest endpoint's 120/min-per-IP rate limit and dropping the failures alongside them
   * (bot review) - the worker's own per-job "ok claimed=X succeeded=Y failed=Z" summary (see
   * apps/cli/src/commands/worker.ts) already gives aggregate success visibility without the
   * per-item volume. Logs only the route (query string stripped: the search endpoint encodes an
   * attendee's userProvidedId into it), never the request/response body. */
  private logOutcome(method: string, path: string, ok: boolean, status: number): void {
    if (ok) return;
    const route = path.split("?")[0];
    emitSystemLog("wallet", "warn", "passcreator_request_rejected", { method, route, status });
  }

  /** Issues one request with 429 exponential backoff; throws WalletProviderError on final failure.
   * The single choke point every PassCreator operation (issue/void/push/search/webhook key fetch)
   * goes through, so the network-failure and rate-limit-exhausted logging here - unlike the
   * per-operation outcome, see logOutcome above - covers every call site in one place; those two
   * cases are failures regardless of what the caller would have done with a response. */
  private async requestRaw(method: string, path: string, body?: unknown): Promise<Response> {
    const route = path.split("?")[0];
    let lastRes: Response | undefined;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let res: Response;
      try {
        res = await this.fetchFn(`${this.baseUrl}${path}`, {
          method,
          headers: {
            Authorization: this.apiKey,
            ...NO_COMPRESSION_HEADERS,
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch (err) {
        emitSystemLog("wallet", "warn", "passcreator_request_failed", {
          method,
          route,
          error: err instanceof Error ? err.message : String(err),
        });
        throw new WalletProviderError(
          "wallet_provider_timeout",
          `PassCreator request failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      if (res.status !== 429) return res;

      lastRes = res;
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
      }
    }
    emitSystemLog("wallet", "error", "passcreator_request_rate_limited", { method, route, attempts: MAX_RETRIES + 1 });
    throw this.toProviderError(lastRes?.status ?? 429, ["Rate limited"]);
  }

  private toProviderError(status: number, errors?: string[]): WalletProviderError {
    const message = errors?.join("; ") || `PassCreator request failed with status ${status}`;
    if (status === 401 || status === 403) {
      return new WalletProviderError("wallet_provider_unauthorized", message);
    }
    if (status === 429) {
      return new WalletProviderError("wallet_provider_rate_limited", message);
    }
    if (status === 404) {
      return new WalletProviderError("wallet_provider_not_found", message);
    }
    if (status === 400 && /unique|already exists|duplicate/i.test(message)) {
      return new WalletProviderError("wallet_provider_duplicate", message);
    }
    return new WalletProviderError("wallet_provider_rejected", message);
  }
}
