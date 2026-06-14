import type { PrismaClient } from "@prisma/client";
import { generateToken } from "@admitto/crypto";

/** Agency attendee = has qr_payload or external_uuid (Mode B). */
export function isAgencyAttendee(row: {
  qr_payload: string | null;
  external_uuid: string | null;
}): boolean {
  return row.qr_payload !== null || row.external_uuid !== null;
}

/**
 * Idempotent backfill: assign unique public_ref to agency attendees missing one.
 * Run after migrate, before deploying app that looks up by public_ref only.
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
        await prisma.attendee.update({
          where: { id: row.id },
          data: { public_ref: generateToken() },
        });
        updated += 1;
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
