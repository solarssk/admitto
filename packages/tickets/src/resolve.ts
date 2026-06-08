import type { PrismaClient } from "@prisma/client";
import { hashToken } from "./hash.js";
import { extractTokenFromUrl, looksLikeInternalToken } from "./url.js";
import type { ResolvedTicket } from "./types.js";

/**
 * Resolve a scanned value to an attendee + event record.
 *
 * Resolution order:
 *   1. Full ticket URL  → extract token → sha256 → lookup by token_hash  (Mode A)
 *   2. Raw internal token (base64url ~43 chars) → sha256 → lookup by token_hash  (Mode A)
 *   3. Exact match on qr_payload  (Mode B)
 *   4. Exact match on external_uuid  (Mode B)
 *
 * Returns null when no attendee is found.
 * The same resolver is reused by the check-in flow in Step 3.
 */
export async function resolveTicket(
  scanned: string,
  prisma: PrismaClient,
): Promise<ResolvedTicket | null> {
  // Mode A — URL or raw token
  const rawToken = extractTokenFromUrl(scanned) ?? (looksLikeInternalToken(scanned) ? scanned : null);

  if (rawToken) {
    const hash = hashToken(rawToken);
    const row = await prisma.attendee.findUnique({
      where: { token_hash: hash },
      include: { event: true },
    });
    if (row) return toResolved(row, "internal");
  }

  // Mode B — agency qr_payload
  const byQr = await prisma.attendee.findFirst({
    where: { qr_payload: scanned },
    include: { event: true },
  });
  if (byQr) return toResolved(byQr, "agency");

  // Mode B — agency external_uuid
  const byUuid = await prisma.attendee.findFirst({
    where: { external_uuid: scanned },
    include: { event: true },
  });
  if (byUuid) return toResolved(byUuid, "agency");

  return null;
}

function toResolved(
  row: {
    id: string; event_id: string; email: string; name: string; status: string;
    token_hash: string | null; qr_payload: string | null; external_uuid: string | null;
    ticket_type: string | null;
    event: { id: string; title: string; date: Date; location: string | null };
  },
  mode: ResolvedTicket["mode"],
): ResolvedTicket {
  return {
    mode,
    attendee: {
      id: row.id,
      event_id: row.event_id,
      email: row.email,
      name: row.name,
      status: row.status,
      token_hash: row.token_hash,
      qr_payload: row.qr_payload,
      external_uuid: row.external_uuid,
      ticket_type: row.ticket_type,
    },
    event: row.event,
  };
}
