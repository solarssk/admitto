import type { GraphConfig } from "../config.js";
import { GRAPH_CAPABILITIES } from "../capabilities.js";
import { mapHttpStatus, mapNetworkError } from "../errorMapping.js";
import {
  graphDisplayFromAddress,
  graphRecipients,
  resolveReplyTo,
  shouldSetGraphMessageFrom,
} from "../senderUtils.js";
import { rejectedSendResult } from "../adapterUtils.js";
import { validateMailMessage } from "../validation.js";
import type { FetchFn, MailMessage, MailerAdapter, SendResult } from "../types.js";
import { emitSystemLog } from "@admitto/shared/system-log";
import { redactEmail } from "@admitto/shared";

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

export class GraphAdapter implements MailerAdapter {
  readonly provider = "graph" as const;
  readonly capabilities = GRAPH_CAPABILITIES;
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
    let res: Response;
    try {
      res = await this.fetchFn(`${this.authority}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          scope: "https://graph.microsoft.com/.default",
        }),
      });
    } catch (e) {
      const mapped = mapNetworkError();
      throw new TokenError(
        `Graph token error: ${e instanceof Error ? e.message : String(e)}`,
        mapped,
      );
    }
    const raw = await res.text().catch(() => "");
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) {
      const mapped = mapHttpStatus(res.status);
      const errorField = data["error"];
      const code = typeof errorField === "string" ? errorField : `HTTP ${res.status}`;
      const errorDescriptionField = data["error_description"];
      const desc =
        typeof errorDescriptionField === "string" ? errorDescriptionField.split("\n")[0] : "";
      const detail = desc || raw.slice(0, 200);
      throw new TokenError(`Graph token error: ${code}${detail ? " — " + detail : ""}`, mapped);
    }
    const accessTokenField = data["access_token"];
    const accessToken = typeof accessTokenField === "string" ? accessTokenField : "";
    const expiresIn = Number(data["expires_in"] ?? 3600);
    if (!accessToken) throw new Error("Graph token error: missing access_token in response");
    this.token = { accessToken, expiresAt: now + expiresIn * 1000 };
    return accessToken;
  }

  async close(): Promise<void> {
    return Promise.resolve();
  }

  async send(message: MailMessage): Promise<SendResult> {
    const validationError = validateMailMessage(message);
    if (validationError) {
      return rejectedSendResult(this.provider, validationError, message.idempotencyKey);
    }

    const base: SendResult = {
      status: "failed",
      provider: this.provider,
      idempotencyKey: message.idempotencyKey,
    };

    const tokenResult = await this.acquireToken(base);
    if (!tokenResult.ok) {
      emitSystemLog("mail", "error", "mail_send_failed", { provider: this.provider, error: tokenResult.result.error });
      return tokenResult.result;
    }

    const graphMessage = this.buildGraphMessage(message);
    const endpoint = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
      this.config.mailbox,
    )}/sendMail`;

    try {
      const res = await this.fetchFn(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokenResult.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: graphMessage,
          saveToSentItems: this.config.saveToSentItems,
        }),
      });

      if (res.status === 202) {
        const requestId = res.headers.get("request-id") ?? undefined;
        emitSystemLog("mail", "info", "mail_sent", { provider: this.provider, to: redactEmail(message.to) });
        return {
          status: "accepted",
          provider: this.provider,
          providerMessageId: requestId,
          idempotencyKey: message.idempotencyKey,
        };
      }

      const errorResult = await this.buildSendErrorResult(base, res);
      emitSystemLog("mail", "error", "mail_send_failed", { provider: this.provider, error: errorResult.error });
      return errorResult;
    } catch (e) {
      const mapped = mapNetworkError();
      const error = e instanceof Error ? e.message : String(e);
      emitSystemLog("mail", "error", "mail_send_failed", { provider: this.provider, error });
      return {
        ...base,
        status: mapped.status,
        retryable: mapped.retryable,
        error,
      };
    }
  }

  /** Resolves an access token for `send`, translating failures into a terminal SendResult. */
  private async acquireToken(
    base: SendResult,
  ): Promise<{ ok: true; token: string } | { ok: false; result: SendResult }> {
    try {
      const token = await this.getAccessToken();
      return { ok: true, token };
    } catch (e) {
      if (e instanceof TokenError) {
        return {
          ok: false,
          result: {
            ...base,
            status: e.mapped.status,
            retryable: e.mapped.retryable,
            error: e.message,
          },
        };
      }
      return { ok: false, result: { ...base, error: e instanceof Error ? e.message : String(e) } };
    }
  }

  /** Builds the Graph API message payload (recipients, reply-to, from) for `send`. */
  private buildGraphMessage(message: MailMessage): Record<string, unknown> {
    const graphMessage: Record<string, unknown> = {
      subject: message.subject,
      body: { contentType: "HTML", content: message.html },
      toRecipients: graphRecipients(message.to),
    };
    if (message.cc) graphMessage["ccRecipients"] = graphRecipients(message.cc);

    const replyTo = resolveReplyTo(this.config.replyTo, message);
    if (replyTo) graphMessage["replyTo"] = graphRecipients(replyTo);

    if (shouldSetGraphMessageFrom(this.config)) {
      const address = graphDisplayFromAddress(this.config);
      const from: { emailAddress: { address: string; name?: string } } = {
        emailAddress: { address },
      };
      if (this.config.fromName) from.emailAddress.name = this.config.fromName;
      graphMessage["from"] = from;
    }

    return graphMessage;
  }

  /** Maps a non-202 sendMail response into a terminal SendResult for `send`. */
  private async buildSendErrorResult(base: SendResult, res: Response): Promise<SendResult> {
    const rawBody = await res.text().catch(() => "");
    let errData: { error?: { code?: string; message?: string } } = {};
    try {
      errData = JSON.parse(rawBody) as typeof errData;
    } catch {
      /* non-JSON body */
    }
    const code = errData.error?.code ?? `HTTP ${res.status}`;
    const msg = errData.error?.message ?? rawBody.slice(0, 200);
    const mapped = mapHttpStatus(res.status);
    return {
      ...base,
      status: mapped.status,
      retryable: mapped.retryable,
      error: `Graph sendMail: ${code}${msg ? " — " + msg : ""}`,
    };
  }
}

class TokenError extends Error {
  constructor(
    message: string,
    readonly mapped: { status: "failed" | "rejected"; retryable: boolean },
  ) {
    super(message);
    this.name = "TokenError";
  }
}
