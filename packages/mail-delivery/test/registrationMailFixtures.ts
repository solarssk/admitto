/**
 * Fixtures shared by the registration mail tests: rows the database's CHECK constraints accept, a collector for what
 * the export_only provider is handed, a provider that answers with a chosen result, and the helpers that hold a
 * transaction open and wait until another one waits for the registration queue.
 */
import { vi } from "vitest";
import { Prisma, type PrismaClient } from "@admitto/db";
import type { MailerAdapter, MailMessage, SendResult } from "@admitto/mailer";

export const BASE_URL = "https://tickets.example.com";
export const TEST_ENV = { NODE_ENV: "test", BASE_URL };

let sequence = 0;

/** An address that no other fixture of the run uses (a registration's address is unique per event). */
export const uniqueEmail = (label: string) => `${label}-${++sequence}@example.com`;

/** What the export_only provider is handed: the messages that "left". */
export function collectMail() {
  const messages: MailMessage[] = [];
  return {
    messages,
    deps: {
      exportSink: (payload: { message: MailMessage }) => {
        messages.push(payload.message);
      },
    },
  };
}

type RegistrationOptions = {
  email?: string;
  firstName?: string;
  lastName?: string;
  verified?: boolean;
  decidedBy?: string;
  attendeeId?: string;
  expiresAt?: Date;
};

/** A registration with what the CHECK constraints require for its status (an expiry, or an attendee). */
export function createRegistration(prisma: PrismaClient, eventId: string, status: string, options: RegistrationOptions = {}) {
  const first = options.firstName ?? "Gina";
  const last = options.lastName ?? "Guest";
  return prisma.registration.create({
    data: {
      event_id: eventId,
      email: options.email ?? uniqueEmail("guest"),
      first_name: first,
      last_name: last,
      name: `${first} ${last}`,
      status,
      confirm_expires_at: status === "awaiting_email" ? (options.expiresAt ?? new Date(Date.now() + 86_400_000)) : null,
      email_verified_at: options.verified ? new Date() : null,
      decided_by: options.decidedBy ?? null,
      attendee_id: options.attendeeId ?? null,
    },
  });
}

let queueTicks = 0;

/**
 * Queues one mail for a registration, as the transaction that changes its state does. The time it was queued
 * differs by a millisecond from one call to the next, so that the order of the queue is the order of the calls.
 */
export function queueMail(prisma: PrismaClient, registration: { id: string; event_id: string }, template: string) {
  return prisma.registrationMail.create({
    data: {
      registration_id: registration.id,
      event_id: registration.event_id,
      template_name: template,
      queued_at: new Date(Date.now() + ++queueTicks),
    },
  });
}

/** A registration in the state a template is for, with its mail queued. */
export async function queuedMailFor(prisma: PrismaClient, eventId: string, template: string, options: RegistrationOptions = {}) {
  const status = new Map([
    ["registration-confirm", "awaiting_email"],
    ["registration-received", "pending"],
    ["registration-waitlist", "waitlist"],
    ["registration-rejected", "rejected"],
  ]).get(template);
  if (!status) throw new Error(`no registration status for ${template}`);
  const registration = await createRegistration(prisma, eventId, status, options);
  const mail = await queueMail(prisma, registration, template);
  return { registration, mail };
}

/** A mailer that answers every send with `result`, or throws it when it is an error. */
export function mailerAnswering(result: SendResult | Error): MailerAdapter & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    provider: "smtp",
    capabilities: {} as MailerAdapter["capabilities"],
    sent,
    send: async (message: MailMessage) => {
      sent.push(message);
      if (result instanceof Error) throw result;
      return result;
    },
    close: async () => undefined,
  };
}

/** Waits until a transaction waits for the advisory lock with this key (a bigint expression), in this database. */
const waitUntilWaitingForAdvisoryLock = (prisma: PrismaClient, key: Prisma.Sql) =>
  vi.waitFor(
    async () => {
      const rows = await prisma.$queryRaw<{ waiting: bigint }[]>`
        SELECT count(*)::bigint AS "waiting"
        FROM pg_locks l, (SELECT (${key})::bigint AS "k") wanted
        WHERE l.locktype = 'advisory' AND NOT l.granted AND l.objsubid = 1
          AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND l.classid = ((wanted."k" >> 32) & 4294967295)::oid
          AND l.objid = (wanted."k" & 4294967295)::oid
      `;
      if (Number(rows[0]?.waiting ?? 0) === 0) throw new Error("nobody waits for the lock yet");
    },
    { timeout: 10_000, interval: 25 },
  );

/** Waits until a transaction waits for the registration queue of the event (the key of registration-lock.ts). */
export const waitUntilWaitingForRegistrationQueue = (prisma: PrismaClient, eventId: string) =>
  waitUntilWaitingForAdvisoryLock(prisma, Prisma.sql`hashtextextended(${`registration-queue:${eventId}`}, 0)`);

/** A transaction that runs `work`, reports what it returned, and stays open until `commit` is called. */
export function holdTransaction<T>(prisma: PrismaClient, work: (tx: Prisma.TransactionClient) => Promise<T>) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: (value: T) => void;
  const hasStarted = new Promise<T>((resolve) => {
    started = resolve;
  });
  const transaction = prisma.$transaction(
    async (tx) => {
      started(await work(tx));
      await released;
    },
    { timeout: 30_000 },
  );
  return {
    started: hasStarted,
    commit: async () => {
      release();
      await transaction;
    },
  };
}
