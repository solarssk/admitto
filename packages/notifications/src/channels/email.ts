import type { PrismaClient } from "@admitto/db";
import {
  compileTemplate,
  escapeHtmlAttribute,
  escapeHtmlText,
  resolvePublicBaseUrl,
} from "@admitto/mail-templates";
import { closeMailer, createMailer, type MailerAdapter, type MailMessage, type SendResult } from "@admitto/mailer";
import { resolveMailConfigForOrg } from "@admitto/mailer-config";
import { sanitizeDeliveryError } from "@admitto/mail-delivery";
import { awaitWithAbortSignal } from "@admitto/shared/ssrf-guard";
import type { NotificationChannel, NotificationSendResult } from "../channel.js";
import type { DispatchedNotification } from "../types.js";
import { SEVERITY_COLOR, SEVERITY_LABEL, SYSTEM_NOTIFICATION_EMAIL_MJML } from "./emailTemplate.js";

// Never Prisma.TransactionClient - see the Db comment in ../dispatcher.ts.
type Db = PrismaClient;

const SETTINGS_NOTIFICATIONS_PATH = "/admin/settings/notifications";
const GENERIC_SEND_FAILED = "Send failed.";

/**
 * Bounds the ENTIRE send attempt - mail config resolution, createMailer() (SmtpAdapter resolves
 * and pins its destination host at construction time via resolveSafeMailDestination, not lazily
 * at send time), template compilation, and the actual per-recipient sends - same value/pattern as
 * WebhookChannel's WEBHOOK_SEND_TIMEOUT_MS. packages/mailer's Graph/Power Automate adapters put no
 * bound on their own outbound sendMail call (only Graph's token fetch has a timeout) and SMTP's
 * destination resolution has none either, so without covering the whole sequence a stall in any
 * one of these steps could hang this channel - and therefore dispatcher.ts's notify() as a whole
 * (its audit-log write and throttle keep/release decision both wait on every channel settling) -
 * indefinitely.
 *
 * IMPORTANT residual gap: this only bounds how long THIS CHANNEL waits - it does not cancel the
 * underlying HTTP request. awaitWithAbortSignal races a promise, it doesn't abort it, and
 * MailerAdapter.send()'s own signature takes no AbortSignal to pass through even if it did. If the
 * timeout fires while a provider is mid-response, that request keeps running in the background and
 * may still succeed (or fail) after this method has already returned a timeout failure and
 * dispatcher.ts has released the throttle claim for a retry - a real, currently-accepted risk of a
 * duplicate (not missed) delivery, deliberately favored over the alternative of silently
 * suppressing a genuinely-failed retry for the rest of the throttle window. Fully closing this
 * requires packages/mailer's own adapters to apply their own internal timeout directly to their
 * outbound fetch (tracked as separate follow-up work, out of this package's scope).
 */
export const EMAIL_SEND_TIMEOUT_MS = 15_000;

/** Matches packages/mailer's own sendBatch default ("gentle on connectors") - not reusing
 * sendBatch itself here since it has no try/catch around adapter.send(), so one recipient's
 * MailDestinationError rethrow would fail its internal Promise.all and discard every other
 * recipient's already-settled result, reintroducing the exact bug allSettled below exists to
 * avoid. */
export const EMAIL_SEND_CONCURRENCY = 3;

/** Bounded-concurrency fan-out for per-recipient sends, in Promise.allSettled's own result shape
 * (so the caller's existing result-processing loop needs no changes). Sending every recipient at
 * once is real, not just theoretical, provider risk beyond the obvious rate-limit burst: Graph's
 * token cache (packages/mailer/src/adapters/graph.ts) is a plain `this.token` field with no
 * in-flight-request de-duplication, so N fully-concurrent sends before the first one resolves
 * means N concurrent OAuth token requests, not one reused token. */
async function sendAllSettledBounded(
  mailer: MailerAdapter,
  messages: MailMessage[],
  concurrency: number,
): Promise<Array<PromiseSettledResult<SendResult>>> {
  const results = new Map<number, PromiseSettledResult<SendResult>>();
  let next = 0;
  async function worker(): Promise<void> {
    for (let index = next++; index < messages.length; index = next++) {
      const message = messages.at(index)!;
      try {
        results.set(index, { status: "fulfilled", value: await mailer.send(message) });
      } catch (reason) {
        results.set(index, { status: "rejected", reason });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, messages.length) }, worker));
  return Array.from({ length: messages.length }, (_, index) => results.get(index)!);
}

export interface EmailChannelOptions {
  /**
   * Whether to also send to NotificationSettings.extra_email_recipients for this org. Only true
   * for org-staff-audience types - never for a self-audience personal receipt (e.g. "your
   * password changed"), which must not leak to a shared team distro list. Set by dispatcher.ts
   * per notify() call, based on the resolved NotificationTypeDef.audience.
   */
  includeExtraRecipients?: boolean;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

type PlaceholderValue = { value: string; attribute: boolean };

function substitute(html: string, values: Record<string, PlaceholderValue>): string {
  let out = html;
  for (const [key, { value, attribute }] of Object.entries(values)) {
    const escaped = attribute ? escapeHtmlAttribute(value) : escapeHtmlText(value);
    out = out.replaceAll(`{{${key}}}`, escaped);
  }
  return out;
}

/** One composed, server-side line of text - never a table (prompt 86 "CZYTAJ NAJPIERW": every
 * placeholder is HTML-escaped text, not markup, so metadata can never smuggle HTML). */
function buildMetadataLine(metadata: Record<string, unknown> | undefined): string {
  if (!metadata) return "";
  return Object.entries(metadata)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" · ");
}

async function resolveExtraRecipients(db: Db, organizationId: string): Promise<string[]> {
  const settings = await db.notificationSettings.findUnique({
    where: { scope_type_scope_id: { scope_type: "organization", scope_id: organizationId } },
    select: { extra_email_recipients: true },
  });
  const raw = settings?.extra_email_recipients;
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

/**
 * Email delivery for the notification module. Every registered type renders through the single
 * shared layout (ADR 0044 §7, SYSTEM_NOTIFICATION_EMAIL_MJML) - no per-type visual design. One
 * message per resolved address (mailer contract is one-recipient-per-message).
 */
export class EmailChannel implements NotificationChannel {
  readonly channel = "email" as const;

  constructor(
    private readonly db: Db,
    private readonly options: EmailChannelOptions = {},
  ) {}

  async send(
    event: DispatchedNotification,
    recipientUserIds: string[],
  ): Promise<NotificationSendResult> {
    try {
      // One deadline for the whole attempt (see EMAIL_SEND_TIMEOUT_MS's own doc comment for why
      // every step below needs to be inside it, not just the final send) - awaitWithAbortSignal
      // races sendInternal rather than cancelling it, so a losing sendInternal keeps running in
      // the background (including its own closeMailer cleanup) rather than being abandoned mid
      // resource-allocation.
      return await awaitWithAbortSignal(
        this.sendInternal(event, recipientUserIds),
        AbortSignal.timeout(this.options.timeoutMs ?? EMAIL_SEND_TIMEOUT_MS),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: sanitizeDeliveryError(message) ?? GENERIC_SEND_FAILED };
    }
  }

  private async sendInternal(
    event: DispatchedNotification,
    recipientUserIds: string[],
  ): Promise<NotificationSendResult> {
    const [users, extraRecipients] = await Promise.all([
      recipientUserIds.length > 0
        ? this.db.user.findMany({
            where: { id: { in: recipientUserIds } },
            select: { email: true },
          })
        : Promise.resolve([]),
      this.options.includeExtraRecipients
        ? resolveExtraRecipients(this.db, event.organizationId)
        : Promise.resolve([]),
    ]);

    const addresses = [...new Set([...users.map((u) => u.email), ...extraRecipients])];
    if (addresses.length === 0) return { ok: true, noop: true };

    const mailConfig = await resolveMailConfigForOrg(
      event.organizationId,
      this.db as PrismaClient,
      this.options.env,
    );
    const mailer = await createMailer(mailConfig);

    try {
      // Substitute into the raw MJML source, not the compiled HTML: mjml2html's
      // validationLevel "strict" validates certain attribute values by type at compile time
      // (e.g. mj-section background-color as a CSS Color) - a still-literal "{{severity_color}}"
      // token fails that validation before substitution ever gets a chance to run.
      const baseUrl = resolvePublicBaseUrl(this.options.env);
      const substituted = substitute(SYSTEM_NOTIFICATION_EMAIL_MJML, {
        severity_color: { value: SEVERITY_COLOR[event.severity], attribute: true },
        severity_label: { value: SEVERITY_LABEL[event.severity], attribute: false },
        title: { value: event.title, attribute: false },
        body: { value: event.body, attribute: false },
        metadata_line: { value: buildMetadataLine(event.metadata), attribute: false },
        cta_url: { value: `${baseUrl}${SETTINGS_NOTIFICATIONS_PATH}`, attribute: true },
        cta_label: { value: "Manage notifications", attribute: false },
      });
      const html = await compileTemplate(substituted, "mjml");

      const messages: MailMessage[] = addresses.map((to) => ({
        to,
        subject: `[Admitto] ${event.title}`,
        html,
      }));

      // Bounded concurrency (EMAIL_SEND_CONCURRENCY), Promise.allSettled result shape: SmtpAdapter
      // (and Power Automate) deliberately rethrow MailDestinationError for an SSRF-blocked/
      // DNS-rebound destination (so ticket send/resend can map it to a distinct HTTP status) - a
      // genuine exception to the MailerAdapter contract's "does not throw" rule, so a fail-fast
      // Promise.all would let one recipient's throw discard every OTHER recipient's already-
      // settled result; sendAllSettledBounded's own try/catch keeps every outcome regardless. No
      // timeout race here - the whole method is already bounded by send()'s single outer deadline
      // (see EMAIL_SEND_TIMEOUT_MS).
      const settled = await sendAllSettledBounded(mailer, messages, EMAIL_SEND_CONCURRENCY);

      let failedCount = 0;
      let firstErrorDetail: string | undefined;
      for (const outcome of settled) {
        if (outcome.status === "rejected") {
          failedCount++;
          const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
          firstErrorDetail ??= sanitizeDeliveryError(message) ?? GENERIC_SEND_FAILED;
        } else if (outcome.value.status === "failed" || outcome.value.status === "rejected") {
          failedCount++;
          firstErrorDetail ??= sanitizeDeliveryError(outcome.value.error) ?? GENERIC_SEND_FAILED;
        }
      }

      if (failedCount === 0) return { ok: true };
      if (failedCount === settled.length) {
        // Nobody got it - a clean failure, no partial delivery to protect from a re-send.
        return { ok: false, error: firstErrorDetail ?? GENERIC_SEND_FAILED };
      }
      // Some (not all) addresses failed - still a real, partial delivery. `ok: true` so
      // dispatcher.ts keeps the throttle claim (the recipients who already got it must not be
      // re-sent to on the next occurrence), `error` set so the incomplete delivery is still
      // recorded in the audit trail rather than silently looking like a clean success. Recipient
      // counts only, never addresses, in the message (AGENTS.md "no PII in logs").
      return {
        ok: true,
        error: `${failedCount}/${settled.length} recipients failed: ${firstErrorDetail ?? GENERIC_SEND_FAILED}`,
      };
    } finally {
      await closeMailer(mailer);
    }
  }
}
