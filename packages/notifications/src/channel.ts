import type { DispatchedNotification } from "./types.js";

export interface NotificationSendResult {
  ok: boolean;
  /** Human-readable, already-sanitized failure reason (no secrets/URLs/tokens) - safe to store
   * in SecurityAuditLog.metadata. Omitted on success. */
  error?: string;
  /** True when `ok` is a "nothing to do" success, not an actual delivery - no webhook URL
   * configured, no address resolved to send to. dispatcher.ts uses this to keep
   * SecurityAuditLog.metadata.channels_sent honest: a channel that was skipped must not be
   * reported as having delivered the alert. Omitted (falsy) on a real send. */
  noop?: boolean;
}

/**
 * Domain boundary for one delivery channel (ADR 0002/0009 provider pattern - same shape as
 * @admitto/wallet's WalletPassProvider). dispatcher.ts depends only on this interface, never on
 * a concrete channel. Must never throw: a channel-level failure is always reported through the
 * returned result so the dispatcher can keep going and write it to the audit trail.
 *
 * `recipientUserIds` is meaningful for email/in_app (one send/insert per id); WebhookChannel
 * ignores it - the webhook is a single team-wide destination, sent once per event regardless of
 * how many candidates resolved.
 */
export interface NotificationChannel {
  readonly channel: "email" | "webhook" | "in_app";
  send(event: DispatchedNotification, recipientUserIds: string[]): Promise<NotificationSendResult>;
}
