/**
 * Shared set-up of the registration tests that need a database: a private schema that every migration has been
 * applied to (so the CHECK constraints, the unique indexes and the wake trigger are the real ones), fixtures
 * for events, attendees and registrations, and what the tests that make transactions wait for each other need.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { Prisma } from "@admitto/db/client";
import { assertTestDatabaseUrl } from "@admitto/db/test-db-guard";
import { createTestPrismaClient } from "@admitto/db/testing";

const DB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../db");

export type MigratedDb = {
  db: PrismaClient;
  /** Another client of the same schema, with its own pool: another process, as far as connections go. */
  connection: () => PrismaClient;
  drop: () => Promise<void>;
};

export function createMigratedDb(): MigratedDb {
  const url = process.env.DATABASE_URL ?? "";
  assertTestDatabaseUrl(url);
  const schema = `tickets_registration_${randomUUID().replaceAll("-", "")}`;
  const migrated = new URL(url);
  migrated.searchParams.set("schema", schema);
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: DB_ROOT,
    env: { ...process.env, DATABASE_URL: migrated.toString() },
    stdio: "pipe",
  });
  const clients: PrismaClient[] = [];
  const connection = () => {
    const client = createTestPrismaClient(url, schema);
    clients.push(client);
    return client;
  };
  const db = connection();
  return {
    db,
    connection,
    drop: async () => {
      await Promise.all(clients.map((client) => client.$disconnect()));
      const admin = createTestPrismaClient(url);
      try {
        // A generated identifier, never request content.
        await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await admin.$disconnect();
      }
    },
  };
}

export type EventOptions = {
  capacity?: number | null;
  /** null: a settings row with no mode (off). Omit the settings row altogether with `settings: false`. */
  mode?: "automatic" | "approval" | null;
  settings?: boolean;
  waitlist?: boolean;
  verify?: boolean;
  archived?: boolean;
  /** Event day; the default is a month from now. */
  date?: Date;
};

const inAMonth = () => new Date(Date.now() + 30 * 86_400_000);

export function fixtures(db: PrismaClient) {
  let seq = 0;
  const organization = db.organization.create({
    data: { name: "Registration core", slug: `registration-core-${randomUUID()}` },
  });

  const event = async (options: EventOptions = {}) => {
    const org = await organization;
    const created = await db.event.create({
      data: {
        organization_id: org.id,
        title: `Event ${++seq}`,
        slug: `event-${randomUUID()}`,
        date: options.date ?? inAMonth(),
        capacity: options.capacity === undefined ? 10 : options.capacity,
        archived_at: options.archived ? new Date() : null,
      },
    });
    if (options.settings !== false) {
      await db.eventRegistrationSettings.create({
        data: {
          event_id: created.id,
          mode: options.mode === undefined ? "automatic" : options.mode,
          waitlist_enabled: options.waitlist ?? true,
          verify_email: options.verify ?? true,
        },
      });
    }
    return created.id;
  };

  /** A synthetic address, unique for this call. */
  const address = (label = "guest") => `${label}-${++seq}@example.com`;

  const registrant = (overrides: Record<string, unknown> = {}) => ({
    email: address(),
    first_name: "Guest",
    last_name: `Number${++seq}`,
    ...overrides,
  });

  const attendee = (eventId: string, options: { email?: string; status?: string; name?: string } = {}) =>
    db.attendee.create({
      data: {
        id: randomUUID(),
        event_id: eventId,
        email: options.email ?? address("attendee"),
        name: options.name ?? `Attendee ${++seq}`,
        status: options.status ?? "registered",
      },
    });

  const attendees = async (eventId: string, count: number, status = "registered") => {
    for (let i = 0; i < count; i += 1) await attendee(eventId, { status });
  };

  /** A registration with the columns its status requires, as the CHECK constraints ask. */
  const registration = (
    eventId: string,
    options: {
      status: string;
      email?: string;
      attendeeId?: string;
      expiresAt?: Date;
      companions?: unknown[];
      customData?: Record<string, string>;
      company?: string;
      createdAt?: Date;
    },
  ) =>
    db.registration.create({
      data: {
        event_id: eventId,
        email: options.email ?? address(),
        first_name: "Guest",
        last_name: `Number${++seq}`,
        name: `Guest Number${seq}`,
        status: options.status,
        attendee_id: options.attendeeId ?? null,
        confirm_expires_at:
          options.status === "awaiting_email" ? (options.expiresAt ?? new Date(Date.now() + 86_400_000)) : null,
        companions: (options.companions ?? []) as Prisma.InputJsonValue,
        custom_data: options.customData,
        company: options.company ?? null,
        ...(options.createdAt ? { created_at: options.createdAt } : {}),
      },
    });

  const templatesOf = async (registrationId: string) =>
    (await db.registrationMail.findMany({ where: { registration_id: registrationId }, orderBy: { template_name: "asc" } })).map(
      (mail) => mail.template_name,
    );

  const registrationByEmail = (eventId: string, email: string) =>
    db.registration.findUnique({ where: { event_id_email: { event_id: eventId, email } } });

  const counts = async (eventId: string) => ({
    attendees: await db.attendee.count({ where: { event_id: eventId } }),
    registrations: await db.registration.count({ where: { event_id: eventId } }),
    mails: await db.registrationMail.count({ where: { event_id: eventId } }),
    logs: await db.attendeeActionLog.count({ where: { event_id: eventId } }),
  });

  return { event, address, registrant, attendee, attendees, registration, templatesOf, registrationByEmail, counts };
}

/**
 * A transaction that runs `work`, reports what it returned, and stays open until `commit` is called; `then` runs in
 * the same transaction after that, before it commits.
 */
export function holdTransaction<T>(
  db: PrismaClient,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  then?: (tx: Prisma.TransactionClient) => Promise<unknown>,
) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: (value: T) => void;
  const hasStarted = new Promise<T>((resolve) => {
    started = resolve;
  });
  const transaction = db.$transaction(
    async (tx) => {
      started(await work(tx));
      await released;
      await then?.(tx);
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

/** Waits until a transaction waits for the advisory lock with this key (a bigint expression), in this database. */
export const waitUntilWaitingForAdvisoryLock = (db: PrismaClient, key: Prisma.Sql) =>
  vi.waitFor(
    async () => {
      const rows = await db.$queryRaw<{ waiting: bigint }[]>`
        SELECT count(*)::bigint AS "waiting"
        FROM pg_locks l, (SELECT (${key})::bigint AS "k") wanted
        WHERE l.locktype = 'advisory' AND NOT l.granted
          AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND l.classid = ((wanted."k" >> 32) & 4294967295)::oid
          AND l.objid = (wanted."k" & 4294967295)::oid
      `;
      expect(Number(rows[0]?.waiting ?? 0)).toBeGreaterThan(0);
    },
    { timeout: 5000, interval: 25 },
  );

/** The registration queue of the event, by its key (registration-lock.ts: a bigint from hashtextextended). */
export const waitUntilWaitingForRegistrationQueue = (db: PrismaClient, eventId: string) =>
  waitUntilWaitingForAdvisoryLock(db, Prisma.sql`hashtextextended(${`registration-queue:${eventId}`}, 0)`);

/** The capacity lock of the event (event-capacity.ts: an int from hashtext, which Postgres widens to a bigint key). */
export const waitUntilWaitingForCapacityLock = (db: PrismaClient, eventId: string) =>
  waitUntilWaitingForAdvisoryLock(db, Prisma.sql`hashtext(${`event-capacity:${eventId}`})`);

/** How many transactions of this database wait for a lock of any kind right now. */
export const lockWaiters = async (db: PrismaClient): Promise<number> => {
  const rows = await db.$queryRaw<{ waiting: bigint }[]>`
    SELECT count(*)::bigint AS "waiting" FROM pg_stat_activity
    WHERE datname = current_database() AND wait_event_type = 'Lock'
  `;
  return Number(rows[0]?.waiting ?? 0);
};

/**
 * A client that stays inside the transaction for as long as `release` is not called, right after the first count of
 * the seats of the event (what a writer that takes a seat does under the capacity lock): its locks are held, its
 * work is half done, and `reached` says it got there.
 */
export function pauseAfterSeatCount(source: PrismaClient, eventId: string) {
  let reached!: () => void;
  const hasReached = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let paused = false;
  const transaction = source.$transaction.bind(source);
  const client = new Proxy(source, {
    get(target, key, receiver) {
      if (key !== "$transaction") return Reflect.get(target, key, receiver);
      return <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>, options?: { timeout?: number; maxWait?: number }) =>
        transaction(async (tx) => {
          const attendee = new Proxy(tx.attendee, {
            get(delegate, method, delegateReceiver) {
              if (method !== "count") return Reflect.get(delegate, method, delegateReceiver);
              return async (args: Prisma.AttendeeCountArgs) => {
                const value = await delegate.count(args);
                if (!paused && args.where?.event_id === eventId) {
                  paused = true;
                  reached();
                  await released;
                }
                return value;
              };
            },
          });
          return operation(
            new Proxy(tx, {
              get(actual, property, actualReceiver) {
                return property === "attendee" ? attendee : Reflect.get(actual, property, actualReceiver);
              },
            }),
          );
        }, options);
    },
  });
  return { client, reached: hasReached, release };
}

/** A client whose transactions roll back after their work is done: the work has run, nothing may remain of it. */
export function failingAfterWork(source: PrismaClient, message = "Synthetic rollback after the work") {
  const transaction = source.$transaction.bind(source);
  return new Proxy(source, {
    get(target, key, receiver) {
      if (key !== "$transaction") return Reflect.get(target, key, receiver);
      return <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>, options?: { timeout?: number; maxWait?: number }) =>
        transaction(async (tx) => {
          await operation(tx);
          throw new Error(message);
        }, options);
    },
  });
}
