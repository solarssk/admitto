import { Prisma } from "@admitto/db/client";
import { lockAttendeesForUpdate } from "./attendee-lock.js";
import { lockRegistrationQueue } from "./registration-lock.js";

/** What removing the answers to one question changed: the rows that held one, by table. */
export type RemovedFieldAnswers = { attendees: number; companions: number; registrations: number };

/**
 * Deletes the answers to the question `sourceField` of an event, from every row that holds them (D-E6): the attendees'
 * `custom_data`, the companions' `custom_data`, the registrations' `custom_data` and the copy of the companions in
 * `Registration.companions`. Other keys, other events and erased attendees (whose answers are gone already) are left as
 * they are. For the deletion of a sensitive question: its answers go with it, so that no one finds them under an unknown
 * key later, and a question created again under the same key starts empty.
 *
 * A write of data that belongs to attendees and registrations, so it keeps the order of locks of
 * docs/dev/attendee-erasure.md ("Taking locks"): the caller holds the jobs of the event (lockOpenAttendeeJobs, so no import
 * writes the key behind this), then this takes the registration queue, the registration rows in id order, the attendee
 * rows in id order, and last the companions' rows, which belong to the attendees it holds. It returns counts only.
 */
export async function removeFieldAnswers(
  tx: Prisma.TransactionClient,
  { eventId, sourceField }: { eventId: string; sourceField: string },
): Promise<RemovedFieldAnswers> {
  await lockRegistrationQueue(tx, eventId);
  const registrations = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Registration"
    WHERE "event_id" = ${eventId} AND (
      (jsonb_typeof("custom_data") = 'object' AND jsonb_exists("custom_data", ${sourceField}))
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof("companions") = 'array' THEN "companions" ELSE '[]'::jsonb END) AS entry
        WHERE jsonb_typeof(entry) = 'object' AND jsonb_typeof(entry -> 'custom_data') = 'object' AND jsonb_exists(entry -> 'custom_data', ${sourceField})
      )
    )
    ORDER BY "id"
    FOR UPDATE
  `;
  const registrationIds = registrations.map((row) => row.id);
  const registrationsChanged =
    registrationIds.length === 0
      ? 0
      : await tx.$executeRaw`
          UPDATE "Registration" SET
            "custom_data" = CASE WHEN jsonb_typeof("custom_data") = 'object' THEN "custom_data" - ${sourceField}::text ELSE "custom_data" END,
            "companions" = CASE WHEN jsonb_typeof("companions") = 'array' THEN COALESCE((
              SELECT jsonb_agg(
                CASE WHEN jsonb_typeof(entry) = 'object' AND jsonb_typeof(entry -> 'custom_data') = 'object'
                  THEN jsonb_set(entry, '{custom_data}', (entry -> 'custom_data') - ${sourceField}::text)
                  ELSE entry END
                ORDER BY position)
              FROM jsonb_array_elements("companions") WITH ORDINALITY AS list(entry, position)
            ), '[]'::jsonb) ELSE "companions" END,
            "updated_at" = NOW()
          WHERE "id" = ANY(${registrationIds}::text[])
        `;

  const holders = await tx.$queryRaw<{ id: string }[]>`
    SELECT attendee."id" FROM "Attendee" AS attendee
    WHERE attendee."event_id" = ${eventId} AND attendee."erased_at" IS NULL AND (
      (jsonb_typeof(attendee."custom_data") = 'object' AND jsonb_exists(attendee."custom_data", ${sourceField}))
      OR EXISTS (
        SELECT 1 FROM "AttendeeCompanion" AS companion
        WHERE companion."attendee_id" = attendee."id" AND jsonb_typeof(companion."custom_data") = 'object' AND jsonb_exists(companion."custom_data", ${sourceField})
      )
    )
  `;
  const attendeeIds = await lockAttendeesForUpdate(tx, eventId, holders.map((row) => row.id));
  if (attendeeIds.length === 0) return { attendees: 0, companions: 0, registrations: registrationsChanged };
  const attendees = await tx.$executeRaw`
    UPDATE "Attendee" SET "custom_data" = "custom_data" - ${sourceField}::text, "updated_at" = NOW()
    WHERE "id" = ANY(${attendeeIds}::text[]) AND "erased_at" IS NULL
      AND jsonb_typeof("custom_data") = 'object' AND jsonb_exists("custom_data", ${sourceField})
  `;
  const companions = await tx.$executeRaw`
    UPDATE "AttendeeCompanion" SET "custom_data" = "custom_data" - ${sourceField}::text, "updated_at" = NOW()
    WHERE "attendee_id" = ANY(${attendeeIds}::text[])
      AND jsonb_typeof("custom_data") = 'object' AND jsonb_exists("custom_data", ${sourceField})
  `;
  return { attendees, companions, registrations: registrationsChanged };
}
