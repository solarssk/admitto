import type { PrismaClient } from "./generated/prisma/client.js";

/**
 * Idempotent backfill: sets EmailDelivery.had_wallet_cta for rows sent before that column
 * existed, by re-inspecting their own frozen rendered_html for the two wallet-add-link
 * placeholder tokens. Unlike template_label_snapshot's backfill (which has to re-join a
 * still-live MailTemplate row, since the template's own text isn't otherwise recoverable), this
 * doesn't need the template at all: apple_wallet_url/google_wallet_url are
 * STORAGE_DEFERRED_LINK_PLACEHOLDERS (materializeStoredDeliveryMessage, mail-templates package) -
 * rendered_html keeps their literal `{{token}}` text forever, never the substituted link, so a
 * pre-existing row's own frozen content already answers the question directly, no join needed
 * (and none possible for a since-deleted or since-edited template anyway).
 *
 * Runs automatically after `npm run db:migrate`; safe to re-run manually.
 */
export async function backfillEmailDeliveryHadWalletCta(prisma: PrismaClient): Promise<{ updated: number }> {
  const updated = await prisma.$executeRaw`
    UPDATE "EmailDelivery"
    SET had_wallet_cta = true
    WHERE had_wallet_cta = false
      AND rendered_html IS NOT NULL
      AND (rendered_html LIKE '%{{apple_wallet_url}}%' OR rendered_html LIKE '%{{google_wallet_url}}%')
  `;
  return { updated };
}
