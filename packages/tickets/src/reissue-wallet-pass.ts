import type { PrismaClient } from "@admitto/db";
import { decryptFromString } from "@admitto/crypto";
import { eventEndsAtUtc } from "@admitto/shared";
import { WalletProviderError, type WalletPassProvider } from "@admitto/wallet";
import { resolveTicket } from "./resolve.js";
import { resolveTicketPageDisplay, buildWalletPassInput } from "./wallet-pass-input.js";
import { resolveWalletCustomFieldPlaceholders } from "./wallet-custom-fields.js";
import { lockAttendeeRow } from "./attendee-lock.js";
import { attendeeIsLive } from "./lock-check.js";
import { writeActionLog, type OpsAuditContext } from "./ops-audit.js";

/**
 * Rebuilds one attendee's wallet pass from their current data - shared by the single-attendee
 * "Push updates" action, its bulk sibling, and event-settings' own best-effort push when an
 * event's wallet-relevant fields change (one implementation, three callers - previously
 * apps/web-local, moved here so the CLI worker's wallet_push job drain can reuse it too, not
 * reimplement it). Attendees with no resolvable ticket (never issued) count as skipped, matching
 * the single-attendee route's 409.
 *
 * A pass removed at the provider (`provider_removed_at` set) is never touched: a caller that
 * already knows passes `providerRemovedAt` and gets an early skip without a provider call, and both
 * database writes below carry `provider_removed_at: null` in their own where clause, so a removal
 * that lands while the provider call is in flight freezes the row atomically instead of being
 * overwritten (or logged as a reissue).
 */
export async function reissueOneWalletPass(
  db: PrismaClient,
  eventId: string,
  target: { attendeeId: string; providerPassId: string; providerRemovedAt?: Date | null },
  provider: WalletPassProvider,
  audit: OpsAuditContext,
): Promise<"reissued" | "skipped"> {
  if (target.providerRemovedAt) return "skipped";
  const attendee = await db.attendee.findUnique({
    where: { id: target.attendeeId },
    select: { qr_payload: true, external_uuid: true, token_enc: true, erased_at: true },
  });
  // An erased attendee has no credential left to push, and nothing about them goes to the provider.
  if (!attendee || attendee.erased_at) return "skipped";
  const scanned =
    attendee.qr_payload ?? attendee.external_uuid ?? (attendee.token_enc ? decryptFromString(attendee.token_enc) : null);
  if (!scanned) return "skipped";

  const resolved = await resolveTicket(scanned, db, { eventId });
  if (!resolved) return "skipped";

  const display = await resolveTicketPageDisplay(db, resolved);
  const customFieldPlaceholders = await resolveWalletCustomFieldPlaceholders(
    db,
    eventId,
    display.attendee.custom_data,
    display.event.walletFieldMapping,
  );
  const input = buildWalletPassInput(display, scanned, customFieldPlaceholders);

  // The last check before the pass content leaves. Everything above was read with plain queries,
  // which do not wait for an erasure that is still open and would show the attendee as they were
  // before it began; this one takes the attendee's row lock first, so that erasure finishes and is
  // seen. Only the gap between this check and the provider call is left.
  if (!(await attendeeIsLive(db, target.attendeeId))) return "skipped";

  let result;
  try {
    result = await provider.updatePass(target.providerPassId, input);
  } catch (err) {
    try {
      await db.walletPass.updateMany({
        where: { attendee_id: target.attendeeId, provider_removed_at: null },
        data: { last_error_code: err instanceof WalletProviderError ? err.code : "wallet_provider_rejected" },
      });
    } catch (updateErr) {
      // Bookkeeping only - must not replace the real provider error below (bot review).
      console.error("reissueOneWalletPass: failed to record last_error_code:", updateErr);
    }
    throw err;
  }

  return db.$transaction(async (tx): Promise<"reissued" | "skipped"> => {
    // Attendee row first, like an erasure: the pass is written back only for a live attendee, so
    // links never reappear on a pass an erasure cleared while the provider call was in flight,
    // and the two cannot deadlock over the pass row and the attendee row.
    const locked = await lockAttendeeRow(tx, target.attendeeId);
    if (!locked || locked.erased) return "skipped";
    // updatePass only patches the provider's content, never its voided flag (that's Restore's
    // job, a separate explicit action) - status/voided_at are deliberately left untouched here so
    // an already-voided pass stays voided instead of falsely reporting "active" while the
    // installed pass is still invalid at the provider, which would also hide the Restore action.
    const { count } = await tx.walletPass.updateMany({
      where: { attendee_id: target.attendeeId, provider_removed_at: null },
      data: {
        download_url: result.downloadUrl,
        apple_url: result.appleUrl,
        android_url: result.androidUrl,
        last_error_code: null,
        last_synced_at: new Date(),
        // Kept in sync with the same expirationDate input just pushed above (a reschedule can
        // move it), but does NOT touch provider_commanded_at the way Void/Restore do - that
        // stamp's one job is protecting a recent lifecycle COMMAND from being undone by a stale
        // read (reconcileWalletPassLifecycle's own observationStalenessWindowMs), and a reissue
        // re-asserting an already-canonical value isn't a new decision that needs that same
        // protection. Bumping it here too would extend the window on every ordinary content push
        // (an attendee-detail edit, say), which could suppress a genuine external
        // void/expire signal from the wallet service for longer than intended.
        expires_at: display.event.walletExpirationMode === "event_end" ? eventEndsAtUtc(display.event) : null,
      },
    });
    // Removed while the provider call was in flight: nothing to record, and no reissue to log.
    if (count === 0) return "skipped";
    await writeActionLog(tx, {
      event_id: eventId,
      attendee_id: target.attendeeId,
      action_type: "wallet_pass_reissued",
      audit,
      metadata: { bulk: true },
    });
    return "reissued";
  });
}
