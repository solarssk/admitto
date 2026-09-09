import type { LookupAddress } from "node:dns";
import { decryptFromString } from "@admitto/crypto";
import type { PrismaClient } from "@admitto/db";
import { withPinnedFetch } from "@admitto/mailer";
import { sanitizeDeliveryError } from "@admitto/mail-delivery";
import {
  awaitWithAbortSignal,
  isBlockedPrivateOrMetadataHost,
  isLoopbackHost,
  resolveSafeHostname,
  unbracketHostname,
} from "@admitto/shared/ssrf-guard";
import type { NotificationChannel, NotificationSendResult } from "../channel.js";
import type { DispatchedNotification } from "../types.js";
import { SEVERITY_COLOR } from "./emailTemplate.js";

// Never Prisma.TransactionClient - see the Db comment in ../dispatcher.ts.
type Db = PrismaClient;
export type WebhookKind = "discord" | "slack" | "generic";

export interface WebhookChannelOptions {
  env?: NodeJS.ProcessEnv;
  /** Bounds DNS resolution + the POST itself, same value/pattern as packages/mailer's own
   * outbound calls (MAIL_PROBE_TIMEOUT_MS, GraphAdapter). Without this, a webhook target that
   * accepts the connection and then stalls leaves notify() pending indefinitely - dispatchToChannels
   * awaits the webhook before ever resolving email/in-app, so a stuck team webhook silently blocks
   * every other channel from receiving the same security alert. Override for tests. */
  timeoutMs?: number;
}

export const WEBHOOK_SEND_TIMEOUT_MS = 15_000;

const GENERIC_SEND_FAILED = "Webhook send failed.";

export class BlockedWebhookUrlError extends Error {}

/** Same SSRF posture as packages/auth/src/oidc/safe-url.ts's assertSafeOidcFetchUrl - HTTPS
 * required (loopback+HTTP allowed outside production for local testing), private/link-local/
 * metadata hosts blocked (ADR 0016 SEC-1). No allowlist: unlike OIDC/mail, a self-hosted
 * private-network webhook target is not an expected use case for Discord/Slack/generic alerts.
 * Exported so the Settings route can reject an obviously bad/blocked URL at save time - the DNS
 * re-check at actual send time (WebhookChannel.send()) still stands, since a save-time-valid host
 * could resolve differently later (rebinding), but early feedback beats a silent later failure. */
export function assertSafeWebhookUrl(urlString: string, env: NodeJS.ProcessEnv): URL {
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

/** isLoopbackHost() also matches the bare hostname "localhost", which - unlike 127.0.0.1, ::1, or
 * an IPv4-mapped-IPv6 literal - is a NAME, not a real address: createPinnedDispatcher's `lookup`
 * callback (packages/shared/src/pinnedDispatcher.ts) hands `record.address` straight to the
 * underlying connect() call, which needs a numeric IP, not the literal string "localhost" - using
 * it as-is fails the connection instead of reaching the local webhook. Only "localhost" needs
 * substituting; every other loopback form isLoopbackHost() matches is already a real address. */
function resolveLoopbackRecord(hostname: string): LookupAddress {
  if (hostname === "localhost") return { address: "127.0.0.1", family: 4 };
  return { address: hostname, family: hostname.includes(":") ? 6 : 4 };
}

/** Matches emailTemplate.ts's SEVERITY_LABEL (info/warn/error) - Discord-only, since the emoji
 * is prefixed onto the embed title, a shape only the Discord payload has. */
const SEVERITY_EMOJI: Record<"info" | "warn" | "error", string> = {
  info: "ℹ️",
  warn: "⚠️",
  error: "🚨",
};

function buildPayload(kind: WebhookKind, event: DispatchedNotification): Record<string, unknown> {
  switch (kind) {
    case "discord":
      return {
        embeds: [
          {
            title: `${SEVERITY_EMOJI[event.severity]} ${event.title}`,
            description: event.body,
            color: hexToDecimalColor(SEVERITY_COLOR[event.severity]),
            fields: buildMetadataFields(event.metadata),
            // Discord renders this as a readable local timestamp in the embed's own corner - the
            // same "when did this happen" cue Uptime Kuma's embeds show (PO comparison).
            timestamp: new Date().toISOString(),
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

/** "user_agent"/"userAgent" -> "User Agent" - Discord embed field names read raw metadata keys
 * verbatim otherwise (PO comparison against Uptime Kuma's own "Service Name"/"Went Offline"
 * labels, which are hand-written strings, not raw field keys). No acronym dictionary (would stay
 * "Ip" not "IP") - a small, deliberate gap rather than a lookup table for a handful of cases. */
function humanizeMetadataKey(key: string): string {
  const words = key
    .replaceAll("_", " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean);
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}

function buildMetadataFields(
  metadata: Record<string, unknown> | undefined,
): Array<{ name: string; value: string; inline: boolean }> {
  if (!metadata) return [];
  return Object.entries(metadata)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    // Not inline - Discord packs inline fields 3-per-row, which crowds out longer values (a URL,
    // a user agent string); full-width, one per line, is what makes Kuma's embeds easy to read.
    .map(([key, value]) => ({ name: humanizeMetadataKey(key), value: String(value), inline: false }));
}

/**
 * Generic webhook delivery (Discord/Slack/generic - ADR 0044 §1, generalizes ADR 0038's
 * Discord-only design). One team-wide URL per organization, sent once per notify() call
 * regardless of how many candidates resolved - `recipientUserIds` is unused here.
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
      if (!settings?.webhook_url_enc) return { ok: true, noop: true };

      const rawUrl = decryptFromString(settings.webhook_url_enc);
      const url = assertSafeWebhookUrl(rawUrl, env);
      const kind = (settings.webhook_kind as WebhookKind | null) ?? "generic";

      // One shared deadline for DNS resolution + the POST, not one each - dns.lookup() (inside
      // resolveSafeHostname) takes no AbortSignal of its own and would otherwise hang past this
      // budget on a stalled resolver, so awaitWithAbortSignal races it against the same signal
      // passed to withPinnedFetch below (packages/shared/src/ssrfGuard.ts).
      const signal = AbortSignal.timeout(this.options.timeoutMs ?? WEBHOOK_SEND_TIMEOUT_MS);
      const hostname = unbracketHostname(url.hostname);
      const records: LookupAddress[] = isLoopbackHost(hostname)
        ? [resolveLoopbackRecord(hostname)]
        : await awaitWithAbortSignal(resolveSafeHostname(hostname), signal);

      const payload = buildPayload(kind, event);
      const status = await withPinnedFetch(
        url,
        hostname,
        records,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal,
        },
        async (res) => {
          // withPinnedFetch's own contract (packages/mailer/src/pinnedFetch.ts): the handler must
          // consume the body before returning, or dispatcher.close() waits for it forever. Cancel
          // rather than read it (res.text() would buffer the whole thing) - only the status is
          // used, and an untrusted webhook target returning an arbitrarily large body must not be
          // able to exhaust memory just because we asked it a question.
          await res.body?.cancel().catch(() => undefined);
          return res.status;
        },
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
