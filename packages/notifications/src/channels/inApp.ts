import type { Prisma, PrismaClient } from "@admitto/db";
import { sanitizeDeliveryError } from "@admitto/mail-delivery";
import type { NotificationChannel, NotificationSendResult } from "../channel.js";
import type { DispatchedNotification } from "../types.js";

type Db = PrismaClient | Prisma.TransactionClient;

const GENERIC_WRITE_FAILED = "In-app write failed.";

/**
 * In-app delivery - inserts one Notification row per recipient. Always `ok: true` on a
 * successful insert: no external call, no SSRF/timeout to handle (prompt 86 §2.A).
 */
export class InAppChannel implements NotificationChannel {
  readonly channel = "in_app" as const;

  constructor(private readonly db: Db) {}

  async send(
    event: DispatchedNotification,
    recipientUserIds: string[],
  ): Promise<NotificationSendResult> {
    if (recipientUserIds.length === 0) return { ok: true, noop: true };
    try {
      await this.db.notification.createMany({
        data: recipientUserIds.map((userId) => ({
          user_id: userId,
          notification_type: event.type,
          severity: event.severity,
          title: event.title,
          body: event.body,
          metadata: (event.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        })),
      });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Same sanitization every other channel applies to its own failure text (dispatcher.ts
      // stores this in SecurityAuditLog.metadata) - a raw driver/Postgres error can otherwise
      // include connection details or query fragments.
      return { ok: false, error: sanitizeDeliveryError(message) ?? GENERIC_WRITE_FAILED };
    }
  }
}
