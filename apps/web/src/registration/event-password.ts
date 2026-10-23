/**
 * The shared password of an event whose way in is the password (D-C3, PR 111): the check a guest's try goes through, and
 * what an organiser does to the password (set, change, switch off).
 *
 * The password is never stored as typed: the column holds an argon2id hash (`hashPassword`), and nothing in an answer,
 * an audit entry or a log line carries the password or the hash. It is one password for the whole event, not a login:
 * there is no session, no cookie and no route that only checks it. A guest sends it with the form, and
 * ./submit-route.ts checks it once the bot challenge has passed, before any work that depends on the address.
 *
 * Changing or switching off the password touches nothing else: the registrations that exist, and the confirmation links
 * that are still valid, stay as they are.
 */
import { hashPassword, verifyPasswordOrDummy } from "@admitto/auth";
import type { Prisma, PrismaClient } from "@admitto/db";
import { emitSystemLog } from "@admitto/shared/system-log";
import { REGISTRATION_PASSWORD_MAX, registrationPasswordLength } from "@admitto/shared";
import { writeAdminAuditLog, type StaffActor } from "@admitto/tickets";

/**
 * Whether a guest's try is the password whose hash is `passwordHash`. A try that is not a text (the page always sends
 * one, so this is a client of another kind), is missing, or is longer than a password can be, is a wrong one and costs
 * no hash: only a try that could be the password is verified. The hash in `verifyPasswordOrDummy` takes the same time
 * whoever asks; how long the guest waits for the answer is decided by the caller (the floor of ./submit-route.ts).
 */
export async function isEventPassword(candidate: unknown, passwordHash: string): Promise<boolean> {
  if (typeof candidate !== "string" || registrationPasswordLength(candidate) > REGISTRATION_PASSWORD_MAX) return false;
  return verifyPasswordOrDummy(candidate, passwordHash);
}

/** The two budgets of the tries at a password (see ./submit-route.ts): one client's, and one event's from everybody. */
export type PasswordBudget = "client" | "event";

/** A refused try is logged at most once an hour for an event and a budget, in this process: a stranger who has solved the
 * challenge can still send a request every few seconds, and a line for each would push everything else out of the buffer. */
const NOTE_INTERVAL_MS = 60 * 60 * 1000;
const MAX_NOTED = 500;
const notedAt = new Map<string, number>();

/**
 * One line in the system log: the tries at this event's password are being refused for want of a budget, which one, and
 * for which event. It is the signal that somebody is guessing the password, or that a company behind one address is
 * registering at once (raise `registration:password` with `RATE_LIMIT_OVERRIDES`). The id of the event and nothing else:
 * not the address of the client, which a rate limiter's own line would carry, not an address of a guest, not a password.
 */
export function notePasswordTriesRefused(eventId: string, budget: PasswordBudget): void {
  const now = Date.now();
  const key = `${budget}:${eventId}`;
  const last = notedAt.get(key);
  if (last !== undefined && now - last < NOTE_INTERVAL_MS) return;
  if (notedAt.size >= MAX_NOTED) notedAt.clear();
  notedAt.set(key, now);
  emitSystemLog("security", "warn", "registration_password_tries_refused", { event_id: eventId, budget });
}

/** What the organiser did to the password: it was set (or changed), or switched off. The one thing the audit entry says. */
export type PasswordChange = "set" | "cleared";

type EventForAudit = { organization_id: string; title: string };

function findEventForAudit(tx: Prisma.TransactionClient, eventId: string): Promise<EventForAudit | null> {
  return tx.event.findUnique({ where: { id: eventId }, select: { organization_id: true, title: true } });
}

/**
 * The entry of the central audit log for a password that was set or switched off, written in the transaction of the
 * change. The metadata is the event (its id and title, like every entry that is about one event) and which change it
 * was. It holds nothing of the password: not the text, not the hash, not its length.
 */
async function writePasswordAudit(
  tx: Prisma.TransactionClient,
  event: EventForAudit,
  { eventId, actor, change }: { eventId: string; actor: StaffActor; change: PasswordChange },
): Promise<void> {
  await writeAdminAuditLog(tx, {
    organizationId: event.organization_id,
    actorUserId: actor.operator,
    sessionId: actor.sessionId,
    ip: actor.ip,
    timezone: actor.timezone,
    actionType: "registration_password_changed",
    metadata: { event_id: eventId, event_title: event.title, change },
  });
}

/**
 * Sets the password of an event, or changes it. The event need not have registration settings yet: the row is made, with
 * the registration off, so the password waits for the way in to be chosen. `not_found` when the event is not there (a
 * superadmin can reach an event that has been deleted).
 *
 * The hash is computed before the transaction, which would otherwise hold a connection for the work of the hash.
 */
export async function setEventPassword(
  db: PrismaClient,
  { eventId, password, actor }: { eventId: string; password: string; actor: StaffActor },
): Promise<"ok" | "not_found"> {
  const passwordHash = await hashPassword(password);
  return db.$transaction(async (tx) => {
    const event = await findEventForAudit(tx, eventId);
    if (!event) return "not_found";
    await tx.eventRegistrationSettings.upsert({
      where: { event_id: eventId },
      create: { event_id: eventId, password_hash: passwordHash },
      update: { password_hash: passwordHash },
    });
    await writePasswordAudit(tx, event, { eventId, actor, change: "set" });
    return "ok";
  });
}

/**
 * Switches the password of an event off: guests are turned away at the 404 until a new one is set. An event that has none
 * is left as it is and nothing is recorded, since nothing changed.
 */
export async function clearEventPassword(
  db: PrismaClient,
  { eventId, actor }: { eventId: string; actor: StaffActor },
): Promise<"ok" | "not_found"> {
  return db.$transaction(async (tx) => {
    const event = await findEventForAudit(tx, eventId);
    if (!event) return "not_found";
    const cleared = await tx.eventRegistrationSettings.updateMany({
      where: { event_id: eventId, password_hash: { not: null } },
      data: { password_hash: null },
    });
    if (cleared.count > 0) await writePasswordAudit(tx, event, { eventId, actor, change: "cleared" });
    return "ok";
  });
}
