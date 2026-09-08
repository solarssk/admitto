/**
 * Organisation Settings → Notifications (notifications-module-foundation plan, PR2).
 * Team webhook (Discord/Slack/generic) + extra email recipients + per-type org disable toggle.
 * Superadmin-only; the webhook URL is never returned in clear text (same convention as
 * MailSettings/weather/maps secrets).
 */

import type { Context } from "hono";
import { z } from "zod";
import type { PrismaClient } from "@admitto/db";
import { writeAdminAuditLog } from "@admitto/tickets";
import {
  assertSafeWebhookUrl,
  BlockedWebhookUrlError,
  describeNotificationSettings,
  EmailChannel,
  InAppChannel,
  NOTIFICATION_TYPES,
  patchNotificationSettings,
  WebhookChannel,
  type DispatchedNotification,
  type NotificationSettingsPublic,
} from "@admitto/notifications";
import { adminAuditFromContext, requireSuperadmin } from "./admin-helpers.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";

const WEBHOOK_KINDS = ["discord", "slack", "generic"] as const;

const putBodySchema = z
  .object({
    webhookUrl: z.string().max(2048).optional(),
    webhookKind: z.enum(WEBHOOK_KINDS).optional(),
    extraEmailRecipients: z.array(z.string().trim().email()).max(50).optional(),
    disabledTypes: z.array(z.string()).max(50).optional(),
  })
  .strict();

/** Registry keys the toggle grid may show - orgDisableable:false types (e.g. a future ASVS
 * self-audience receipt) are intentionally never listed, so an organization can never disable
 * the one alert meant to catch an unauthorized change to its own admin accounts. */
function orgDisableableTypeIds(): string[] {
  return Object.keys(NOTIFICATION_TYPES).filter((id) => NOTIFICATION_TYPES[id]!.orgDisableable);
}

function serializeNotificationSettings(settings: NotificationSettingsPublic) {
  return {
    webhook: settings.webhook,
    extra_email_recipients: settings.extra_email_recipients,
    disabled_types: settings.disabled_types,
    notification_types: orgDisableableTypeIds().map((id) => ({
      id,
      label: NOTIFICATION_TYPES[id]!.label,
      default_severity: NOTIFICATION_TYPES[id]!.defaultSeverity,
    })),
  };
}

/** GET /api/admin/notification-settings */
export async function handleGetNotificationSettings(
  c: Context,
  db: PrismaClient,
): Promise<Response> {
  const forbidden = await requireSuperadmin(c, db);
  if (forbidden) return forbidden;

  const orgId = await resolveInstanceOrganizationId(db, process.env);
  const settings = await describeNotificationSettings(db, orgId);
  return c.json(serializeNotificationSettings(settings));
}

/** PUT /api/admin/notification-settings */
export async function handlePutNotificationSettings(
  c: Context,
  db: PrismaClient,
): Promise<Response> {
  const forbidden = await requireSuperadmin(c, db);
  if (forbidden) return forbidden;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const parsed = putBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_failed", details: parsed.error.flatten() }, 400);
  }

  if (parsed.data.webhookUrl !== undefined && parsed.data.webhookUrl.trim() !== "") {
    try {
      assertSafeWebhookUrl(parsed.data.webhookUrl.trim(), process.env);
    } catch (err) {
      if (err instanceof BlockedWebhookUrlError) {
        return c.json({ error: "invalid_webhook_url", detail: err.message }, 400);
      }
      throw err;
    }
  }

  const validDisableableIds = new Set(orgDisableableTypeIds());
  const disabledTypes = parsed.data.disabledTypes?.filter((id) => validDisableableIds.has(id));

  const orgId = await resolveInstanceOrganizationId(db, process.env);
  const settings = await patchNotificationSettings(db, orgId, {
    webhookUrl: parsed.data.webhookUrl,
    webhookKind: parsed.data.webhookKind,
    extraEmailRecipients: parsed.data.extraEmailRecipients,
    disabledTypes,
  });

  const audit = adminAuditFromContext(c);
  await writeAdminAuditLog(db, {
    organizationId: orgId,
    actorUserId: audit.operator!,
    sessionId: audit.sessionId,
    ip: audit.ip,
    timezone: audit.timezone,
    actionType: "notification_settings_updated",
    metadata: {
      webhook_set: settings.webhook.set,
      webhook_kind: settings.webhook.kind,
      extra_email_recipients_count: settings.extra_email_recipients.length,
      disabled_types: settings.disabled_types,
    },
  });

  return c.json(serializeNotificationSettings(settings));
}

interface TestChannelResult {
  ok: boolean;
  error?: string;
}

/**
 * POST /api/admin/notification-settings/test — fires webhook/email/in-app directly against the
 * ALREADY-SAVED settings, bypassing notify()'s throttle and org-staff audience resolution
 * entirely: a real notify() call would risk being silently deduped against a recent real
 * occurrence of the same type, and org-staff audience would fan a test out to every admin
 * instead of just the person who clicked the button. Email/in-app target only the requesting
 * superadmin; the webhook is inherently team-wide (no per-user targeting exists for it).
 */
export async function handlePostNotificationSettingsTest(
  c: Context,
  db: PrismaClient,
): Promise<Response> {
  const forbidden = await requireSuperadmin(c, db);
  if (forbidden) return forbidden;

  const auth = c.get("auth");
  const orgId = await resolveInstanceOrganizationId(db, process.env);
  const testEvent: DispatchedNotification = {
    type: "notifications.settings.test",
    severity: "info",
    organizationId: orgId,
    title: "Test notification",
    body: "This is a test notification sent from Organisation Settings → Notifications.",
  };

  const webhookChannel = new WebhookChannel(db);
  const emailChannel = new EmailChannel(db, { includeExtraRecipients: false });
  const inAppChannel = new InAppChannel(db);

  const [webhook, email, inApp] = await Promise.all([
    webhookChannel.send(testEvent, []),
    emailChannel.send(testEvent, [auth.userId]),
    inAppChannel.send(testEvent, [auth.userId]),
  ]);

  const toResult = (result: { ok: boolean; error?: string; noop?: boolean }): TestChannelResult =>
    result.noop ? { ok: false, error: "Not configured." } : { ok: result.ok, error: result.error };

  const results = { webhook: toResult(webhook), email: toResult(email), in_app: toResult(inApp) };

  const audit = adminAuditFromContext(c);
  await writeAdminAuditLog(db, {
    organizationId: orgId,
    actorUserId: audit.operator!,
    sessionId: audit.sessionId,
    ip: audit.ip,
    timezone: audit.timezone,
    actionType: "notification_settings_tested",
    metadata: results,
  });

  return c.json(results);
}
