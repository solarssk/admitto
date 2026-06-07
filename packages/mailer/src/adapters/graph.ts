import type { GraphConfig } from "../config.js";
import type { FetchFn, MailMessage, MailerAdapter, SendResult } from "../types.js";

/**
 * Microsoft Graph — app-only send (client credentials flow).
 *
 * References:
 * - user: sendMail        https://learn.microsoft.com/en-us/graph/api/user-sendmail
 * - client credentials    https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow
 * - send from shared mbx  https://learn.microsoft.com/en-us/graph/outlook-send-mail-from-other-user
 *
 * Requires APPLICATION permission `Mail.Send` + admin consent. Recommended to scope
 * it to a single mailbox via Application Access Policy.
 */

interface CachedToken {
  accessToken: string;
  /** epoch ms when token expires (with safety margin). */
  expiresAt: number;
}

function recipients(list?: string) {
  if (!list) return [];
  return list
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
}

export class GraphAdapter implements MailerAdapter {
  readonly provider = "graph" as const;
  private token: CachedToken | null = null;

  constructor(
    private readonly config: GraphConfig,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  private get authority() {
    return `https://login.microsoftonline.com/${encodeURIComponent(this.config.tenantId)}`;
  }

  /** Fetches (or returns cached) app-only token. Throws on failure. */
  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now + 60_000) {
      return this.token.accessToken;
    }
    const res = await this.fetchFn(`${this.authority}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        scope: "https://graph.microsoft.com/.default",
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const code = String(data["error"] ?? `HTTP ${res.status}`);
      const desc = String(data["error_description"] ?? "").split("\n")[0];
      throw new Error(`Graph token error: ${code}${desc ? " — " + desc : ""}`);
    }
    const accessToken = String(data["access_token"] ?? "");
    const expiresIn = Number(data["expires_in"] ?? 3600);
    if (!accessToken) throw new Error("Graph token error: missing access_token in response");
    this.token = { accessToken, expiresAt: now + expiresIn * 1000 };
    return accessToken;
  }

  async send(message: MailMessage): Promise<SendResult> {
    const base: SendResult = {
      status: "failed",
      provider: this.provider,
      idempotencyKey: message.idempotencyKey,
    };
    let token: string;
    try {
      token = await this.getAccessToken();
    } catch (e) {
      return { ...base, error: e instanceof Error ? e.message : String(e) };
    }

    const graphMessage: Record<string, unknown> = {
      subject: message.subject,
      body: { contentType: "HTML", content: message.html },
      toRecipients: recipients(message.to),
    };
    if (message.cc) graphMessage["ccRecipients"] = recipients(message.cc);
    if (message.replyTo) graphMessage["replyTo"] = recipients(message.replyTo);

    const endpoint = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
      this.config.sender,
    )}/sendMail`;

    try {
      const res = await this.fetchFn(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: graphMessage,
          saveToSentItems: this.config.saveToSentItems,
        }),
      });

      // sendMail returns 202 Accepted with no body on success.
      if (res.status === 202) {
        const requestId = res.headers.get("request-id") ?? undefined;
        return {
          status: "sent",
          provider: this.provider,
          providerMessageId: requestId,
          idempotencyKey: message.idempotencyKey,
        };
      }

      const data = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      const code = data.error?.code ?? `HTTP ${res.status}`;
      const msg = data.error?.message ?? "";
      return { ...base, error: `Graph sendMail: ${code}${msg ? " — " + msg : ""}` };
    } catch (e) {
      return { ...base, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
