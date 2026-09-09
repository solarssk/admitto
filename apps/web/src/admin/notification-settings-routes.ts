/**
 * Organisation Settings → Notifications (notifications-module-foundation plan, PR2).
 * Team webhook (Discord/Slack/generic) + extra email recipients + a per-type × per-channel org
 * disable matrix. Superadmin-only; the webhook URL is never returned in clear text (same
 * convention as MailSettings/weather/maps secrets).
 */

import type { Context } from "hono";
import { z } from "zod";
import type { PrismaClient } from "@admitto/db";
import { writeAdminAuditLog } from "@admitto/tickets";
import type { MailDeliveryDeps } from "@admitto/mail-delivery";
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
const CHANNEL_KINDS = ["webhook", "email", "in_app"] as const;

const putBodySchema = z
  .object({
    webhookUrl: z.string().max(2048).optional(),
    webhookKind: z.enum(WEBHOOK_KINDS).optional(),
    extraEmailRecipients: z
      .array(
        z.object({ email: z.string().trim().email(), description: z.string().trim().max(200).optional() }).strict(),
      )
      .max(50)
      .optional(),
    disabledChannels: z.record(z.string(), z.array(z.enum(CHANNEL_KINDS)).max(3)).optional(),
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
    disabled_channels: settings.disabled_channels,
    notification_types: orgDisableableTypeIds().map((id) => ({
      id,
      label: NOTIFICATION_TYPES[id]!.label,
      default_severity: NOTIFICATION_TYPES[id]!.defaultSeverity,
      available_channels: NOTIFICATION_TYPES[id]!.availableChannels,
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
  const disabledChannels = parsed.data.disabledChannels
    ? Object.fromEntries(
        Object.entries(parsed.data.disabledChannels).filter(([id]) => validDisableableIds.has(id)),
      )
    : undefined;

  const auth = c.get("auth");
  const orgId = await resolveInstanceOrganizationId(db, process.env);
  const audit = adminAuditFromContext(c);
  const settings = await patchNotificationSettings(
    db,
    orgId,
    {
      webhookUrl: parsed.data.webhookUrl,
      webhookKind: parsed.data.webhookKind,
      extraEmailRecipients: parsed.data.extraEmailRecipients,
      disabledChannels,
    },
    auth.userId,
    audit.timezone,
  );

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
      disabled_channels: settings.disabled_channels,
    },
  });

  return c.json(serializeNotificationSettings(settings));
}

interface TestChannelResult {
  ok: boolean;
  error?: string;
  /** True when this channel wasn't exercised at all by this particular test click - see the
   * scoping note below. Never appears alongside `error`. */
  skipped?: boolean;
}

const testBodySchema = z.object({ testEmail: z.string().trim().email().optional() }).strict();

/** Empty or whitespace-only body parses as `{}` (the common case - the client only sends one when
 * testEmail is set); a genuinely malformed JSON body returns 400 instead of silently falling back
 * to `{}` (same distinction as attendees-api-routes.ts's own parseOptionalJsonBody). */
async function parseOptionalTestBody(c: Context): Promise<unknown | Response> {
  try {
    const text = await c.req.text();
    if (!text.trim()) return {};
    return JSON.parse(text);
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
}

/**
 * POST /api/admin/notification-settings/test - fires directly against the ALREADY-SAVED
 * settings, bypassing notify()'s throttle and org-staff audience resolution entirely: a real
 * notify() call would risk being silently deduped against a recent real occurrence of the same
 * type, and org-staff audience would fan a test out to every admin instead of just the person who
 * clicked the button.
 *
 * Scoped to only the channel(s) the click actually owns, not every channel this endpoint could
 * exercise - a `testEmail` in the body means a recipient row's "Send test to X" was clicked
 * (tests only that address; the shared team webhook and this admin's own in-app notification are
 * both left untouched, since clicking a personal test-email button firing a real message into
 * the team's Discord/Slack channel is a real bug, not a feature - PO report), otherwise it's the
 * Webhook card's own "Send test" (tests webhook + in-app; email is skipped, since that card
 * doesn't show or care about an email result either).
 */
export async function handlePostNotificationSettingsTest(
  c: Context,
  db: PrismaClient,
  mailDeliveryDeps: MailDeliveryDeps = {},
): Promise<Response> {
  const forbidden = await requireSuperadmin(c, db);
  if (forbidden) return forbidden;

  const bodyOrRes = await parseOptionalTestBody(c);
  if (bodyOrRes instanceof Response) return bodyOrRes;
  const parsed = testBodySchema.safeParse(bodyOrRes);
  if (!parsed.success) {
    return c.json({ error: "validation_failed", details: parsed.error.flatten() }, 400);
  }

  const auth = c.get("auth");
  const orgId = await resolveInstanceOrganizationId(db, process.env);
  const testEvent: DispatchedNotification = {
    type: "notifications.settings.test",
    severity: "info",
    organizationId: orgId,
    title: "Test notification",
    body: "This is a test notification, sent from the Notifications tab in Organisation Settings.",
  };

  const webhookChannel = new WebhookChannel(db);
  const emailChannel = new EmailChannel(db, {
    includeExtraRecipients: false,
    exportSink: mailDeliveryDeps.exportSink,
  });
  const inAppChannel = new InAppChannel(db);

  const testingOneEmailAddress = Boolean(parsed.data.testEmail);

  const [webhook, email, inApp] = await Promise.all([
    testingOneEmailAddress ? null : webhookChannel.send(testEvent, []),
    testingOneEmailAddress ? emailChannel.sendToAddress(testEvent, parsed.data.testEmail!) : null,
    testingOneEmailAddress ? null : inAppChannel.send(testEvent, [auth.userId]),
  ]);

  const toResult = (result: { ok: boolean; error?: string; noop?: boolean } | null): TestChannelResult => {
    if (result === null) return { ok: true, skipped: true };
    if (result.noop) return { ok: false, error: "Not configured." };
    return { ok: result.ok, error: result.error };
  };

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
