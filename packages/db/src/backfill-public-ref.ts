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
const BACKFILL_BATCH_SIZE = 1000;
const MAX_ASSIGN_ATTEMPTS = 5;

/** Fetches the next page of agency attendees still missing a public_ref, keyset-paginated by id. */
async function fetchNextAgencyBatch(
  prisma: PrismaClient,
  cursor: string | undefined,
): Promise<{ id: string }[]> {
  return prisma.attendee.findMany({
    where: {
      public_ref: null,
      OR: [{ qr_payload: { not: null } }, { external_uuid: { not: null } }],
    },
    select: { id: true },
    take: BACKFILL_BATCH_SIZE,
    orderBy: { id: "asc" },
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });
}

/**
 * Assigns a fresh public_ref to a single attendee, retrying on unique-constraint
 * collisions (P2002) since generatePublicRef() output is random. Returns true if
 * this call set the public_ref, false if it was already set (no-op).
 */
async function assignPublicRefWithRetry(
  prisma: PrismaClient,
  id: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_ASSIGN_ATTEMPTS; attempt++) {
    try {
      const { count } = await prisma.attendee.updateMany({
        where: { id, public_ref: null },
        data: { public_ref: generatePublicRef() },
      });
      return count === 1;
    } catch (err: unknown) {
      const code =
        err && typeof err === "object" && "code" in err
          ? (err as { code: string }).code
          : undefined;
      if (code === "P2002" && attempt < MAX_ASSIGN_ATTEMPTS - 1) continue;
      throw err;
    }
  }
  return false;
}

export async function backfillAgencyPublicRefs(
  prisma: PrismaClient,
): Promise<{ updated: number }> {
  let updated = 0;
  let cursor: string | undefined;

  while (true) {
    const rows = await fetchNextAgencyBatch(prisma, cursor);
    if (rows.length === 0) break;

    for (const row of rows) {
      if (await assignPublicRefWithRetry(prisma, row.id)) {
        updated += 1;
      }
    }

    cursor = rows.at(-1)!.id;
    if (rows.length < BACKFILL_BATCH_SIZE) break;
  }

  return { updated };
}
