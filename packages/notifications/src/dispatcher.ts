import { emitSystemLog } from "@admitto/shared/system-log";
import { Prisma, type PrismaClient } from "@admitto/db";
import { getNotificationTypeDef } from "./registry.js";
import { resolveAudienceCandidates } from "./audience.js";
import { resolveEnabledChannelsForUsers } from "./preferences.js";
import { sanitizeDeliveryError } from "@admitto/mail-delivery";
import type { ExportSink } from "@admitto/mailer";
import { EmailChannel } from "./channels/email.js";
import { WebhookChannel } from "./channels/webhook.js";
import { InAppChannel } from "./channels/inApp.js";
import type { NotificationChannel, NotificationSendResult } from "./channel.js";
import type {
  DispatchedNotification,
  NotificationChannelKey,
  NotificationEvent,
  NotificationTypeDef,
} from "./types.js";

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
  /** Forwarded to the default EmailChannel's own createMailer() call - required when the org's
   * mail provider is export_only (dev/test only). Without it, a real dispatch on an export_only
   * instance would throw createMailer's own internal guard instead of delivering through the
   * dev export sink like every other mail-sending path in the repo already does. */
  exportSink?: ExportSink;
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
 * channel's own error handling, AGENTS.md's "no PII in logs" rule). Genuinely uncontrolled text
 * (a database driver's own error message), unlike the developer-authored title/body/metadata a
 * caller passes to notify() itself - see buildDispatchedNotification's own doc note on why those
 * are no longer sanitized here. */
function formatDispatchError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return sanitizeDeliveryError(message) ?? "";
}

/**
 * Atomically claims the right to send for (eventType, dedupeKey) within the throttle window.
 * Returns the claimed row's id (pass it to releaseThrottleSlot) or null if another send already
 * claimed this window. A single `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE ... RETURNING`
 * statement handles both the fresh-row and stale-row-reclaim cases natively in Postgres, rather
 * than a `create()` that deliberately relies on catching a P2002 unique-constraint violation as
 * normal control flow - `ON CONFLICT` never raises an error on conflict at all.
 *
 * `id = EXCLUDED.id` in the DO UPDATE branch is load-bearing, not decorative: Postgres only
 * touches columns actually listed in SET, so without it a stale-row reclaim would return the
 * SAME id the previous (possibly still in-flight) claimant already holds - defeating
 * releaseThrottleSlot's id-based matching below, since a delete-by-id could then match a row a
 * different, later claimant now legitimately owns. `EXCLUDED` refers to the row proposed by this
 * statement's own VALUES clause, so every successful claim - fresh insert or reclaim alike - gets
 * a freshly generated id distinct from whatever the previous claimant is holding.
 */
async function claimThrottleSlot(
  db: Db,
  eventType: string,
  dedupeKey: string,
  windowMinutes: number,
  now: Date,
): Promise<string | null> {
  const cutoff = new Date(now.getTime() - windowMinutes * 60_000);
  const claimed = await db.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "NotificationThrottle" (id, event_type, dedupe_key, last_sent_at)
    VALUES (gen_random_uuid()::text, ${eventType}, ${dedupeKey}, ${now})
    ON CONFLICT (event_type, dedupe_key)
    DO UPDATE SET last_sent_at = ${now}, id = EXCLUDED.id
    WHERE "NotificationThrottle".last_sent_at < ${cutoff}
    RETURNING id
  `;
  return claimed[0]?.id ?? null;
}

/**
 * Releases a throttle slot claimed by claimThrottleSlot when the attempt it was guarding never
 * actually delivered anything (a transient channel/DB failure, or an audience that resolved to
 * nobody) - otherwise the claim's last_sent_at silently suppresses every later occurrence of the
 * same incident for the rest of the window, even though nothing was ever communicated and there
 * is no separate retry mechanism. Best-effort: a failure to release just means the window runs
 * its normal course, never a reason to crash an already-in-progress dispatch.
 *
 * Matched by `claimedRowId`, not just (eventType, dedupeKey): if this attempt runs long enough
 * for its own claim to go stale, a second dispatch can legitimately reclaim the same key (see
 * claimThrottleSlot's `WHERE last_sent_at < cutoff`) while this attempt is still in flight. A
 * blind delete-by-key here would then remove that second, live claim out from under it, letting
 * a third dispatch enter while the second is still sending and duplicate the alert. `deleteMany`
 * (unlike `delete`, which is keyed only on the (eventType, dedupeKey) unique constraint) can
 * filter on `id` too, and never throws when nothing matches - a row already superseded by a
 * later claim is exactly that case, not an error.
 */
async function releaseThrottleSlot(
  db: Db,
  eventType: string,
  dedupeKey: string,
  claimedRowId: string,
): Promise<void> {
  try {
    await db.notificationThrottle.deleteMany({
      where: { event_type: eventType, dedupe_key: dedupeKey, id: claimedRowId },
    });
  } catch (err) {
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

/** organizationId is a required, dedicated parameter (not just another metadata field a call site
 * remembers to add) precisely so it can never be forgotten: SecurityAuditLog is instance-wide and
 * shared with every other audit event type in the app, so without it a superadmin reviewing a
 * dispatch outcome for a notification type that fires across multiple organizations has no way to
 * tell which tenant a given "sent"/"failed"/"skipped_*" row was actually about. */
async function writeDispatchAuditLog(
  db: Db,
  eventType: string,
  organizationId: string,
  metadata: Record<string, unknown>,
  userId?: string,
): Promise<void> {
  try {
    await db.securityAuditLog.create({
      data: {
        event_type: eventType,
        user_id: userId ?? null,
        metadata: { organization_id: organizationId, ...metadata } as Prisma.InputJsonValue,
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
): Promise<{ disabledChannelsByType: Record<string, NotificationChannelKey[]> }> {
  const settings = await db.notificationSettings.findUnique({
    where: { scope_type_scope_id: { scope_type: "organization", scope_id: organizationId } },
    select: { disabled_channels: true },
  });
  const raw = settings?.disabled_channels;
  const disabledChannelsByType: Record<string, NotificationChannelKey[]> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [type, channels] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(channels)) continue;
      const normalized = channels.filter((entry): entry is string => typeof entry === "string");
      if (normalized.length > 0) disabledChannelsByType[type] = normalized as NotificationChannelKey[];
    }
  }
  return { disabledChannelsByType };
}

/** Resolves the audience. Only "self" with no valid target is treated as a dispatch failure that
 * skips everything (prompt 86 §3: never trust the call site's targetUserId blindly - there is no
 * one this personal notification could legitimately be for). For every other audience, an empty
 * result is returned as-is, NOT treated as "nothing to do": WebhookChannel is a team-wide resource
 * that never depends on candidates (channel.ts) - org-staff resolving to zero active admins is
 * exactly when that out-of-band channel matters most (e.g. the sole admin who'd normally get an
 * in-app/email alert was just deactivated as part of the incident being reported), so dispatch
 * must still proceed with an empty candidate list rather than short-circuiting before webhook (or
 * a configured extra_email_recipients distro) ever gets a chance to fire. */
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
  if (candidates.length > 0 || typeDef.audience !== "self") return candidates;

  await writeDispatchAuditLog(
    db,
    "notification.dispatch.failed",
    event.organizationId,
    { notification_type: type, reason: "self_target_invalid" },
    event.targetUserId,
  );
  return null;
}

/**
 * `title`/`body`/`metadata` pass through unchanged - this used to run them through an
 * email/token/URL-redacting sanitizer as defense-in-depth, but notify()'s only real caller is
 * packages/auth/src/audit.ts's own fixed, developer-authored templates (verified: no other
 * package calls notify() with free-form or externally-derived text) - every value interpolated
 * into them is a resolved account identifier, a fixed enum-derived label, or a machine-resolved
 * value (streak count, ISO country code), never attacker- or third-party-controlled text. Running
 * that content through an email-shape scanner did real, active harm instead: it collapsed the
 * actor/target identifier every one of these alerts exists to convey into the literal string
 * "[redacted]", defeating the alert's whole purpose (a security notification an admin can't
 * attribute to an account is not actionable). Removed rather than special-cased per-field - see
 * git history for the prior sanitizeNotificationText/sanitizeNotificationMetadata implementation
 * if a future caller genuinely needs it back for less-trusted content.
 */
function buildDispatchedNotification(
  event: NotificationEvent,
  type: string,
  typeDef: NotificationTypeDef,
): DispatchedNotification {
  return {
    ...event,
    type,
    severity: typeDef.defaultSeverity,
  };
}

/** Sends `dispatched` through every channel this type has available, resolving per-user
 * email/in_app recipients from their preferences. Never throws - each channel's own result is
 * recorded into channelsSent/failures, not propagated.
 *
 * Every channel dispatches concurrently, not sequentially: packages/mailer's Graph/Power Automate
 * adapters put no bound on their own outbound HTTP call (only Graph's token fetch has a
 * timeout - the actual sendMail request does not), so a stalled mail provider must not delay or
 * block the independent webhook/in-app sends the way a strictly sequential await chain would.
 * Resolving per-user channel preferences (splitRecipientsByChannel) is wrapped in its own
 * try/catch for the same reason a channel's own send() never propagates a throw: a transient
 * failure there must not discard an already-in-flight (or already-recorded) webhook success. */
async function dispatchToChannels(
  db: Db,
  dispatched: DispatchedNotification,
  typeDef: NotificationTypeDef,
  candidates: string[],
  type: string,
  deps: DispatchDeps,
  disabledChannels: NotificationChannelKey[],
): Promise<DispatchOutcome> {
  // extra_email_recipients (org-staff-audience types only) is a team-wide address list
  // independent of any individual admin's personal opt-out.
  const includeExtraRecipients = typeDef.audience === "org-staff";
  const emailChannel =
    deps.channels?.email ??
    new EmailChannel(db, { includeExtraRecipients, env: deps.env, exportSink: deps.exportSink });
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

  const pending: Array<Promise<void>> = [];
  // Every shipped channel's send() is documented, and today verified, to never throw - but
  // nothing in the type system enforces that for a future or custom channel (DispatchDeps lets a
  // caller inject an arbitrary NotificationChannel). Without this .catch, one channel violating
  // that contract would reject the Promise.all below and silently discard every OTHER channel's
  // already-recorded outcome, including a real delivery a sibling channel's .then(record(...))
  // already ran.
  const dispatch = (channel: string, promise: Promise<NotificationSendResult>): void => {
    pending.push(
      promise.then(
        (result) => record(channel, result),
        (err) => record(channel, { ok: false, error: formatDispatchError(err) }),
      ),
    );
  };

  if (typeDef.availableChannels.includes("webhook") && !disabledChannels.includes("webhook")) {
    dispatch("webhook", webhookChannel.send(dispatched, []));
  }

  // Falls back to "nobody personally opted in" (not "skip email entirely") on failure: a
  // configured team distro (extra_email_recipients) has nothing to do with per-user preferences,
  // so a preference-lookup failure must not also suppress it - only the per-user-gated portion
  // (personal email opt-ins, in_app) is actually affected by this failure.
  let recipients: { emailRecipients: string[]; inAppRecipients: string[] };
  try {
    recipients = await splitRecipientsByChannel(db, candidates, type);
  } catch (err) {
    const error = formatDispatchError(err);
    // Same disabledChannels guard as the two dispatch() calls below - a channel the org disabled
    // for this type was never going to be attempted, so a failure here must not report it as a
    // failed delivery (misleading audit trail) alongside channels that genuinely couldn't run.
    if (typeDef.availableChannels.includes("email") && !disabledChannels.includes("email")) {
      outcome.failures.push({ channel: "email", error });
    }
    if (typeDef.availableChannels.includes("in_app") && !disabledChannels.includes("in_app")) {
      outcome.failures.push({ channel: "in_app", error });
    }
    recipients = { emailRecipients: [], inAppRecipients: [] };
  }

  const { emailRecipients, inAppRecipients } = recipients;
  // EmailChannel itself no-ops (ok: true) when there is nothing to send, so calling it whenever
  // extras might apply is never wasted beyond one lightweight settings lookup.
  if (
    typeDef.availableChannels.includes("email") &&
    !disabledChannels.includes("email") &&
    (emailRecipients.length > 0 || includeExtraRecipients)
  ) {
    dispatch("email", emailChannel.send(dispatched, emailRecipients));
  }
  if (
    typeDef.availableChannels.includes("in_app") &&
    !disabledChannels.includes("in_app") &&
    inAppRecipients.length > 0
  ) {
    dispatch("in_app", inAppChannel.send(dispatched, inAppRecipients));
  }

  await Promise.all(pending);
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
 * registry lookup → org-disabled check → throttle claim → audience resolution →
 * webhook (once, team-wide) → email/in-app (per candidate, per-user preferences) →
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
  let activeClaim: { throttleKey: string; rowId: string } | null = null;
  try {
    const typeDef = getNotificationTypeDef(type);
    if (!typeDef) {
      reportUnknownType(type);
      return;
    }

    const { disabledChannelsByType } = await readOrgSettings(db, event.organizationId);
    const disabledChannels = typeDef.orgDisableable ? (disabledChannelsByType[type] ?? []) : [];
    // Fully disabled across every channel this type can even use - same fast path as before the
    // per-channel matrix: skip audience resolution and the throttle claim entirely, not just the
    // channel sends, since nothing downstream would do anything either way. The length check
    // guards a type with zero availableChannels: Array.every() on an empty array is vacuously
    // true, which would otherwise misreport "org disabled" for a type that was never wired to any
    // channel in the first place (and has nothing configured to disable).
    if (
      typeDef.orgDisableable &&
      typeDef.availableChannels.length > 0 &&
      typeDef.availableChannels.every((ch) => disabledChannels.includes(ch))
    ) {
      await writeDispatchAuditLog(db, "notification.dispatch.skipped_org_disabled", event.organizationId, {
        notification_type: type,
      });
      return;
    }

    const now = deps.now?.() ?? new Date();
    const throttleKey = `${event.organizationId}:${event.dedupeKey ?? "org"}`;
    const windowMinutes = typeDef.throttleWindowMinutes ?? DEFAULT_THROTTLE_WINDOW_MINUTES;
    const rowId = await claimThrottleSlot(db, type, throttleKey, windowMinutes, now);
    if (!rowId) {
      await writeDispatchAuditLog(db, "notification.dispatch.skipped_throttled", event.organizationId, {
        notification_type: type,
      });
      return;
    }
    activeClaim = { throttleKey, rowId };

    const candidates = await resolveCandidatesOrLogSkip(db, type, typeDef, event);
    if (!candidates) {
      await releaseThrottleSlot(db, type, throttleKey, rowId);
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
      disabledChannels,
    );

    // Nothing was actually delivered on any channel - either every channel failed, or every
    // channel was a legitimate noop (nothing configured/nobody opted in). Release so a real
    // later occurrence of this incident isn't silently suppressed by a claim that never
    // communicated anything. A *partial* success (some channels sent, one failed) keeps the
    // claim: releasing there would let the channels that already delivered resend/spam on the
    // next occurrence while only the genuinely-still-broken channel needed a retry.
    if (channelsSent.length === 0) {
      await releaseThrottleSlot(db, type, throttleKey, rowId);
    }

    if (failures.length > 0) {
      await writeDispatchAuditLog(db, "notification.dispatch.failed", event.organizationId, {
        notification_type: type,
        channels_sent: channelsSent,
        failures,
      });
      return;
    }

    if (channelsSent.length === 0) {
      await writeDispatchAuditLog(db, "notification.dispatch.skipped_no_recipients", event.organizationId, {
        notification_type: type,
      });
      return;
    }

    await writeDispatchAuditLog(db, "notification.dispatch.sent", event.organizationId, {
      notification_type: type,
      channels_sent: channelsSent,
      ...(disabledChannels.length > 0 ? { disabled_channels: disabledChannels } : {}),
    });
  } catch (err) {
    if (activeClaim) {
      await releaseThrottleSlot(db, type, activeClaim.throttleKey, activeClaim.rowId);
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
