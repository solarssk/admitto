import type { PrismaClient } from "@admitto/db";
import { decryptFromString } from "@admitto/crypto";
import { WalletProviderError, type WalletPassProvider } from "@admitto/wallet";
import { resolveTicket } from "./resolve.js";
import { resolveTicketPageDisplay, buildWalletPassInput } from "./wallet-pass-input.js";
import { writeActionLog, type OpsAuditContext } from "./ops-audit.js";

/**
 * Rebuilds one attendee's wallet pass from their current data - shared by the single-attendee
 * "Push updates" action, its bulk sibling, and event-settings' own best-effort push when an
 * event's wallet-relevant fields change (one implementation, three callers - previously
 * apps/web-local, moved here so the CLI worker's wallet_push job drain can reuse it too, not
 * reimplement it). Attendees with no resolvable ticket (never issued) count as skipped, matching
 * the single-attendee route's 409.
 */
export async function reissueOneWalletPass(
  db: PrismaClient,
  eventId: string,
  target: { attendeeId: string; providerPassId: string },
  provider: WalletPassProvider,
  audit: OpsAuditContext,
): Promise<"reissued" | "skipped"> {
  const attendee = await db.attendee.findUnique({
    where: { id: target.attendeeId },
    select: { qr_payload: true, external_uuid: true, token_enc: true },
  });
  if (!attendee) return "skipped";
  const scanned =
    attendee.qr_payload ?? attendee.external_uuid ?? (attendee.token_enc ? decryptFromString(attendee.token_enc) : null);
  if (!scanned) return "skipped";

  const resolved = await resolveTicket(scanned, db, { eventId });
  if (!resolved) return "skipped";

  const display = await resolveTicketPageDisplay(db, resolved);
  const input = buildWalletPassInput(display, scanned);

  let result;
  try {
    result = await provider.updatePass(target.providerPassId, input);
  } catch (err) {
    await db.walletPass.update({
      where: { attendee_id: target.attendeeId },
      data: { last_error_code: err instanceof WalletProviderError ? err.code : "wallet_provider_rejected" },
    });
    throw err;
  }

  await db.$transaction(async (tx) => {
    // updatePass only patches the provider's content, never its voided flag (that's Restore's
    // job, a separate explicit action) - status/voided_at are deliberately left untouched here so
    // an already-voided pass stays voided instead of falsely reporting "active" while the
    // installed pass is still invalid at the provider, which would also hide the Restore action.
    await tx.walletPass.update({
      where: { attendee_id: target.attendeeId },
      data: {
        download_url: result.downloadUrl,
        apple_url: result.appleUrl,
        android_url: result.androidUrl,
        last_error_code: null,
        last_synced_at: new Date(),
      },
    });
    await writeActionLog(tx, {
      event_id: eventId,
      attendee_id: target.attendeeId,
      action_type: "wallet_pass_reissued",
      audit,
      metadata: { bulk: true },
    });
  });
  return "reissued";
}
