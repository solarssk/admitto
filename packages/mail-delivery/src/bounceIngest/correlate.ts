import type { PrismaClient, EmailDelivery } from "@admitto/db";
import { redactEmail } from "@admitto/shared";

/** Delivery statuses that may still be flipped to bounced by IMAP ingest. */
export const NON_TERMINAL = ["queued", "accepted", "sent"] as const;
const MAX_EMAIL_LEN = 320;

export function normalizeBounceRecipientEmail(recipientEmail: string): string {
  return recipientEmail.trim().toLowerCase().slice(0, MAX_EMAIL_LEN);
}

/**
 * Non-terminal EmailDelivery rows per recipient for one event (newest `queued_at` first).
 *
 * One `findMany` per call (folder/poll batch). Emails are normalized to lowercase;
 * writes already store lowercase (`claim.ts`), so `in` is exact.
 *
 * Callers apply lines newest-first; after a hard bounce they should drop that row so a
 * later NDR line in the same poll can still mark an older in-flight resend/send.
 * Without VERP (ADR 0039), a single NDR still cannot target a specific delivery id.
 */
export async function findDeliveriesForBounceBatch(
  db: PrismaClient,
  params: { eventId: string; recipientEmails: readonly string[] },
): Promise<Map<string, EmailDelivery[]>> {
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

  const byRecipient = new Map<string, EmailDelivery[]>();
  for (const row of rows) {
    if (!row.recipient_email) continue;
    const key = normalizeBounceRecipientEmail(row.recipient_email);
    if (!key) continue;
    const list = byRecipient.get(key);
    if (list) list.push(row);
    else byRecipient.set(key, [row]);
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
  return map.get(email)?.[0] ?? null;
}

/** Redact an email for log lines (no full local-part; also bound length). */
export function truncateEmailForLog(email: string): string {
  return redactEmail(normalizeBounceRecipientEmail(email));
}
