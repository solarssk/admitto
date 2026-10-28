import { Prisma } from "@admitto/db/client";
import { isAttendeeGone, lockAttendeeRow } from "./attendee-lock.js";
import { loadEventCustomDataFields } from "./event-custom-fields.js";
import {
  buildRegistrantCustomData,
  RegistrantInputError,
  registrantNameSchema,
  type RegistrantFormField,
} from "./registrant-input.js";

/**
 * How many companions one attendee may have: the slots 1 to this number (D-E5). A rule of the application and of
 * nothing else: the table (`AttendeeCompanion.slot`, any position from 1) and the registration (`companions`, a list)
 * do not hard-code it, so a later release raises it here. Every place that counts companions, reads them from a
 * registration or writes one goes through this number.
 */
export const MAX_COMPANION_SLOTS = 1;

/**
 * How many companions a guest may bring to an event whose settings say `maxCompanions`
 * (`EventRegistrationSettings.max_companions`, 0 when the event takes none): that number, never below zero and never more
 * than the application allows (MAX_COMPANION_SLOTS). THE reading of that column, for the page that offers the section,
 * the route that judges the body and the placement that judges it again under the locks, so the three agree.
 */
export function allowedCompanions(maxCompanions: number): number {
  return Math.min(Math.max(maxCompanions, 0), MAX_COMPANION_SLOTS);
}

/** A companion as a registration keeps it (`Registration.companions` is a list of these): the name, and the answers to the companion questions. */
export type RegistrationCompanion = {
  name: string;
  custom_data: Prisma.JsonObject | null;
};

function plainObject(value: unknown): Prisma.JsonObject | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value;
}

function ownValue(record: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(record, key)?.value;
}

/** One entry of `Registration.companions`: an object with a name that is text, else nothing. */
function readCompanion(entry: unknown): RegistrationCompanion | null {
  const record = plainObject(entry);
  if (!record) return null;
  const name = ownValue(record, "name");
  if (typeof name !== "string" || name.trim() === "") return null;
  return { name: name.trim(), custom_data: plainObject(ownValue(record, "custom_data")) };
}

/**
 * The companions a registration holds, as many as the application allows (MAX_COMPANION_SLOTS) and no entry that is
 * not shaped like a companion. THE reading of that column: the seats a registration needs (seatsNeeded) and the rows
 * an admission writes (createAttendeeFromRegistration) both come from it, so the seats a guest was given always are
 * the rows they get, whatever the column holds.
 */
export function readRegistrationCompanions(value: Prisma.JsonValue | undefined): RegistrationCompanion[] {
  if (!Array.isArray(value)) return [];
  const companions: RegistrationCompanion[] = [];
  for (const entry of value) {
    if (companions.length >= MAX_COMPANION_SLOTS) break;
    const companion = readCompanion(entry);
    if (companion) companions.push(companion);
  }
  return companions;
}

const isCompanionSlot = (slot: number): boolean => Number.isInteger(slot) && slot >= 1 && slot <= MAX_COMPANION_SLOTS;

/**
 * What a write to a companion came to:
 * - `written` / `removed`: done;
 * - `attendee_gone`: the attendee is erased, was removed, or is not in this event. Their data is read-only (or gone), so
 *   nothing is written, and a request that waited for an erasure finds it here;
 * - `invalid_slot`: not a whole number from 1 to MAX_COMPANION_SLOTS;
 * - `no_companion`: the attendee has no companion in that slot, so there is nothing to edit or remove.
 */
export type AttendeeCompanionWriteResult = { outcome: "written" | "attendee_gone" | "invalid_slot" | "no_companion" };
export type AttendeeCompanionRemoveResult = { outcome: "removed" | "attendee_gone" | "invalid_slot" | "no_companion" };

export type AttendeeCompanionTarget = {
  eventId: string;
  attendeeId: string;
  /** Which companion; 1 to MAX_COMPANION_SLOTS. Default 1. */
  slot?: number;
};

export type WriteAttendeeCompanionParams = AttendeeCompanionTarget & {
  /** The name as it came (a form of staff): checked by the schema of a registrant's name. */
  name: unknown;
  /** The answers as they came, key to text: checked by the boundary of a registrant, see writeAttendeeCompanion. */
  customData?: unknown;
};

/**
 * Every question about a companion, as the boundary of a registrant takes it: those off the registration form too,
 * because it is staff who answer, as they do for an attendee's own fields.
 */
async function loadCompanionQuestions(tx: Prisma.TransactionClient, eventId: string): Promise<RegistrantFormField[]> {
  const fields = await loadEventCustomDataFields(tx, eventId, "companion");
  return fields.map((field) => ({ ...field, show_on_form: true, applies_to: "companion" }));
}

/**
 * Corrects the name and the answers of an attendee's companion (staff, D-E5). The companion has to exist: this never
 * adds one, because a companion takes a seat, and a seat is taken under the capacity lock after a count, which only
 * an admission does (createAttendeeFromRegistration).
 *
 * THE write of an existing companion's data, and a write of data that belongs to an attendee, so the lock comes first
 * (docs/dev/attendee-erasure.md, "Rules for code"): `lockAttendeeRow` is the first statement. An erasure that is open is
 * waited for, and then the attendee reads as erased and nothing is written, so no name or answer goes back into a row
 * the erasure emptied; one that comes after waits for this write, and empties what it wrote. A caller that holds other
 * locks takes them before this, in the documented order (the capacity lock, the registration queue, then rows).
 *
 * The name goes through registrantNameSchema, the answers through buildRegistrantCustomData for `companion`: only keys
 * of fields with `applies_to = 'companion'` are read, whatever else the input holds (a guest question, `__proto__`, a
 * fixed column) is left out, a text that is hostile or too long is refused, and a required question must be answered.
 * The answers replace the old ones.
 *
 * Must run in the caller's transaction, which this does not commit. Throws RegistrantInputError for a name or an answer
 * the boundary refuses (the message is a fixed code, never the input), and the transaction should end then.
 */
export async function writeAttendeeCompanion(
  tx: Prisma.TransactionClient,
  params: WriteAttendeeCompanionParams,
): Promise<AttendeeCompanionWriteResult> {
  const { eventId, attendeeId, slot = 1 } = params;
  if (isAttendeeGone(await lockAttendeeRow(tx, attendeeId, eventId))) return { outcome: "attendee_gone" };
  if (!isCompanionSlot(slot)) return { outcome: "invalid_slot" };
  const name = registrantNameSchema.safeParse(params.name);
  if (!name.success) throw new RegistrantInputError();
  const answers = buildRegistrantCustomData(await loadCompanionQuestions(tx, eventId), params.customData, "companion");
  const updated = await tx.attendeeCompanion.updateMany({
    where: { attendee_id: attendeeId, slot },
    data: { name: name.data, custom_data: answers ?? Prisma.DbNull },
  });
  return { outcome: updated.count === 0 ? "no_companion" : "written" };
}

/**
 * Removes an attendee's companion (staff): the guest comes alone after all. Frees the seat; the other companions keep
 * their slots. Takes the attendee's row lock first, like writeAttendeeCompanion, and refuses the same attendees: a
 * companion of an erased attendee is kept as the erasure left it (its seat is the admitted guest's).
 */
export async function removeAttendeeCompanion(
  tx: Prisma.TransactionClient,
  { eventId, attendeeId, slot = 1 }: AttendeeCompanionTarget,
): Promise<AttendeeCompanionRemoveResult> {
  if (isAttendeeGone(await lockAttendeeRow(tx, attendeeId, eventId))) return { outcome: "attendee_gone" };
  if (!isCompanionSlot(slot)) return { outcome: "invalid_slot" };
  const removed = await tx.attendeeCompanion.deleteMany({ where: { attendee_id: attendeeId, slot } });
  return { outcome: removed.count === 0 ? "no_companion" : "removed" };
}
