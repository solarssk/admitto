import type { PrismaClient, EmailDelivery } from "@admitto/db";
import { redactEmail } from "@admitto/shared";

/** Delivery statuses that may still be flipped to bounced by IMAP ingest. */
export const NON_TERMINAL = ["queued", "accepted", "sent"] as const;
const MAX_EMAIL_LEN = 320;

/**
 * Find the newest non-terminal EmailDelivery for this event + recipient.
 *
 * Known v1 limitation (ADR 0039): if the same recipient has two in-flight rows
 * for the same event (e.g. resend queued before the initial bounce arrives),
 * we take the most recent by queued_at - no per-delivery VERP.
 *
 * `recipientEmail` is untrusted parser output: bound Prisma param only; redacted for logs.
 */
export async function findDeliveryForBounce(
  db: PrismaClient,
  params: { eventId: string; recipientEmail: string },
): Promise<EmailDelivery | null> {
  const email = params.recipientEmail.trim().toLowerCase().slice(0, MAX_EMAIL_LEN);
  if (!email || !params.eventId) return null;

  return db.emailDelivery.findFirst({
    where: {
      event_id: params.eventId,
      recipient_email: email,
      status: { in: [...NON_TERMINAL] },
    },
    orderBy: { queued_at: "desc" },
  });
}

/** Redact an email for log lines (no full local-part; also bound length). */
export function truncateEmailForLog(email: string): string {
  return redactEmail(email.trim().toLowerCase().slice(0, MAX_EMAIL_LEN));
}
