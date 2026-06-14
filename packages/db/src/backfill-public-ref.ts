import type { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

/** Same format as `@admitto/crypto` `generateToken` (32 CSPRNG bytes, base64url). */
function generatePublicRef(): string {
  return randomBytes(32).toString("base64url");
}

/** Agency attendee = has qr_payload or external_uuid (Mode B). */
export function isAgencyAttendee(row: {
  qr_payload: string | null;
  external_uuid: string | null;
}): boolean {
  return row.qr_payload !== null || row.external_uuid !== null;
}

/**
 * Idempotent backfill: assign unique public_ref to agency attendees missing one.
 * Runs automatically after `npm run db:migrate`; safe to re-run manually.
 */
export async function backfillAgencyPublicRefs(
  prisma: PrismaClient,
): Promise<{ updated: number }> {
  const rows = await prisma.attendee.findMany({
    where: {
      public_ref: null,
      OR: [{ qr_payload: { not: null } }, { external_uuid: { not: null } }],
    },
    select: { id: true },
  });

  let updated = 0;
  for (const row of rows) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const { count } = await prisma.attendee.updateMany({
          where: { id: row.id, public_ref: null },
          data: { public_ref: generatePublicRef() },
        });
        if (count === 1) {
          updated += 1;
          break;
        }
        break;
      } catch (err: unknown) {
        const code =
          err && typeof err === "object" && "code" in err
            ? (err as { code: string }).code
            : undefined;
        if (code === "P2002" && attempt < 4) continue;
        throw err;
      }
    }
  }

  return { updated };
}
