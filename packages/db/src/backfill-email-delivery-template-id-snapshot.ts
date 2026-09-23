import type { PrismaClient } from "./generated/prisma/client.js";

/**
 * Idempotent backfill: populates EmailDelivery.template_id_snapshot for rows written before that
 * column existed, from that same row's own still-present template_id. Without this, a
 * pre-existing delivery whose custom template is deleted *after* this migration ships would lose
 * its stable template identity the moment template_id is SetNull'd - the snapshot was never
 * captured for it, same reason this column exists for new rows. A template already deleted
 * *before* this migration ships is unrecoverable (template_id is already null, with nothing left
 * to copy), which is why the WHERE clause only ever touches rows whose template_id is still set -
 * same limitation backfill-email-delivery-template-label-snapshot.ts already accepts.
 *
 * Runs automatically after `npm run db:migrate`; safe to re-run manually.
 */
export async function backfillEmailDeliveryTemplateIdSnapshot(prisma: PrismaClient): Promise<{ updated: number }> {
  const updated = await prisma.$executeRaw`
    UPDATE "EmailDelivery"
    SET template_id_snapshot = template_id
    WHERE template_id IS NOT NULL
      AND template_id_snapshot IS NULL
  `;
  return { updated };
}
