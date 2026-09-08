import { emitSystemLog } from "@admitto/shared/system-log";
import { Prisma, type PrismaClient } from "@admitto/db";
import { getNotificationTypeDef } from "./registry.js";
import { resolveAudienceCandidates } from "./audience.js";
import { resolveEnabledChannelsForUsers } from "./preferences.js";
import { sanitizeNotificationMetadata, sanitizeNotificationText } from "./sanitize.js";
import { EmailChannel } from "./channels/email.js";
import { WebhookChannel } from "./channels/webhook.js";
import { InAppChannel } from "./channels/inApp.js";
import type { NotificationChannel, NotificationSendResult } from "./channel.js";
import type { DispatchedNotification, NotificationEvent, NotificationTypeDef } from "./types.js";

/**
 * Deliberately a standalone `PrismaClient`, never a `Prisma.TransactionClient` - webhook/email
 * sends are irreversible external I/O with no relationship to Postgres transaction semantics. If
 * a caller ran notify() from inside their own open transaction, the external send would already
 * be in flight (or completed) by the time that transaction commits or rolls back; a later
 * rollback would then leave a real, already-delivered alert with no throttle claim and no audit
 * record to show it happened, letting a retry of the caller's operation send it again. Callers
 * that need to notify as part of a larger unit of work must call notify() only after their own
 * transaction has committed, not with the transaction's own client.
 */
type Db = PrismaClient;

const DEFAULT_THROTTLE_WINDOW_MINUTES = 15;

export interface DispatchDeps {
  /** Overrides for testing - a stub NotificationChannel per channel key. */
  channels?: Partial<Record<"email" | "webhook" | "in_app", NotificationChannel>>;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
}

interface DispatchOutcome {
  channelsSent: string[];
  failures: Array<{ channel: string; error?: string }>;
}

function reportUnknownType(type: string): void {
  emitSystemLog(
    "security",
    "error",
    `notify(): unknown notification type "${type}" - not registered in packages/notifications/src/registry.ts`,
    { notification_type: type },
  );
  if (process.env["NODE_ENV"] !== "production") {
    // Loud in dev/CI so a registry typo is impossible to miss - never a thrown error out of
    // notify() itself, since call sites (auth/audit code) must never be crashed by a dispatch bug.
    console.error(
      `[notifications] unknown notification type "${type}" - this is a bug, add it to registry.ts`,
    );
  }
}

/** Sanitized text safe for a console.error/operational log - a raw Prisma/driver error can
 * include rendered query arguments, connection details, or addresses (same reasoning as every
 * channel's own error handling, AGENTS.md's "no PII in logs" rule). */
function formatDispatchError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return sanitizeNotificationText(message);
}

/**
 * Atomically claims the right to send for (eventType, dedupeKey) within the throttle window.
 * True = caller may send (and this claim already recorded last_sent_at = now); false = another
 * send already claimed this window, caller must skip. A single `INSERT ... ON CONFLICT ... DO
 * UPDATE ... WHERE ... RETURNING` statement handles both the fresh-row and stale-row-reclaim
 * cases natively in Postgres, rather than a `create()` that deliberately relies on catching a
 * P2002 unique-constraint violation as normal control flow - `ON CONFLICT` never raises an error
 * on conflict at all.
 */
async function claimThrottleSlot(
  db: Db,
  eventType: string,
  dedupeKey: string,
  windowMinutes: number,
  now: Date,
): Promise<boolean> {
  const cutoff = new Date(now.getTime() - windowMinutes * 60_000);
  const claimed = await db.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "NotificationThrottle" (id, event_type, dedupe_key, last_sent_at)
    VALUES (gen_random_uuid()::text, ${eventType}, ${dedupeKey}, ${now})
    ON CONFLICT (event_type, dedupe_key)
    DO UPDATE SET last_sent_at = ${now}
    WHERE "NotificationThrottle".last_sent_at < ${cutoff}
    RETURNING id
  `;
  return claimed.length === 1;
}

/**
 * Releases a throttle slot claimed by claimThrottleSlot when the attempt it was guarding never
 * actually delivered anything (a transient channel/DB failure, or an audience that resolved to
 * nobody) - otherwise the claim's last_sent_at silently suppresses every later occurrence of the
 * same incident for the rest of the window, even though nothing was ever communicated and there
 * is no separate retry mechanism. Best-effort: a failure to release just means the window runs
 * its normal course, never a reason to crash an already-in-progress dispatch.
 */
async function releaseThrottleSlot(
  db: Db,
  eventType: string,
  dedupeKey: string,
): Promise<void> {
  try {
    await db.notificationThrottle.delete({
      where: { event_type_dedupe_key: { event_type: eventType, dedupe_key: dedupeKey } },
    });
  } catch (err) {
    // P2025 (record not found): a concurrent claimant already reclaimed this row (see
    // claimThrottleSlot's updateMany) - nothing left to release, not a real failure.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") return;
    console.error(
      JSON.stringify({
        event: "notification_dispatch_throttle_release.failed",
        dispatch_event_type: eventType,
        error: formatDispatchError(err),
        ts: new Date().toISOString(),
      }),
    );
  }
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
        error: formatDispatchError(err),
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

/** Resolves the audience, or logs the appropriate skip/failure reason and returns null when
 * there's nobody to notify - a "self" type with no valid target is a failed dispatch (prompt 86
 * §3: never trust the call site's targetUserId blindly), anything else (e.g. zero active
 * org-staff) is a quieter skip. */
async function resolveCandidatesOrLogSkip(
  db: Db,
  type: string,
  typeDef: NotificationTypeDef,
  event: NotificationEvent,
): Promise<string[] | null> {
  const candidates = await resolveAudienceCandidates(db, typeDef.audience, {
    organizationId: event.organizationId,
    targetUserId: event.targetUserId,
  });
  if (candidates.length > 0) return candidates;

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
  return null;
}

function buildDispatchedNotification(
  event: NotificationEvent,
  type: string,
  typeDef: NotificationTypeDef,
): DispatchedNotification {
  return {
    ...event,
    type,
    severity: typeDef.defaultSeverity,
    title: sanitizeNotificationText(event.title),
    body: sanitizeNotificationText(event.body),
    metadata: sanitizeNotificationMetadata(event.metadata),
  };
}

/** Sends `dispatched` through every channel this type has available, resolving per-user
 * email/in_app recipients from their preferences. Never throws - each channel's own result is
 * recorded into channelsSent/failures, not propagated. */
async function dispatchToChannels(
  db: Db,
  dispatched: DispatchedNotification,
  typeDef: NotificationTypeDef,
  candidates: string[],
  type: string,
  deps: DispatchDeps,
): Promise<DispatchOutcome> {
  // extra_email_recipients (org-staff-audience types only) is a team-wide address list
  // independent of any individual admin's personal opt-out.
  const includeExtraRecipients = typeDef.audience === "org-staff";
  const emailChannel =
    deps.channels?.email ?? new EmailChannel(db, { includeExtraRecipients, env: deps.env });
  const webhookChannel = deps.channels?.webhook ?? new WebhookChannel(db, { env: deps.env });
  const inAppChannel = deps.channels?.in_app ?? new InAppChannel(db);

  const outcome: DispatchOutcome = { channelsSent: [], failures: [] };
  const record = (channel: string, result: NotificationSendResult): void => {
    // A noop success (nothing configured, nothing to send) must not be reported as a delivery -
    // SecurityAuditLog.metadata.channels_sent is read as "the alert actually reached these
    // channels", not "these channels were attempted". A channel can report both at once (`ok:
    // true` with `error` set) for a partial multi-recipient send - e.g. EmailChannel delivered to
    // some but not all resolved addresses - which must show up in both places: channelsSent so
    // the throttle claim isn't released and re-sent to the recipients who already got it, and
    // failures so the audit trail still surfaces the incomplete delivery.
    if (result.ok && !result.noop) outcome.channelsSent.push(channel);
    if (!result.ok || result.error) outcome.failures.push({ channel, error: result.error });
  };

  if (typeDef.availableChannels.includes("webhook")) {
    record("webhook", await webhookChannel.send(dispatched, []));
  }

  const { emailRecipients, inAppRecipients } = await splitRecipientsByChannel(
    db,
    candidates,
    type,
  );

  // EmailChannel itself no-ops (ok: true) when there is nothing to send, so calling it whenever
  // extras might apply is never wasted beyond one lightweight settings lookup.
  if (
    typeDef.availableChannels.includes("email") &&
    (emailRecipients.length > 0 || includeExtraRecipients)
  ) {
    record("email", await emailChannel.send(dispatched, emailRecipients));
  }

  if (typeDef.availableChannels.includes("in_app") && inAppRecipients.length > 0) {
    record("in_app", await inAppChannel.send(dispatched, inAppRecipients));
  }

  return outcome;
}

async function splitRecipientsByChannel(
  db: Db,
  candidates: string[],
  type: string,
): Promise<{ emailRecipients: string[]; inAppRecipients: string[] }> {
  const enabledByUser = await resolveEnabledChannelsForUsers(db, candidates, type);
  const emailRecipients: string[] = [];
  const inAppRecipients: string[] = [];
  for (const userId of candidates) {
    const enabled = enabledByUser.get(userId) ?? [];
    if (enabled.includes("email")) emailRecipients.push(userId);
    if (enabled.includes("in_app")) inAppRecipients.push(userId);
  }
  return { emailRecipients, inAppRecipients };
}

/**
 * Dispatches one notification event through every applicable channel for its registered type.
 * Steps (ADR 0038/0044, prompt 86 §2.A, amended per the notifications-module-foundation plan):
 * registry lookup → org-disabled check → throttle claim → audience resolution → sanitize
 * content → webhook (once, team-wide) → email/in-app (per candidate, per-user preferences) →
 * SecurityAuditLog write. Never throws - every failure mode is caught, logged, and swallowed so
 * a dispatch bug can never break the call site (a login, an MFA check, a settings save).
 */
export async function notify(
  db: Db,
  type: string,
  event: NotificationEvent,
  deps: DispatchDeps = {},
): Promise<void> {
  // Set once claimThrottleSlot succeeds - tracked here (not just inline) so the outer catch can
  // also release on an unexpected mid-dispatch exception, not only the two known failure paths.
  let claimedThrottleKey: string | null = null;
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
    claimedThrottleKey = throttleKey;

    const candidates = await resolveCandidatesOrLogSkip(db, type, typeDef, event);
    if (!candidates) {
      await releaseThrottleSlot(db, type, throttleKey);
      return;
    }

    const dispatched = buildDispatchedNotification(event, type, typeDef);
    const { channelsSent, failures } = await dispatchToChannels(
      db,
      dispatched,
      typeDef,
      candidates,
      type,
      deps,
    );

    // Nothing was actually delivered on any channel - either every channel failed, or every
    // channel was a legitimate noop (nothing configured/nobody opted in). Release so a real
    // later occurrence of this incident isn't silently suppressed by a claim that never
    // communicated anything. A *partial* success (some channels sent, one failed) keeps the
    // claim: releasing there would let the channels that already delivered resend/spam on the
    // next occurrence while only the genuinely-still-broken channel needed a retry.
    if (channelsSent.length === 0) {
      await releaseThrottleSlot(db, type, throttleKey);
    }

    if (failures.length > 0) {
      await writeDispatchAuditLog(db, "notification.dispatch.failed", {
        notification_type: type,
        channels_sent: channelsSent,
        failures,
      });
      return;
    }

    if (channelsSent.length === 0) {
      await writeDispatchAuditLog(db, "notification.dispatch.skipped_no_recipients", {
        notification_type: type,
      });
      return;
    }

    await writeDispatchAuditLog(db, "notification.dispatch.sent", {
      notification_type: type,
      channels_sent: channelsSent,
    });
  } catch (err) {
    if (claimedThrottleKey) {
      await releaseThrottleSlot(db, type, claimedThrottleKey);
    }
    console.error(
      JSON.stringify({
        event: "notification_dispatch.unexpected_error",
        notification_type: type,
        error: formatDispatchError(err),
        ts: new Date().toISOString(),
      }),
    );
  }
}
