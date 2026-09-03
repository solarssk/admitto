import type { PrismaClient } from "./generated/prisma/client.js";

const WALLET_CTA_TOKENS = ["{{apple_wallet_url}}", "{{google_wallet_url}}"] as const;

/** True when `index` (the start of a `{{...}}` match) sits inside `<!-- ... -->`, including
 * Outlook `<!--[if mso]>...<![endif]-->` blocks. A deliberate, minimal mirror of
 * mail-templates/src/htmlContext.ts's own isPlaceholderInHtmlComment - packages/db can't import
 * @admitto/mail-templates (that package already depends on @admitto/db, so the reverse would be
 * circular), and this backfill only ever needs this one check, not that package's full
 * placeholder-extraction machinery. Keep in sync with the canonical implementation if that one's
 * comment-matching logic ever changes. */
function isInsideHtmlComment(html: string, index: number): boolean {
  const commentStart = html.lastIndexOf("<!--", index);
  if (commentStart === -1) return false;
  const commentEnd = html.indexOf("-->", commentStart);
  return commentEnd === -1 || commentEnd + 2 > index;
}

/** Whether html contains a wallet-add-link token outside any HTML/Outlook comment - mirrors
 * templateHasWalletCta's own compiledHtmlTemplate check (mail-delivery/src/send.ts), which uses
 * extractPlaceholderNamesFromHtml specifically so a commented-out reference doesn't count as a
 * live one. A raw substring/LIKE match alone (this function's own previous implementation) can't
 * tell the two apart, so it over-counted a delivery whose only reference was inside a comment.
 * Builds its own regex literal per call (not a shared module-level one) so its own `g`-flag
 * position state can never leak between calls on different rows - a scan that returns early via
 * the loop's own `return true` would otherwise leave a stale lastIndex for whichever row runs
 * next. */
function hasLiveWalletCtaToken(html: string): boolean {
  const tokenPattern = /\{\{(apple_wallet_url|google_wallet_url)\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(html)) !== null) {
    if (!isInsideHtmlComment(html, match.index)) return true;
  }
  return false;
}

/**
 * Idempotent backfill: sets EmailDelivery.had_wallet_cta for rows sent before that column
 * existed, by re-inspecting their own frozen rendered_html/rendered_subject for the two
 * wallet-add-link placeholder tokens - the same two fields templateHasWalletCta (send.ts) checks
 * for a live send, so a historical row can't end up with a narrower definition than a new one.
 * Unlike template_label_snapshot's backfill (which has to re-join a still-live MailTemplate row,
 * since the template's own text isn't otherwise recoverable), this doesn't need the template at
 * all: apple_wallet_url/google_wallet_url are STORAGE_DEFERRED_LINK_PLACEHOLDERS
 * (materializeStoredDeliveryMessage, mail-templates package) - rendered_html/rendered_subject keep
 * their literal `{{token}}` text forever, never the substituted link, so a pre-existing row's own
 * frozen content already answers the question directly, no join needed (and none possible for a
 * since-deleted or since-edited template anyway).
 *
 * A cheap `contains` filter only narrows the candidate set (any row that could plausibly need
 * updating); the authoritative check runs in JS per candidate below, since SQL alone can't tell a
 * live token from one sitting inside an HTML/Outlook comment (rendered_subject has no such markup
 * to worry about, so a plain substring match there is already authoritative on its own).
 *
 * Runs automatically after `npm run db:migrate`; safe to re-run manually.
 */
export async function backfillEmailDeliveryHadWalletCta(prisma: PrismaClient): Promise<{ updated: number }> {
  const candidates = await prisma.emailDelivery.findMany({
    where: {
      had_wallet_cta: false,
      OR: WALLET_CTA_TOKENS.flatMap((token) => [
        { rendered_html: { contains: token } },
        { rendered_subject: { contains: token } },
      ]),
    },
    select: { id: true, rendered_html: true, rendered_subject: true },
  });

  const idsToUpdate = candidates
    .filter((row) => {
      const inSubject =
        row.rendered_subject != null &&
        WALLET_CTA_TOKENS.some((token) => row.rendered_subject!.includes(token));
      const inHtml = row.rendered_html != null && hasLiveWalletCtaToken(row.rendered_html);
      return inSubject || inHtml;
    })
    .map((row) => row.id);

  if (idsToUpdate.length === 0) return { updated: 0 };

  const result = await prisma.emailDelivery.updateMany({
    where: { id: { in: idsToUpdate } },
    data: { had_wallet_cta: true },
  });
  return { updated: result.count };
}
