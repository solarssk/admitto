import type { LookupAddress } from "node:dns";
import { decryptFromString } from "@admitto/crypto";
import type { Prisma, PrismaClient } from "@admitto/db";
import { withPinnedFetch } from "@admitto/mailer";
import { sanitizeDeliveryError } from "@admitto/mail-delivery";
import {
  isBlockedPrivateOrMetadataHost,
  isLoopbackHost,
  resolveSafeHostname,
  unbracketHostname,
} from "@admitto/shared/ssrf-guard";
import type { NotificationChannel, NotificationSendResult } from "../channel.js";
import type { DispatchedNotification } from "../types.js";
import { SEVERITY_COLOR } from "./emailTemplate.js";

type Db = PrismaClient | Prisma.TransactionClient;
export type WebhookKind = "discord" | "slack" | "generic";

export interface WebhookChannelOptions {
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
}

const GENERIC_SEND_FAILED = "Webhook send failed.";

class BlockedWebhookUrlError extends Error {}

/** Same SSRF posture as packages/auth/src/oidc/safe-url.ts's assertSafeOidcFetchUrl — HTTPS
 * required (loopback+HTTP allowed outside production for local testing), private/link-local/
 * metadata hosts blocked (ADR 0016 SEC-1). No allowlist: unlike OIDC/mail, a self-hosted
 * private-network webhook target is not an expected use case for Discord/Slack/generic alerts. */
function assertSafeWebhookUrl(urlString: string, env: NodeJS.ProcessEnv): URL {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new BlockedWebhookUrlError("Webhook URL is invalid.");
  }

  const hostname = unbracketHostname(url.hostname);
  const loopback = isLoopbackHost(hostname);
  const allowHttpLoopback = env["NODE_ENV"] !== "production";

  if (url.protocol !== "https:" && !(allowHttpLoopback && loopback && url.protocol === "http:")) {
    throw new BlockedWebhookUrlError("Webhook URL must use HTTPS.");
  }
  if (loopback && allowHttpLoopback && url.protocol === "http:") return url;
  if (loopback || isBlockedPrivateOrMetadataHost(hostname)) {
    throw new BlockedWebhookUrlError("Webhook URL must not target a private or link-local address.");
  }
  return url;
}

function hexToDecimalColor(hex: string): number {
  return Number.parseInt(hex.replace("#", ""), 16);
}

function buildPayload(kind: WebhookKind, event: DispatchedNotification): Record<string, unknown> {
  switch (kind) {
    case "discord":
      return {
        embeds: [
          {
            title: event.title,
            description: event.body,
            color: hexToDecimalColor(SEVERITY_COLOR[event.severity]),
            fields: buildMetadataFields(event.metadata),
          },
        ],
      };
    case "slack":
      return {
        text: `*${event.title}*\n${event.body}`,
      };
    case "generic":
    default:
      return {
        type: event.type,
        severity: event.severity,
        title: event.title,
        body: event.body,
        metadata: event.metadata ?? {},
      };
  }
}

function buildMetadataFields(
  metadata: Record<string, unknown> | undefined,
): Array<{ name: string; value: string; inline: boolean }> {
  if (!metadata) return [];
  return Object.entries(metadata)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => ({ name: key, value: String(value), inline: true }));
}

/**
 * Generic webhook delivery (Discord/Slack/generic — ADR 0044 §1, generalizes ADR 0038's
 * Discord-only design). One team-wide URL per organization, sent once per notify() call
 * regardless of how many candidates resolved — `recipientUserIds` is unused here.
 */
export class WebhookChannel implements NotificationChannel {
  readonly channel = "webhook" as const;

  constructor(
    private readonly db: Db,
    private readonly options: WebhookChannelOptions = {},
  ) {}

  async send(
    event: DispatchedNotification,
    _recipientUserIds: string[],
  ): Promise<NotificationSendResult> {
    const env = this.options.env ?? process.env;
    try {
      const settings = await this.db.notificationSettings.findUnique({
        where: { scope_type_scope_id: { scope_type: "organization", scope_id: event.organizationId } },
        select: { webhook_url_enc: true, webhook_kind: true },
      });
      if (!settings?.webhook_url_enc) return { ok: true };

      const rawUrl = decryptFromString(settings.webhook_url_enc);
      const url = assertSafeWebhookUrl(rawUrl, env);
      const kind = (settings.webhook_kind as WebhookKind | null) ?? "generic";

      const hostname = unbracketHostname(url.hostname);
      const records: LookupAddress[] = isLoopbackHost(hostname)
        ? [{ address: hostname, family: hostname.includes(":") ? 6 : 4 }]
        : await resolveSafeHostname(hostname);

      const payload = buildPayload(kind, event);
      const status = await withPinnedFetch(
        url,
        hostname,
        records,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
        async (res) => res.status,
      );

      if (status < 200 || status >= 300) {
        return { ok: false, error: `Webhook target responded with HTTP ${status}.` };
      }
      return { ok: true };
    } catch (err) {
      if (err instanceof BlockedWebhookUrlError) {
        return { ok: false, error: err.message };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: sanitizeDeliveryError(message) ?? GENERIC_SEND_FAILED };
    }
  }
}
