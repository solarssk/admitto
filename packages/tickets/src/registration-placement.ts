import type { Prisma, PrismaClient } from "@admitto/db";
import { REGISTRATION_MODE, type RegistrationAccessMethod, type RegistrationMode, type RegistrationStatus } from "@admitto/db/status";
import { eventEndsAtUtc } from "@admitto/shared";
import {
  EventLockBusyError,
  runEventCapacityTransaction,
  type EventCapacityTransactionPolicy,
} from "./event-capacity.js";
import { runPublicWrite, type PublicWriteOptions } from "./public-write-gate.js";
import { RegistrantInputError, registrantEmailSchema } from "./registrant-input.js";
import {
  createAttendeeFromRegistration,
  findAttendeeAddresses,
  loadAdmissionFields,
  writeAcceptanceLog,
  type RegistrationAttendeeSource,
} from "./registration-attendee.js";
import { lockRegistrationsForUpdate, tryLockRegistrationQueue } from "./registration-lock.js";
import { enqueueMailsForMoment, type RegistrationMailMoment } from "./registration-mail-queue.js";
import { countWaitlisted, decidePlacement, readFreeSeats, seatsNeeded, type PlacedStatus } from "./registration-seats.js";

/** How long the link that confirms an address is valid (D-C5): `confirm_expires_at` is `created_at` plus this. */
export const REGISTRATION_CONFIRM_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * A guest's form, after the input boundary (registrant-input.ts): names, company and department as the schemas
 * return them, `custom_data` from buildRegistrantCustomData. The address is normalised again here, because the
 * database refuses any other spelling and an error from it would tell a caller apart from the rest.
 */
export type RegistrantSubmission = {
  email: string;
  first_name: string;
  last_name: string;
  company?: string | null;
  department?: string | null;
  custom_data?: Record<string, string>;
  /** When the guest accepted the event terms (D-F3), for an event that asks for them. */
  accepted_at?: Date | null;
  /** The extra consents given: consent key to the time it was given, as an ISO string (D-F3). */
  consents?: Record<string, string>;
  locale?: string | null;
};

export type PlaceRegistrationInput = {
  eventId: string;
  /** How the guest got to the form (D-C1). Link and password mail an address a confirmation link first (unless the event switched that off); single sign-on does not: the provider vouches for the address. */
  method: RegistrationAccessMethod;
  registrant: RegistrantSubmission;
};

/**
 * What a submission came to, as far as the guest may be told, and the same whatever the address is (D-B14): a new
 * registration, an address that has a registration already (whatever its state, a rejected one included), and an
 * address that is an attendee already (whatever their status) all answer `received`, and the last two write nothing.
 * The one exception is single sign-on, where the provider vouches for the address and the guest is told what is
 * true: `already_registered` for an address that has a place already.
 * What does not depend on the address may differ:
 * - `closed`: registration is off for the event, or the event is archived or over (D-B10);
 * - `full`: no seat for the guest and no waiting list (D-B6): nothing is stored;
 * - `busy`: a lock was held for as long as a guest's request may wait: nothing is stored, answer `503 try_again`.
 */
export type PlaceRegistrationResult =
  | { outcome: "received" }
  | { outcome: "already_registered" }
  | { outcome: "closed" }
  | { outcome: "full" }
  | { outcome: "busy" };

/** Mail rows an event may queue within the window, whatever its size: the base of {@link eventMailCap}. */
export const EVENT_MAIL_CAP_PER_SEAT = 3;

/**
 * The most registration mail rows (every template) an event may queue within a window: the larger of the configured
 * base and three per seat of the event, so a big event is not cut short by a base meant for a small one. An event
 * without a limit has the base.
 */
export function eventMailCap(base: number, capacity: number | null): number {
  return Math.max(base, EVENT_MAIL_CAP_PER_SEAT * (capacity ?? 0));
}

/**
 * What the caller decided about the mail a submission would queue (MN-05). Neither limit stops the registration:
 * it is stored all the same, and the answer to the guest does not change. Only the mail is withheld.
 */
export type SubmissionMailLimits = {
  /**
   * The check of the address's mail budget, a limiter that lives outside the database. It is asked inside the
   * transaction, once, and only for a registration that is about to be stored and that the event's budget allows:
   * never for an address that has a place already, for a full event, for a request that finds a lock held, or for one
   * whose registration is not stored in the end. So a guest who is told to try again, or sends the same form twice,
   * does not use up the budget of their own address. False withholds the mail. It holds the locks of the event while
   * it runs: it must be quick, and it must not throw. Default: always true.
   */
  addressAllowed?: () => Promise<boolean>;
  /**
   * The event's budget of queued mail: no more rows than `eventMailCap(base, capacity)` in the last `windowMs`, for the
   * registrations created in the last `windowMs`, counted in the database under the registration queue, so that guests
   * submitting at once cannot get past it and a restart does not reset it. The mail that staff queue by deciding on an
   * older registration is not the guests' and does not use it up.
   */
  event?: { base: number; windowMs: number };
  /**
   * Told when the mail of a registration that is stored is withheld, and by which budget. For an operator's signal and
   * nothing else: it runs inside the transaction, so it must not wait for anything, and it must not throw.
   */
  onWithheld?: (reason: "address" | "event") => void;
};

export type PlacementOptions = PublicWriteOptions & {
  /** The moment of the request; tests set it. `placeRegistration` reads the clock itself once it holds the locks. */
  now?: Date;
  /** Limits on the mail this submission queues. Default: none. */
  mail?: SubmissionMailLimits;
};

/** A guest's request does not wait long for a transaction: the work of one is a few queries. */
const PUBLIC_TRANSACTION_POLICY: EventCapacityTransactionPolicy = {
  workTimeout: 10_000,
  lockAllowance: 1_000,
  grace: 1_000,
  waitTimeout: 2_000,
  maxWait: 2_000,
};

const noPrepare = (): Promise<void> => Promise.resolve();

const EVENT_SELECT = {
  archived_at: true,
  capacity: true,
  date: true,
  event_hours_start: true,
  event_hours_end: true,
  timezone: true,
  registration_settings: { select: { mode: true, waitlist_enabled: true, verify_email: true } },
} satisfies Prisma.EventSelect;

type OpenSettings = { mode: RegistrationMode; waitlist_enabled: boolean; verify_email: boolean };
type OpenEvent = { capacity: number | null; settings: OpenSettings };

function asMode(value: string | null | undefined): RegistrationMode | null {
  return REGISTRATION_MODE.find((mode) => mode === value) ?? null;
}

/**
 * The event and its settings when the form is open (D-B1, D-B10): registration is on, the event is not archived,
 * and it is not over. Null otherwise, whatever the reason, because a guest is told only that it is closed.
 */
async function readOpenEvent(tx: Prisma.TransactionClient, eventId: string, now: Date): Promise<OpenEvent | null> {
  const event = await tx.event.findUnique({ where: { id: eventId }, select: EVENT_SELECT });
  const mode = asMode(event?.registration_settings?.mode);
  if (!event?.registration_settings || mode === null || event.archived_at !== null) return null;
  const end = eventEndsAtUtc({
    date: event.date,
    eventHoursStart: event.event_hours_start,
    eventHoursEnd: event.event_hours_end,
    timezone: event.timezone,
  });
  if (now.getTime() >= end.getTime()) return null;
  const { waitlist_enabled, verify_email } = event.registration_settings;
  return { capacity: event.capacity, settings: { mode, waitlist_enabled, verify_email } };
}

/** The registration queue of the event, without waiting for it (the place of step 5 in the order of locks). */
async function lockQueueWithoutWaiting(tx: Prisma.TransactionClient, eventId: string): Promise<void> {
  if (!(await tryLockRegistrationQueue(tx, eventId))) throw new EventLockBusyError();
}

/** The moment of a registration that lands on `pending` or on the waiting list, for the mail it gets (D-D2). */
const momentOf = (status: "pending" | "waitlist", afterConfirmation: boolean): RegistrationMailMoment =>
  status === "pending" ? { to: "pending", afterConfirmation } : { to: "waitlist" };

/** The seats and the waiting list as they are now, under the capacity lock and the registration queue. */
async function readSeatState(tx: Prisma.TransactionClient, eventId: string, capacity: number | null) {
  return { free: await readFreeSeats(tx, eventId, capacity), waitlisted: await countWaitlisted(tx, eventId) };
}

type SubmissionContext = {
  tx: Prisma.TransactionClient;
  eventId: string;
  now: Date;
  registrant: RegistrantSubmission;
  verifiedByProvider: boolean;
  /** Whether the event has budget left for one more mail (see SubmissionMailLimits). */
  eventBudgetLeft: boolean;
  mail: SubmissionMailLimits | undefined;
};

/** Queues the mail of a moment for a new registration, unless a limit withholds it. The address's budget is asked
 * last, so that it is spent only by a mail that is queued. */
async function queueMailFor(context: SubmissionContext, registrationId: string, moment: RegistrationMailMoment): Promise<void> {
  const { mail } = context;
  if (!context.eventBudgetLeft) {
    mail?.onWithheld?.("event");
    return;
  }
  if (mail?.addressAllowed && !(await mail.addressAllowed())) {
    mail.onWithheld?.("address");
    return;
  }
  await enqueueMailsForMoment(context.tx, context.eventId, [registrationId], moment);
}

function registrationColumns({ eventId, now, registrant }: SubmissionContext) {
  return {
    event_id: eventId,
    email: registrant.email,
    first_name: registrant.first_name,
    last_name: registrant.last_name,
    name: [registrant.first_name, registrant.last_name].filter(Boolean).join(" "),
    company: registrant.company ?? null,
    department: registrant.department ?? null,
    ...(registrant.custom_data ? { custom_data: registrant.custom_data } : {}),
    accepted_at: registrant.accepted_at ?? null,
    consents: registrant.consents ?? {},
    locale: registrant.locale ?? null,
    created_at: now,
  };
}

/** A new registration that goes to its final state at once (its address needs no confirmation). */
async function insertPlaced(context: SubmissionContext, status: PlacedStatus): Promise<void> {
  const { tx, eventId, now } = context;
  const columns = {
    ...registrationColumns(context),
    status,
    email_verified_at: context.verifiedByProvider ? now : null,
  };
  if (status !== "accepted") {
    const row = await tx.registration.create({ data: columns, select: { id: true } });
    await queueMailFor(context, row.id, momentOf(status, false));
    return;
  }
  const attendeeId = await createAttendeeFromRegistration(
    tx,
    eventId,
    { ...columns, custom_data: columns.custom_data ?? null },
    await loadAdmissionFields(tx, eventId),
  );
  // An attendee with this exact address appeared since the check: the address is taken, and nothing has been written.
  if (attendeeId === null) return;
  const row = await tx.registration.create({
    data: { ...columns, attendee_id: attendeeId, decided_at: now },
    select: { id: true },
  });
  await queueMailFor(context, row.id, { to: "accepted" });
  await writeAcceptanceLog(tx, eventId, [{ registrationId: row.id, attendeeId }], {}, true);
}

/** A new registration that waits for its address to be confirmed: no seat, no ticket, a link valid for 24 hours. */
async function insertAwaitingEmail(context: SubmissionContext): Promise<void> {
  const { tx, now } = context;
  const row = await tx.registration.create({
    data: {
      ...registrationColumns(context),
      status: "awaiting_email",
      confirm_expires_at: new Date(now.getTime() + REGISTRATION_CONFIRM_WINDOW_MS),
    },
    select: { id: true },
  });
  await queueMailFor(context, row.id, { to: "awaiting_email" });
}

/**
 * Whether the address already has a place: an attendee of the event holds it (any status), or a registration does.
 * A registration that waits for its address and has expired is deleted on the way (with its queued mail), so that
 * the guest starts again with a new link instead of being turned away by a row that is about to be cleaned up.
 * Both are read for every address, so the work does not tell a known address from a new one.
 * An existing registration is never changed by a new submission: what the guest typed would otherwise replace
 * answers that someone else gave, and the owner of the address would then confirm them.
 *
 * The attendee read is a snapshot, not a guard: staff adding or importing an attendee, or editing an attendee's
 * address, in a transaction that commits after this read can leave an attendee and a registration with the same
 * address side by side (the two tables share no key, and a guest's submission must not wait for staff, so it does
 * not take the attendee rows). That is allowed. Admission settles it: `admitRegistrations` answers
 * `already_attendee` and deletes the registration (D-B13), and a mail that is still queued for it is cancelled.
 */
async function addressHasAPlace(context: SubmissionContext): Promise<boolean> {
  const { tx, eventId, now, registrant } = context;
  const heldByAttendee = (await findAttendeeAddresses(tx, eventId, [registrant.email])).size > 0;
  const existing = await tx.registration.findUnique({
    where: { event_id_email: { event_id: eventId, email: registrant.email } },
    select: { id: true, status: true, confirm_expires_at: true },
  });
  const expired =
    existing?.status === "awaiting_email" && existing.confirm_expires_at !== null && existing.confirm_expires_at <= now;
  if (existing && expired && !heldByAttendee) await tx.registration.delete({ where: { id: existing.id } });
  return heldByAttendee || (existing !== null && !expired);
}

const needsAddressConfirmation = (settings: OpenSettings, method: RegistrationAccessMethod): boolean =>
  method !== "sso" && settings.verify_email;

/**
 * Whether the event has not yet queued its share of mail within the window (SubmissionMailLimits). Only the rows queued
 * for registrations created within the window are counted: it is a brake on strangers who submit the form, and the mail
 * that a decision of staff on an older registration queues (a ticket, a rejection) would otherwise use up the budget of
 * the guests who come after. The rows are counted for every submission, a known address included, so that the reads do
 * not tell one address from another. Read under the registration queue, which every writer of these rows holds, so the
 * count is not out of date when the row is added.
 */
async function eventBudgetLeft(
  tx: Prisma.TransactionClient,
  eventId: string,
  capacity: number | null,
  now: Date,
  limit: SubmissionMailLimits["event"],
): Promise<boolean> {
  if (!limit) return true;
  const since = new Date(now.getTime() - limit.windowMs);
  const queued = await tx.registrationMail.count({
    where: { event_id: eventId, queued_at: { gt: since }, registration: { created_at: { gt: since } } },
  });
  return queued < eventMailCap(limit.base, capacity);
}

/** One submission, in the transaction that holds the capacity lock and the registration queue. */
async function submitInTransaction(
  tx: Prisma.TransactionClient,
  input: PlaceRegistrationInput,
  registrant: RegistrantSubmission,
  now: Date,
  mail: SubmissionMailLimits | undefined,
): Promise<Exclude<PlaceRegistrationResult, { outcome: "busy" }>> {
  const { eventId } = input;
  await lockQueueWithoutWaiting(tx, eventId);
  const event = await readOpenEvent(tx, eventId, now);
  if (!event) return { outcome: "closed" };
  // Before the address is looked at, so that a full event answers every address alike.
  const placement = decidePlacement(event.settings, await readSeatState(tx, eventId, event.capacity), seatsNeeded([]));
  if (placement === "full") return { outcome: "full" };
  const context: SubmissionContext = {
    tx,
    eventId,
    now,
    registrant,
    verifiedByProvider: input.method === "sso",
    eventBudgetLeft: await eventBudgetLeft(tx, eventId, event.capacity, now, mail?.event),
    mail,
  };
  if (await addressHasAPlace(context)) {
    return input.method === "sso" ? { outcome: "already_registered" } : { outcome: "received" };
  }
  if (needsAddressConfirmation(event.settings, input.method)) await insertAwaitingEmail(context);
  else await insertPlaced(context, placement);
  return { outcome: "received" };
}

/**
 * Normalises the address once more: the database refuses any other spelling, and an address in the namespace of
 * erased attendees (or one that is not an address) is refused here, as the boundary would, instead of as an error of
 * the database that tells a caller apart from the rest. Everything else is taken as the boundary left it.
 */
function checkedRegistrant(registrant: RegistrantSubmission): RegistrantSubmission {
  const email = registrantEmailSchema.safeParse(registrant.email);
  if (!email.success) throw new RegistrantInputError();
  return { ...registrant, email: email.data };
}

/**
 * A guest's submission becomes a registration in the state that fits the event (D-B2): `awaiting_email` while the
 * address has to be confirmed (link and password, D-C5), otherwise `accepted` with an attendee (an automatic event
 * with a seat), `pending` (an event with approval, with a seat), or `waitlist` (no seat), together with the one
 * queued mail D-D2 names for it (registrationMailFor), in the same transaction: both or neither.
 *
 * Locks (docs/dev/attendee-erasure.md): the capacity lock, then the registration queue, both without waiting
 * (runPublicWrite): a long import holds the first for as long as it runs, and a request that waited for it would
 * hold one of the few pooled connections the panel, the ticket page and check-in share. A held lock ends the
 * transaction with nothing written, a short pause with no connection, a new try; after about two seconds the answer
 * is `busy`, which the caller turns into `503 try_again`.
 *
 * The answer does not tell a new address from a known one (PlaceRegistrationResult). The mail of a new registration can
 * be withheld by limits the caller passes (`options.mail`, SubmissionMailLimits): the registration is stored all the
 * same. Not done here, for the callers: the checks of the terms and the consents, the request limits, the challenge,
 * and the re-send of the confirmation link to an address whose registration still waits for it.
 *
 * @throws RegistrantInputError when the address is refused by the input boundary.
 */
export async function placeRegistration(
  db: PrismaClient,
  input: PlaceRegistrationInput,
  options: PlacementOptions = {},
): Promise<PlaceRegistrationResult> {
  const registrant = checkedRegistrant(input.registrant);
  const written = await runPublicWrite(
    () =>
      runEventCapacityTransaction(
        db,
        input.eventId,
        noPrepare,
        // The clock is read here, inside the transaction and under the locks, on every try: the call may have waited for
        // a permit and for a lock, and an event that ended meanwhile is closed.
        (tx) => submitInTransaction(tx, input, registrant, options.now ?? new Date(), options.mail),
        PUBLIC_TRANSACTION_POLICY,
        { tryLock: true },
      ),
    options,
  );
  return written.busy ? { outcome: "busy" } : written.value;
}

export type ConfirmRegistrationInput = { eventId: string; registrationId: string };

/**
 * What the confirmation of an address came to. The link is the credential of the address, so unlike a submission
 * this may say where the guest stands.
 * - `placed`: the registration left `awaiting_email` now, for `status`;
 * - `already_placed`: it had left it before (a second click, or a decision of the organiser since), now in `status`;
 * - `expired`: the link is older than 24 hours; the row waits for the clean-up;
 * - `gone`: no such registration (cleaned up, deleted or erased);
 * - `already_registered`: the address became an attendee meanwhile (an import); the registration was deleted;
 * - `full`: no seat and no waiting list; the registration stays as it was and the link stays valid;
 * - `closed`: registration is off, or the event is archived or over;
 * - `busy`: as for a submission; nothing changed, the link stays valid.
 */
export type ConfirmRegistrationResult =
  | { outcome: "placed"; status: PlacedStatus }
  | { outcome: "already_placed"; status: Exclude<RegistrationStatus, "awaiting_email"> }
  | { outcome: "expired" }
  | { outcome: "gone" }
  | { outcome: "already_registered" }
  | { outcome: "full" }
  | { outcome: "closed" }
  | { outcome: "busy" };

/** The registration of a confirmed address leaves `awaiting_email` for the state `placement` says. */
async function placeConfirmed(
  tx: Prisma.TransactionClient,
  eventId: string,
  row: { id: string } & RegistrationAttendeeSource,
  placement: PlacedStatus,
  now: Date,
): Promise<Exclude<ConfirmRegistrationResult, { outcome: "busy" }>> {
  const confirmed = { confirm_expires_at: null, email_verified_at: now };
  if (placement !== "accepted") {
    await tx.registration.update({ where: { id: row.id }, data: { ...confirmed, status: placement } });
    await enqueueMailsForMoment(tx, eventId, [row.id], momentOf(placement, true));
    return { outcome: "placed", status: placement };
  }
  const attendeeId = await createAttendeeFromRegistration(tx, eventId, row, await loadAdmissionFields(tx, eventId));
  if (attendeeId === null) {
    await tx.registration.delete({ where: { id: row.id } });
    return { outcome: "already_registered" };
  }
  await tx.registration.update({
    where: { id: row.id },
    data: { ...confirmed, status: "accepted", attendee_id: attendeeId, decided_at: now },
  });
  await enqueueMailsForMoment(tx, eventId, [row.id], { to: "accepted" });
  await writeAcceptanceLog(tx, eventId, [{ registrationId: row.id, attendeeId }], {}, true);
  return { outcome: "placed", status: "accepted" };
}

async function confirmInTransaction(
  tx: Prisma.TransactionClient,
  { eventId, registrationId }: ConfirmRegistrationInput,
  now: Date,
): Promise<Exclude<ConfirmRegistrationResult, { outcome: "busy" }>> {
  await lockQueueWithoutWaiting(tx, eventId);
  const event = await readOpenEvent(tx, eventId, now);
  if (!event) return { outcome: "closed" };
  const [row] = await lockRegistrationsForUpdate(tx, eventId, [registrationId]);
  if (!row) return { outcome: "gone" };
  if (row.status !== "awaiting_email") {
    // The status column is closed by Registration_status_check.
    return { outcome: "already_placed", status: row.status as Exclude<RegistrationStatus, "awaiting_email"> };
  }
  if (row.confirm_expires_at === null || row.confirm_expires_at <= now) return { outcome: "expired" };
  if ((await findAttendeeAddresses(tx, eventId, [row.email])).size > 0) {
    await tx.registration.delete({ where: { id: row.id } });
    return { outcome: "already_registered" };
  }
  const seats = await readSeatState(tx, eventId, event.capacity);
  const placement = decidePlacement(event.settings, seats, seatsNeeded(row.companions));
  if (placement === "full") return { outcome: "full" };
  return placeConfirmed(tx, eventId, row, placement, now);
}

/**
 * The guest followed the link that confirms their address (the caller has checked the signature of the link):
 * the registration leaves `awaiting_email`, gets `email_verified_at`, and goes where the event sends a guest who
 * is not held back any longer (decidePlacement, the rule a submission follows too), with the mail of D-D2: the
 * ticket, the waiting list mail, or none for an event with approval, whose confirmation mail already took the place
 * of "received". Same locks, same busy answer and same transaction as a submission (see placeRegistration).
 * A second click finds the registration placed (`already_placed`) and changes nothing.
 */
export async function confirmRegistrationAddress(
  db: PrismaClient,
  input: ConfirmRegistrationInput,
  options: PlacementOptions = {},
): Promise<ConfirmRegistrationResult> {
  const now = options.now ?? new Date();
  const written = await runPublicWrite(
    () =>
      runEventCapacityTransaction(
        db,
        input.eventId,
        noPrepare,
        (tx) => confirmInTransaction(tx, input, now),
        PUBLIC_TRANSACTION_POLICY,
        { tryLock: true },
      ),
    options,
  );
  return written.busy ? { outcome: "busy" } : written.value;
}
