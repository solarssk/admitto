import { WalletProviderError } from "./types.js";
import type { WalletPassInput, WalletPassRegistrationStatus, WalletPassResult } from "./types.js";
import type { WalletPassProvider } from "./provider.js";
import { PASSCREATOR_DEFAULT_BASE_URL, type PassCreatorConfig } from "./passcreator-config.js";
import { toPassCreatorData } from "./passcreator-mapper.js";

/** Injectable fetch (for tests without real network). Defaults to global fetch. */
export type FetchFn = typeof fetch;

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
    this.apiKey = config.apiKey;
    this.templateId = config.templateId;
    this.baseUrl = config.baseUrl ?? PASSCREATOR_DEFAULT_BASE_URL;
    this.fieldMapping = config.fieldMapping;
    this.fetchFn = fetchFn;
  }

  async createPass(input: WalletPassInput): Promise<WalletPassResult> {
    const envelope = await this.request<PassCreatorPassData>(
      "POST",
      "/api/v3/pass?async=false",
      { data: toPassCreatorData(input, this.templateId, this.fieldMapping) },
    );
    return toResult(envelope);
  }

  async updatePass(providerPassId: string, input: WalletPassInput): Promise<WalletPassResult> {
    const envelope = await this.request<PassCreatorPassData>(
      "PATCH",
      `/api/v3/pass/${encodeURIComponent(providerPassId)}`,
      { data: toPassCreatorData(input, this.templateId, this.fieldMapping) },
    );
    return toResult(envelope);
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
   * fields of the same row. */
  private async searchByUserProvidedId(userProvidedId: string): Promise<PassCreatorSearchRow | null> {
    const rows = await this.request<PassCreatorSearchRow[]>(
      "GET",
      `/api/v3/pass?userProvidedId=${encodeURIComponent(userProvidedId)}`,
    );
    return rows[0] ?? null;
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
