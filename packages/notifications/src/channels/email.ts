import type { Prisma, PrismaClient } from "@admitto/db";
import {
  compileTemplate,
  escapeHtmlAttribute,
  escapeHtmlText,
  resolvePublicBaseUrl,
} from "@admitto/mail-templates";
import { closeMailer, createMailer, type MailMessage } from "@admitto/mailer";
import { resolveMailConfigForOrg } from "@admitto/mailer-config";
import { sanitizeDeliveryError } from "@admitto/mail-delivery";
import type { NotificationChannel, NotificationSendResult } from "../channel.js";
import type { DispatchedNotification } from "../types.js";
import { SEVERITY_COLOR, SEVERITY_LABEL, SYSTEM_NOTIFICATION_EMAIL_MJML } from "./emailTemplate.js";

type Db = PrismaClient | Prisma.TransactionClient;

const SETTINGS_NOTIFICATIONS_PATH = "/admin/settings/notifications";
const GENERIC_SEND_FAILED = "Send failed.";

export interface EmailChannelOptions {
  /**
   * Whether to also send to NotificationSettings.extra_email_recipients for this org. Only true
   * for org-staff-audience types - never for a self-audience personal receipt (e.g. "your
   * password changed"), which must not leak to a shared team distro list. Set by dispatcher.ts
   * per notify() call, based on the resolved NotificationTypeDef.audience.
   */
  includeExtraRecipients?: boolean;
  env?: NodeJS.ProcessEnv;
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

        const results = await Promise.all(messages.map((message) => mailer.send(message)));
        const failed = results.find((r) => r.status === "failed" || r.status === "rejected");
        if (failed) {
          return { ok: false, error: sanitizeDeliveryError(failed.error) ?? GENERIC_SEND_FAILED };
        }
        return { ok: true };
      } finally {
        await closeMailer(mailer);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: sanitizeDeliveryError(message) ?? GENERIC_SEND_FAILED };
    }
  }
}
