import type { PrismaClient } from "./generated/prisma/client.js";

/**
 * Idempotent backfill: populates EmailDelivery.template_label_snapshot for rows written before
 * that column existed, from the still-live MailTemplate.label their template_id currently joins
 * to. Without this, a pre-existing delivery whose custom template is deleted *after* this
 * migration ships would still lose its label the moment template_id is SetNull'd - the snapshot
 * was never captured for it, same bug this column exists to prevent, just for old rows instead of
 * new ones. A template already deleted *before* this migration ships is unrecoverable (template_id
 * is already null with nothing left to join), which is why the WHERE clause only ever touches rows
 * whose template_id still resolves to a real MailTemplate row.
 *
 * Runs automatically after `npm run db:migrate`; safe to re-run manually.
 */
export async function backfillEmailDeliveryTemplateLabelSnapshot(
  prisma: PrismaClient,
): Promise<{ updated: number }> {
  const updated = await prisma.$executeRaw`
    UPDATE "EmailDelivery" ed
    SET template_label_snapshot = mt.label
    FROM "MailTemplate" mt
    WHERE ed.template_id = mt.id
      AND ed.template_label_snapshot IS NULL
  `;
  return { updated };
}
