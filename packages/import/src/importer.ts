import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { AttendeeRow, ImportOptions, ImportSummary, SkippedRow } from "./types.js";

/** Allowlist of fields that may be updated on an existing attendee when overwrite=true. */
const OVERWRITE_FIELDS = ["name", "ticket_type", "company", "department"] as const;

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

  let toCreate = 0;
  let toUpdate = 0;
  let toSkip = 0;
  let created = 0;
  let updated = 0;
  const skipped: SkippedRow[] = [];

  for (const row of rows) {
    const name = [row.first_name, row.last_name].filter(Boolean).join(" ");

    // Match strategy: external_uuid first (Mode B), then email (Mode A).
    const existing = row.external_uuid
      ? await prisma.attendee.findUnique({ where: { event_id_external_uuid: { event_id: eventId, external_uuid: row.external_uuid } } })
      : await prisma.attendee.findUnique({ where: { event_id_email: { event_id: eventId, email: row.email } } });

    if (existing) {
      if (!overwrite) {
        toSkip++;
        skipped.push({ email: row.email, reason: "Attendee already exists (overwrite=false)" });
        continue;
      }

      // overwrite=true — update presentation/profile fields only.
      // Never touch: status, qr_payload, external_uuid, token.
      toUpdate++;
      if (!dryRun) {
        await prisma.attendee.update({
          where: { id: existing.id },
          data: {
            name,
            ...(row.ticket_type !== undefined && { ticket_type: row.ticket_type }),
            ...(row.company !== undefined && { company: row.company }),
            ...(row.department !== undefined && { department: row.department }),
          },
        });
        updated++;
      }
    } else {
      toCreate++;
      if (!dryRun) {
        await prisma.attendee.create({
          data: {
            event_id: eventId,
            email: row.email,
            name,
            // Step-1 compatibility shim — replaced in Step 2 by real token hash.
            // Must NOT be used for QR generation, ticket URLs, mail sending, or check-in.
            token: randomUUID(),
            ...(row.ticket_type !== undefined && { ticket_type: row.ticket_type }),
            ...(row.external_uuid !== undefined && { external_uuid: row.external_uuid }),
            ...(row.qr_payload !== undefined && { qr_payload: row.qr_payload }),
            ...(row.company !== undefined && { company: row.company }),
            ...(row.department !== undefined && { department: row.department }),
          },
        });
        created++;
      }
    }
  }

  return { toCreate, toUpdate, toSkip, created, updated, skipped };
}

// Suppress unused import warning for OVERWRITE_FIELDS — it documents intent even if not iterated.
void (OVERWRITE_FIELDS satisfies readonly string[]);
