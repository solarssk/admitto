import type { Prisma, PrismaClient } from "@admitto/db";
import { isAttendeeGone, lockAttendeeRow } from "./attendee-lock.js";
import { readRegistrationCompanions } from "./attendee-companion.js";
import { writeActionLog, writeBulkActionLog } from "./ops-audit.js";
import { writeStaffRegistrationAudit, type StaffActor } from "./registration-decisions.js";
import { lockRegistrationQueue } from "./registration-lock.js";
import { loadSensitiveCustomFields, sensitiveSourceFields } from "./sensitive-custom-data.js";

/**
 * The administrator's deliberate "Show" of the answers to sensitive questions (D-E6): the one place that hands them back on
 * purpose. Everything else leaves them out (`sensitive-custom-data.ts`). It answers for one person, a guest's registration
 * or an attendee, and their companion, and returns only the answers to questions that are sensitive now and have a value.
 * An answer to an ordinary question is never returned here: the pages show it already.
 *
 * Each call writes its entries in the transaction that reads the answers, so an answer never leaves without its trace and
 * a failed entry takes the read back with it: the event's activity log (the attendee's own row, or an event-level row for a
 * registration) and the central audit log. They hold who, when, which person and which questions (keys) and how many
 * values, never a value. The entries are written also when the person has no sensitive answer: the click happened.
 *
 * Locks, in the order of docs/dev/attendee-erasure.md: an attendee is `lockAttendeeRow` first, so a request that waits for
 * an erasure finds the person erased and returns nothing. A registration is the registration queue (step 5), which an
 * erasure and a deletion hold, and then a plain read; the registration is gone when they have committed.
 */

/** The audit type of one click on "Show". Also in `ATTENDEE_ACTION_TYPE` and in the labels of the admin app. */
export const SENSITIVE_REVEAL_ACTION = "sensitive_data_revealed";

/** A staff request may wait for the locks of an erasure that is open, as long as the statement timeout lets it. */
const REVEAL_TRANSACTION_OPTIONS = { timeout: 60_000, maxWait: 10_000 } as const;

export type RevealSubject = { kind: "registration" | "attendee"; id: string };

/**
 * What a reveal returns: the answers of the guest by the key of the question, and those of each companion that has any
 * (`slot` is the companion's position, 1 in 0.8). Only keys of sensitive questions, only values that are not empty.
 */
export type RevealedAnswers = {
  guest: Record<string, unknown>;
  companions: { slot: number; answers: Record<string, unknown> }[];
};

/** `not_found`: no such registration in the event (never there, or deleted, which is what an erasure does to it).
 * `attendee_gone`: the attendee is erased, was removed, or is not in the event; nothing is read. */
export type RevealResult = { outcome: "revealed"; answers: RevealedAnswers } | { outcome: "not_found" | "attendee_gone" };

export type RevealParams = { eventId: string; subject: RevealSubject; actor: StaffActor };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return typeof value !== "string" || value.trim() !== "";
}

/** The answers in `data` to the questions in `keys` that have a value. */
function sensitiveAnswers(data: unknown, keys: ReadonlySet<string>): Record<string, unknown> {
  if (!isPlainObject(data)) return {};
  return Object.fromEntries(Object.entries(data).filter(([key, value]) => keys.has(key) && hasValue(value)));
}

function revealedFrom(
  guestData: unknown,
  companions: { slot: number; data: unknown }[],
  sensitive: ReadonlySet<string>,
): RevealedAnswers {
  const withAnswers = companions
    .map(({ slot, data }) => ({ slot, answers: sensitiveAnswers(data, sensitive) }))
    .filter(({ answers }) => Object.keys(answers).length > 0);
  return { guest: sensitiveAnswers(guestData, sensitive), companions: withAnswers };
}

const sortedKeys = (answers: Record<string, unknown>): string[] => Object.keys(answers).sort();

/** The metadata of both entries: the person, how many values were shown, and the keys of their questions. No value. */
function entryMetadata(subject: RevealSubject, answers: RevealedAnswers): Record<string, unknown> {
  const companionKeys = [...new Set(answers.companions.flatMap(({ answers: companion }) => Object.keys(companion)))].sort();
  const count =
    Object.keys(answers.guest).length + answers.companions.reduce((sum, { answers: companion }) => sum + Object.keys(companion).length, 0);
  return {
    subject: subject.kind,
    [subject.kind === "attendee" ? "attendee_id" : "registration_id"]: subject.id,
    field_count: count,
    fields: sortedKeys(answers.guest),
    companion_fields: companionKeys,
  };
}

/** The attendee's answers and their companion's, read under the attendee's row lock. */
async function readAttendeeAnswers(
  tx: Prisma.TransactionClient,
  { eventId, subject }: RevealParams,
  sensitive: ReadonlySet<string>,
): Promise<RevealedAnswers> {
  const row = await tx.attendee.findFirst({
    where: { id: subject.id, event_id: eventId },
    select: { custom_data: true, companions: { orderBy: { slot: "asc" }, select: { slot: true, custom_data: true } } },
  });
  return revealedFrom(row?.custom_data, (row?.companions ?? []).map(({ slot, custom_data }) => ({ slot, data: custom_data })), sensitive);
}

/** The answers of a registration and of the companion it holds a copy of, or null when it is not in the event. */
async function readRegistrationAnswers(
  tx: Prisma.TransactionClient,
  { eventId, subject }: RevealParams,
  sensitive: ReadonlySet<string>,
): Promise<RevealedAnswers | null> {
  const row = await tx.registration.findFirst({
    where: { id: subject.id, event_id: eventId },
    select: { custom_data: true, companions: true },
  });
  if (!row) return null;
  const companions = readRegistrationCompanions(row.companions).map((companion, index) => ({ slot: index + 1, data: companion.custom_data }));
  return revealedFrom(row.custom_data, companions, sensitive);
}

/**
 * Returns the answers of one person to the questions that are sensitive now, and records the click. See the comment at the
 * top of the file. The attendee has to be in the event for the caller to ask (the route checks who may manage it).
 */
export async function revealSensitiveAnswers(db: PrismaClient, params: RevealParams): Promise<RevealResult> {
  const { eventId, subject, actor } = params;
  return db.$transaction(async (tx): Promise<RevealResult> => {
    if (subject.kind === "attendee") {
      if (isAttendeeGone(await lockAttendeeRow(tx, subject.id, eventId))) return { outcome: "attendee_gone" };
    } else {
      await lockRegistrationQueue(tx, eventId);
    }

    const sensitive = sensitiveSourceFields(await loadSensitiveCustomFields(tx, eventId));
    const answers =
      subject.kind === "attendee" ? await readAttendeeAnswers(tx, params, sensitive) : await readRegistrationAnswers(tx, params, sensitive);
    if (answers === null) return { outcome: "not_found" };

    const metadata = entryMetadata(subject, answers);
    if (subject.kind === "attendee") {
      await writeActionLog(tx, { event_id: eventId, attendee_id: subject.id, action_type: SENSITIVE_REVEAL_ACTION, audit: actor, metadata });
    } else {
      await writeBulkActionLog(tx, { event_id: eventId, action_type: SENSITIVE_REVEAL_ACTION, audit: actor, metadata });
    }
    await writeStaffRegistrationAudit(tx, { eventId, actor, actionType: SENSITIVE_REVEAL_ACTION, metadata });
    return { outcome: "revealed", answers };
  }, REVEAL_TRANSACTION_OPTIONS);
}
