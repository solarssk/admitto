import type { PrismaClient, EmailDelivery } from "@admitto/db";
import { redactEmail } from "@admitto/shared";

/** Delivery statuses that may still be flipped to bounced by IMAP ingest. */
export const NON_TERMINAL = ["queued", "accepted", "sent"] as const;
const MAX_EMAIL_LEN = 320;

export function normalizeBounceRecipientEmail(recipientEmail: string): string {
  return recipientEmail.trim().toLowerCase().slice(0, MAX_EMAIL_LEN);
}

/**
 * Newest non-terminal EmailDelivery per recipient for one event.
 *
 * One `findMany` per call (folder/poll batch). Emails are normalized to lowercase;
 * writes already store lowercase (`claim.ts`), so `in` is exact.
 *
 * Known v1 limitation (ADR 0039): if the same recipient has two in-flight rows
 * for the same event, we take the most recent by queued_at - no per-delivery VERP.
 */
export async function findDeliveriesForBounceBatch(
  db: PrismaClient,
  params: { eventId: string; recipientEmails: readonly string[] },
): Promise<Map<string, EmailDelivery>> {
  const emails = [
    ...new Set(
      params.recipientEmails
        .map((e) => normalizeBounceRecipientEmail(e))
        .filter((e) => e.length > 0),
    ),
  ];
  if (!params.eventId || emails.length === 0) return new Map();

  const rows = await db.emailDelivery.findMany({
    where: {
      event_id: params.eventId,
      recipient_email: { in: emails },
      status: { in: [...NON_TERMINAL] },
    },
    orderBy: { queued_at: "desc" },
  });

  const byRecipient = new Map<string, EmailDelivery>();
  for (const row of rows) {
    if (!row.recipient_email) continue;
    const key = normalizeBounceRecipientEmail(row.recipient_email);
    if (!key || byRecipient.has(key)) continue;
    byRecipient.set(key, row);
  }
  return byRecipient;
}

/**
 * Find the newest non-terminal EmailDelivery for this event + recipient.
 * Prefer `findDeliveriesForBounceBatch` when applying many lines in one tick.
 */
export async function findDeliveryForBounce(
  db: PrismaClient,
  params: { eventId: string; recipientEmail: string },
): Promise<EmailDelivery | null> {
  const email = normalizeBounceRecipientEmail(params.recipientEmail);
  if (!email || !params.eventId) return null;

  const map = await findDeliveriesForBounceBatch(db, {
    eventId: params.eventId,
    recipientEmails: [email],
  });
  return map.get(email) ?? null;
}

/** Redact an email for log lines (no full local-part; also bound length). */
export function truncateEmailForLog(email: string): string {
  return redactEmail(normalizeBounceRecipientEmail(email));
}
