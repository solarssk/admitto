import { NO_COMPRESSION_HEADERS } from "@admitto/shared";
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
    const res = await this.requestRaw("DELETE", `/api/v3/pass/${encodeURIComponent(providerPassId)}`);
    if (!res.ok && res.status !== 404) {
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
   * (developer.passcreator.com/en/signatures/verify-a-signature). Response shape is not confirmed
   * by a concrete documented example - could be raw PEM text, or PEM wrapped in the usual
   * {success, data, errors} envelope (as `data` directly or `data.publicKey`) like every other
   * endpoint. Handles all three defensively rather than assuming one; needs live confirmation,
   * see the wallet webhook task list. */
  async getWebhookPublicKey(): Promise<string> {
    const res = await this.requestRaw("GET", "/api/hook/publickey");
    const text = await res.text();
    if (!res.ok) throw this.toProviderError(res.status);
    const trimmed = text.trim();
    // JSON envelope first - a raw-PEM response never starts with "{", so this only matches the
    // envelope case, not a JSON-encoded string that happens to contain a PEM block somewhere.
    if (trimmed.startsWith("{")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        const data = (parsed as { data?: unknown }).data;
        const pem = typeof data === "string" ? data : (data as { publicKey?: string } | undefined)?.publicKey;
        if (typeof pem === "string" && pem.includes("-----BEGIN PUBLIC KEY-----")) return pem.trim();
      } catch {
        // Fall through to the error below.
      }
    } else if (trimmed.startsWith("-----BEGIN PUBLIC KEY-----")) {
      return trimmed;
    }
    throw this.toProviderError(502, ["Public key missing or unrecognized shape in response"]);
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
    const res = await this.requestRaw(
      "POST",
      `/api/hook/subscribe/${encodeURIComponent(this.templateId)}`,
      { target_url: targetUrl, event, signPayload: true, retryEnabled: true },
    );
    if (!res.ok) {
      throw this.toProviderError(res.status);
    }
    const body: unknown = await res.json().catch(() => null);
    if (body && typeof body === "object" && (body as { success?: unknown }).success === false) {
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
    const res = await this.requestRaw("GET", "/api/hook/list");
    if (!res.ok) {
      throw this.toProviderError(res.status);
    }
    const body: unknown = await res.json().catch(() => null);
    if (body && typeof body === "object" && (body as { success?: unknown }).success === false) {
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
   * not because the filter is expected to misbehave. */
  private async searchByUserProvidedId(userProvidedId: string): Promise<PassCreatorSearchRow | null> {
    const query = {
      templateId: this.templateId,
      groups: [[{ field: "userProvidedId", operator: "equals", value: [userProvidedId] }]],
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
    const res = await this.requestRaw("PUT", `/api/pass/${encodeURIComponent(passUid)}`, { voided });
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
      throw this.toProviderError(res.status);
    }
    if (!envelope.success || envelope.data === undefined) {
      throw this.toProviderError(res.status, envelope.errors);
    }
    return envelope.data;
  }

  /** Issues one request with 429 exponential backoff; throws WalletProviderError on final failure. */
  private async requestRaw(method: string, path: string, body?: unknown): Promise<Response> {
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
