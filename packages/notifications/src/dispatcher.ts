import { emitSystemLog } from "@admitto/shared/system-log";
import { Prisma, type PrismaClient } from "@admitto/db";
import { getNotificationTypeDef } from "./registry.js";
import { resolveAudienceCandidates } from "./audience.js";
import { resolveEnabledChannels } from "./preferences.js";
import { sanitizeNotificationMetadata, sanitizeNotificationText } from "./sanitize.js";
import { EmailChannel } from "./channels/email.js";
import { WebhookChannel } from "./channels/webhook.js";
import { InAppChannel } from "./channels/inApp.js";
import type { NotificationChannel } from "./channel.js";
import type { DispatchedNotification, NotificationEvent } from "./types.js";

type Db = PrismaClient | Prisma.TransactionClient;

const DEFAULT_THROTTLE_WINDOW_MINUTES = 15;

export interface DispatchDeps {
  /** Overrides for testing — a stub NotificationChannel per channel key. */
  channels?: Partial<Record<"email" | "webhook" | "in_app", NotificationChannel>>;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
}

function reportUnknownType(type: string): void {
  emitSystemLog(
    "security",
    "error",
    `notify(): unknown notification type "${type}" — not registered in packages/notifications/src/registry.ts`,
    { notification_type: type },
  );
  if (process.env["NODE_ENV"] !== "production") {
    // Loud in dev/CI so a registry typo is impossible to miss — never a thrown error out of
    // notify() itself, since call sites (auth/audit code) must never be crashed by a dispatch bug.
    console.error(
      `[notifications] unknown notification type "${type}" — this is a bug, add it to registry.ts`,
    );
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Atomically claims the right to send for (eventType, dedupeKey) within the throttle window.
 * True = caller may send (and this claim already recorded last_sent_at = now); false = another
 * send already claimed this window, caller must skip. The `create`-then-conditional-`updateMany`
 * pair is race-safe: a concurrent claimant either wins the create (unique constraint) or the
 * updateMany's `last_sent_at: { lt: cutoff }` guard (only a stale row can be reclaimed, and only
 * one concurrent updateMany can match+update a given row).
 */
async function claimThrottleSlot(
  db: Db,
  eventType: string,
  dedupeKey: string,
  windowMinutes: number,
  now: Date,
): Promise<boolean> {
  try {
    await db.notificationThrottle.create({
      data: { event_type: eventType, dedupe_key: dedupeKey, last_sent_at: now },
    });
    return true;
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
  }

  const cutoff = new Date(now.getTime() - windowMinutes * 60_000);
  const claimed = await db.notificationThrottle.updateMany({
    where: { event_type: eventType, dedupe_key: dedupeKey, last_sent_at: { lt: cutoff } },
    data: { last_sent_at: now },
  });
  return claimed.count === 1;
}

async function writeDispatchAuditLog(
  db: Db,
  eventType: string,
  metadata: Record<string, unknown>,
  userId?: string,
): Promise<void> {
  try {
    await db.securityAuditLog.create({
      data: {
        event_type: eventType,
        user_id: userId ?? null,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "notification_dispatch_audit_log.write_failed",
        dispatch_event_type: eventType,
        error: err instanceof Error ? err.message : String(err),
        ts: new Date().toISOString(),
      }),
    );
  }
}

async function readOrgSettings(
  db: Db,
  organizationId: string,
): Promise<{ disabledTypes: string[] }> {
  const settings = await db.notificationSettings.findUnique({
    where: { scope_type_scope_id: { scope_type: "organization", scope_id: organizationId } },
    select: { disabled_types: true },
  });
  const disabledTypes = Array.isArray(settings?.disabled_types)
    ? settings.disabled_types.filter((entry): entry is string => typeof entry === "string")
    : [];
  return { disabledTypes };
}

/**
 * Dispatches one notification event through every applicable channel for its registered type.
 * Steps (ADR 0038/0044, prompt 86 §2.A, amended per the notifications-module-foundation plan):
 * registry lookup → org-disabled check → throttle claim → audience resolution → sanitize
 * content → webhook (once, team-wide) → email/in-app (per candidate, per-user preferences) →
 * SecurityAuditLog write. Never throws — every failure mode is caught, logged, and swallowed so
 * a dispatch bug can never break the call site (a login, an MFA check, a settings save).
 */
export async function notify(
  db: Db,
  type: string,
  event: NotificationEvent,
  deps: DispatchDeps = {},
): Promise<void> {
  try {
    const typeDef = getNotificationTypeDef(type);
    if (!typeDef) {
      reportUnknownType(type);
      return;
    }

    const { disabledTypes } = await readOrgSettings(db, event.organizationId);
    if (typeDef.orgDisableable && disabledTypes.includes(type)) {
      await writeDispatchAuditLog(db, "notification.dispatch.skipped_org_disabled", {
        notification_type: type,
      });
      return;
    }

    const now = deps.now?.() ?? new Date();
    const throttleKey = `${event.organizationId}:${event.dedupeKey ?? "org"}`;
    const windowMinutes = typeDef.throttleWindowMinutes ?? DEFAULT_THROTTLE_WINDOW_MINUTES;
    const claimed = await claimThrottleSlot(db, type, throttleKey, windowMinutes, now);
    if (!claimed) {
      await writeDispatchAuditLog(db, "notification.dispatch.skipped_throttled", {
        notification_type: type,
      });
      return;
    }

    const candidates = await resolveAudienceCandidates(db, typeDef.audience, {
      organizationId: event.organizationId,
      targetUserId: event.targetUserId,
    });
    if (candidates.length === 0) {
      if (typeDef.audience === "self") {
        await writeDispatchAuditLog(
          db,
          "notification.dispatch.failed",
          { notification_type: type, reason: "self_target_invalid" },
          event.targetUserId,
        );
      } else {
        await writeDispatchAuditLog(db, "notification.dispatch.skipped_empty_audience", {
          notification_type: type,
        });
      }
      return;
    }

    const dispatched: DispatchedNotification = {
      ...event,
      type,
      severity: typeDef.defaultSeverity,
      title: sanitizeNotificationText(event.title),
      body: sanitizeNotificationText(event.body),
      metadata: sanitizeNotificationMetadata(event.metadata),
    };

    const emailChannel =
      deps.channels?.email ??
      new EmailChannel(db, { includeExtraRecipients: typeDef.audience === "org-staff", env: deps.env });
    const webhookChannel = deps.channels?.webhook ?? new WebhookChannel(db, { env: deps.env });
    const inAppChannel = deps.channels?.in_app ?? new InAppChannel(db);

    const channelsSent: string[] = [];
    const failures: Array<{ channel: string; error?: string }> = [];

    if (typeDef.availableChannels.includes("webhook")) {
      const result = await webhookChannel.send(dispatched, []);
      if (result.ok) channelsSent.push("webhook");
      else failures.push({ channel: "webhook", error: result.error });
    }

    const emailRecipients: string[] = [];
    const inAppRecipients: string[] = [];
    for (const userId of candidates) {
      const enabled = await resolveEnabledChannels(db, userId, type);
      if (enabled.includes("email")) emailRecipients.push(userId);
      if (enabled.includes("in_app")) inAppRecipients.push(userId);
    }

    if (typeDef.availableChannels.includes("email") && emailRecipients.length > 0) {
      const result = await emailChannel.send(dispatched, emailRecipients);
      if (result.ok) channelsSent.push("email");
      else failures.push({ channel: "email", error: result.error });
    }

    if (typeDef.availableChannels.includes("in_app") && inAppRecipients.length > 0) {
      const result = await inAppChannel.send(dispatched, inAppRecipients);
      if (result.ok) channelsSent.push("in_app");
      else failures.push({ channel: "in_app", error: result.error });
    }

    if (failures.length > 0) {
      await writeDispatchAuditLog(db, "notification.dispatch.failed", {
        notification_type: type,
        channels_sent: channelsSent,
        failures,
      });
      return;
    }

    await writeDispatchAuditLog(db, "notification.dispatch.sent", {
      notification_type: type,
      channels_sent: channelsSent,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "notification_dispatch.unexpected_error",
        notification_type: type,
        error: err instanceof Error ? err.message : String(err),
        ts: new Date().toISOString(),
      }),
    );
  }
}
