import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { AttendeeRow, ImportOptions, ImportSummary, SkippedRow } from "./types.js";

/** Fields updated on an existing attendee when overwrite=true. Never includes status, qr_payload, external_uuid, or token. */
const OVERWRITE_FIELDS = ["name", "ticket_type", "company", "department"] as const;

type AttendeeCreateData = {
  event_id: string;
  email: string;
  name: string;
  token: string;
  ticket_type?: string;
  external_uuid?: string;
  qr_payload?: string;
  company?: string;
  department?: string;
};

type AttendeeUpdateArgs = {
  id: string;
  data: {
    name: string;
    ticket_type?: string;
    company?: string;
    department?: string;
  };
};

/**
 * Commit validated attendee rows to the database.
 *
 * @param eventId   - Target event ID (must exist in DB).
 * @param rows      - Validated rows from parseAttendees().
 * @param options   - overwrite and dryRun flags (both default false).
 * @param db        - Injectable Prisma client (defaults to shared singleton from @admitto/db).
 */
export async function commitImport(
  eventId: string,
  rows: AttendeeRow[],
  options: ImportOptions = {},
  db?: PrismaClient,
): Promise<ImportSummary> {
  const { overwrite = false, dryRun = false } = options;

  // Lazy-load to keep the package usable without @admitto/db when dry-running with mocks.
  const prisma = db ?? (await import("@admitto/db")).prisma;

  // Pre-fetch all candidates in a single query to avoid N+1.
  const emails = rows.map((r) => r.email);
  const uuids = rows.flatMap((r) => (r.external_uuid ? [r.external_uuid] : []));
  const existingList = await prisma.attendee.findMany({
    where: {
      event_id: eventId,
      OR: [
        { email: { in: emails } },
        ...(uuids.length > 0 ? [{ external_uuid: { in: uuids } }] : []),
      ],
    },
  });
  const byUUID = new Map(existingList.filter((a) => a.external_uuid).map((a) => [a.external_uuid!, a]));
  const byEmail = new Map(existingList.map((a) => [a.email, a]));

  // Classify rows — pure in-memory, no DB calls inside loop.
  const creates: AttendeeCreateData[] = [];
  const updates: AttendeeUpdateArgs[] = [];
  const skipped: SkippedRow[] = [];

  for (const row of rows) {
    const name = [row.first_name, row.last_name].filter(Boolean).join(" ");

    // Match strategy: external_uuid first (Mode B), then email (Mode A).
    const found = row.external_uuid ? byUUID.get(row.external_uuid) : byEmail.get(row.email);

    if (found) {
      if (!overwrite) {
        skipped.push({ email: row.email, reason: "Attendee already exists (overwrite=false)" });
        continue;
      }
      // overwrite=true — update presentation/profile fields only.
      // Never touch: status, qr_payload, external_uuid, token.
      updates.push({
        id: found.id,
        data: {
          name,
          ...(row.ticket_type !== undefined && { ticket_type: row.ticket_type }),
          ...(row.company !== undefined && { company: row.company }),
          ...(row.department !== undefined && { department: row.department }),
        },
      });
    } else {
      creates.push({
        event_id: eventId,
        email: row.email,
        name,
        // Step-1 compatibility shim — replaced in Step 2 by real token hash.
        // Must NOT be used for QR generation, ticket URLs, mail sending, or check-in.
        token: `IMPORT_PLACEHOLDER_${randomUUID()}`,
        ...(row.ticket_type !== undefined && { ticket_type: row.ticket_type }),
        ...(row.external_uuid !== undefined && { external_uuid: row.external_uuid }),
        ...(row.qr_payload !== undefined && { qr_payload: row.qr_payload }),
        ...(row.company !== undefined && { company: row.company }),
        ...(row.department !== undefined && { department: row.department }),
      });
    }
  }

  const summary: ImportSummary = {
    toCreate: creates.length,
    toUpdate: updates.length,
    toSkip: skipped.length,
    created: 0,
    updated: 0,
    skipped,
  };

  if (!dryRun && (creates.length > 0 || updates.length > 0)) {
    await prisma.$transaction([
      ...creates.map((data) => prisma.attendee.create({ data })),
      ...updates.map(({ id, data }) => prisma.attendee.update({ where: { id }, data })),
    ]);
    summary.created = creates.length;
    summary.updated = updates.length;
  }

  return summary;
}

// Suppress unused import warning for OVERWRITE_FIELDS — it documents intent even if not iterated.
void (OVERWRITE_FIELDS satisfies readonly string[]);
