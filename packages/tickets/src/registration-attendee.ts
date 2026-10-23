import { randomUUID } from "node:crypto";
import type { Prisma } from "@admitto/db";
import { customDataValue } from "./custom-data.js";
import { filterCustomDataAttributeFields } from "./custom-data-reserved.js";
import { loadEventCustomDataFields } from "./event-custom-fields.js";
import { writeBulkActionLog, type OpsAuditContext } from "./ops-audit.js";
import type { EventItemContent } from "./types.js";
import { normalizeCustomDataFieldValue } from "./validate-custom-data.js";

/** What an attendee is made from: the fields of a registration, as a row of the table or as the data of one about to be written. */
export type RegistrationAttendeeSource = {
  /** As the registration stores it: trimmed, lower case. */
  email: string;
  first_name: string;
  last_name: string;
  company: string | null;
  department: string | null;
  custom_data: Prisma.JsonValue | null;
};

/** The event's custom fields an admitted guest's answers pass through: the fixed profile columns are not among them. */
export async function loadAdmissionFields(tx: Prisma.TransactionClient, eventId: string): Promise<EventItemContent[]> {
  return filterCustomDataAttributeFields(await loadEventCustomDataFields(tx, eventId));
}

/**
 * The answers of a registration as the attendee keeps them: only the answers to fields the event has now, each
 * as that field takes a value now. The organiser's decision comes before the form, so a field that became
 * required since is not checked again, and a field that was deleted, or whose type or options changed so that the
 * answer no longer fits, loses its answer (a value that does not fit would block every later edit of the attendee).
 */
export function attendeeCustomDataFromAnswers(
  fields: readonly EventItemContent[],
  answers: Prisma.JsonValue | null,
): Record<string, string> | undefined {
  const kept: [string, string][] = [];
  for (const field of fields) {
    const raw = customDataValue(answers, field.source_field);
    if (raw === null) continue;
    try {
      const value = normalizeCustomDataFieldValue(field, raw);
      if (value !== null) kept.push([field.source_field, value]);
    } catch {
      // The answer was valid for the field as it was; it is left out, not refused.
    }
  }
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}

/**
 * Which of these addresses are held by an attendee of the event, whatever their status (a revoked or cancelled
 * person included) and whatever the spelling their address was stored in: `lower(btrim(email))`, the form a
 * registration keeps. An erased attendee holds a placeholder address, never one of these, so the person may
 * register again as a new attendee.
 */
export async function findAttendeeAddresses(
  tx: Prisma.TransactionClient,
  eventId: string,
  emails: readonly string[],
): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const rows = await tx.$queryRaw<{ address: string }[]>`
    SELECT DISTINCT lower(btrim("email")) AS "address" FROM "Attendee"
    WHERE "event_id" = ${eventId} AND lower(btrim("email")) = ANY(${[...new Set(emails)]}::text[])
  `;
  return new Set(rows.map((row) => row.address));
}

/**
 * Creates the attendee of an accepted registration and returns its id, or null when an attendee with this exact
 * address is there already: `INSERT ... ON CONFLICT DO NOTHING`, because a unique violation inside the transaction
 * would abort it, and the one writer that holds no lock of ours (an edit of an attendee's address) can still
 * produce one. The one writer of attendees from registrations: placement and admission both come here.
 *
 * What the attendee gets (D-B9): the address, the name (first and last name), company and department, the answers
 * that still fit the event's fields (attendeeCustomDataFromAnswers), status `registered`, RSVP `none` with no
 * source (the guest was not added by staff and did not answer an invitation), and no ticket type: nobody receives
 * a category automatically. The ticket token is minted by the send of the ticket, not here.
 *
 * The caller holds the capacity lock and the registration queue, has counted the seat and has checked the
 * address (findAttendeeAddresses: the unique index tells apart only the same spelling). It writes the registration's
 * own side (status, link, decision) and the audit entry.
 */
export async function createAttendeeFromRegistration(
  tx: Prisma.TransactionClient,
  eventId: string,
  source: RegistrationAttendeeSource,
  fields: readonly EventItemContent[],
): Promise<string | null> {
  const customData = attendeeCustomDataFromAnswers(fields, source.custom_data);
  const [created] = await tx.attendee.createManyAndReturn({
    data: [
      {
        id: randomUUID(),
        event_id: eventId,
        email: source.email,
        name: [source.first_name, source.last_name].filter(Boolean).join(" "),
        first_name: source.first_name,
        last_name: source.last_name,
        company: source.company,
        department: source.department,
        ...(customData ? { custom_data: customData } : {}),
        rsvp_status: "none",
      },
    ],
    skipDuplicates: true,
    select: { id: true },
  });
  return created?.id ?? null;
}

/**
 * The audit entry of attendees created from registrations, one for a decision (a batch of an organiser, or the one
 * guest an automatic event accepted): an event-level entry of the activity log, ids and counts only, never a name or
 * an address. `audit` is empty for an automatic acceptance: there is no operator, and the request of a guest has no
 * staff session or IP worth recording. The central admin audit log gets none here (it needs a staff user): a decision
 * of staff writes its own entry, writeStaffRegistrationAudit in registration-decisions.ts.
 */
export async function writeAcceptanceLog(
  tx: Prisma.TransactionClient,
  eventId: string,
  accepted: readonly { registrationId: string; attendeeId: string }[],
  audit: OpsAuditContext,
  automatic: boolean,
): Promise<void> {
  await writeBulkActionLog(tx, {
    event_id: eventId,
    action_type: "registration_accepted",
    audit,
    metadata: {
      count: accepted.length,
      registration_ids: accepted.map((row) => row.registrationId),
      attendee_ids: accepted.map((row) => row.attendeeId),
      ...(automatic ? { automatic: true } : {}),
    },
  });
}
