import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { acquireEventCapacityLock, lockRegistrationQueue } from "@admitto/tickets";
import { acquireEventCustomFieldsLock } from "../../src/admin/event-custom-fields-routes.js";
import { updateEventRegistrationSettings } from "../../src/admin/event-registration-settings.js";
import { setEnabledAccessMethods } from "../../src/registration/access-methods.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { createStaffSession, removeStaff, setOrgMail } from "../helpers/registration-settings-fixtures.js";
import { ORIGIN, eventSeeder, harness, type EventSeed } from "../helpers/registration-submit-harness.js";

/**
 * Saves of the registration settings that happen at the same time as something else (family C of the plan): a second save, a
 * text withdrawn, a question saved, an import, an erasure and a guest sending the form. What is claimed is what a save
 * promises: it takes the locks of the event's questions and texts, so a writer of those waits for it and then finds what it
 * left; it takes neither the capacity lock nor the registration queue, so it neither waits for an import or an erasure nor
 * holds them up; and turning registration off reaches a guest who is already on the way.
 *
 * A test stops a save at the moment it has read and not yet written, with its locks held (`pausingClient`), starts the other
 * writer, shows that it is waiting, and lets the save go on. Each test fails when the lock it is about is taken out.
 */
const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const ORG = "org-reg99a-concurrency";
const ADMIN_EMAIL = "reg99a-concurrency-admin@example.com";

let prisma: PrismaClient;
let holder: PrismaClient;
let app: ReturnType<typeof buildTestApp>;
let seeder: ReturnType<typeof eventSeeder>;
let adminId = "";
let adminCookie = "";
let counter = 0;

const settingsPath = (eventId: string) => `/api/admin/events/${eventId}/registration/settings`;
const actor = () => ({ operator: adminId, ip: "203.0.113.7" });
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** An event that is off but ready: the link chosen, both required texts published. */
async function addEvent(label: string, seed: EventSeed = {}): Promise<{ id: string; slug: string }> {
  const slug = `reg99a-con-${label}-${(counter += 1)}`;
  const settings = seed.settings === null ? null : { mode: null, access_methods: ["link"], consent_keys: [], ...seed.settings };
  return { id: await seeder.addEvent(slug, { ...seed, settings }), slug };
}

const settingsRow = (eventId: string) => prisma.eventRegistrationSettings.findUnique({ where: { event_id: eventId } });
const auditCount = (eventId: string) =>
  prisma.adminAuditLog.count({ where: { action_type: "registration_settings_changed", metadata: { path: ["event_id"], equals: eventId } } });

const send = async (eventId: string, method: string, path: string, body?: unknown) =>
  app.request(path.replace(":eventId", eventId), {
    method,
    headers: { "Content-Type": "application/json", Origin: "http://localhost", Cookie: adminCookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const put = (eventId: string, body: unknown) => send(eventId, "PUT", settingsPath(":eventId"), body);

/** Whether `request` is still waiting after `ms`: the proof that it is held up, and not merely slow to be asked. */
async function stillWaiting(request: Promise<unknown>, ms = 300): Promise<boolean> {
  const winner = await Promise.race([request.then(() => "answered"), sleep(ms).then(() => "waiting")]);
  return winner === "waiting";
}

type Paused = { client: PrismaClient; reached: Promise<void>; release: () => void };

/**
 * The client, but its transactions stop once, right after the first `method` of `model` has answered, until `release` is
 * called: a save that has read and not yet written, with its locks held. Everything else passes through unchanged.
 */
function pausingClient(db: PrismaClient, model: string, method: string): Paused {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reach!: () => void;
  const reached = new Promise<void>((resolve) => {
    reach = resolve;
  });
  let paused = false;
  const pauseOnce = async (): Promise<void> => {
    if (paused) return;
    paused = true;
    reach();
    await gate;
  };

  const wrapModel = (delegate: object): object =>
    new Proxy(delegate, {
      get(target, key, receiver) {
        const value: unknown = Reflect.get(target, key, receiver);
        if (key !== method || typeof value !== "function") return value;
        return async (...args: unknown[]): Promise<unknown> => {
          const result: unknown = await Reflect.apply(value, target, args);
          await pauseOnce();
          return result;
        };
      },
    });
  const wrapTransaction = (tx: Prisma.TransactionClient): Prisma.TransactionClient =>
    new Proxy(tx, {
      get(target, key, receiver) {
        const value: unknown = Reflect.get(target, key, receiver);
        return key === model && typeof value === "object" && value !== null ? wrapModel(value) : value;
      },
    });
  const client = new Proxy(db, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (key !== "$transaction" || typeof value !== "function") return value;
      return (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: unknown) => {
        const wrapped = (tx: Prisma.TransactionClient) => run(wrapTransaction(tx));
        return Reflect.apply(value, target, options === undefined ? [wrapped] : [wrapped, options]);
      };
    },
  });
  return { client, reached, release: () => release() };
}

/** What an import or an erasure does to an event: a transaction of `holder` takes a lock and keeps it until `release`. */
function holdLock(eventId: string, acquire: (tx: Prisma.TransactionClient, eventId: string) => Promise<void>) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let start!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const transaction = holder.$transaction(
    async (tx) => {
      await acquire(tx, eventId);
      start();
      await released;
    },
    { timeout: 60_000 },
  );
  return {
    started,
    release: async () => {
      release();
      await transaction;
    },
  };
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  holder = createTestPrismaClient();
  seeder = eventSeeder(prisma, ORG);
  await removeStaff(prisma, [ADMIN_EMAIL]);
  await seeder.prepare();
  const admin = await createStaffSession(prisma, ADMIN_EMAIL, { role: "admin", organizationId: ORG });
  adminId = admin.userId;
  adminCookie = admin.cookie;
  app = buildTestApp({ prisma, checkinToken: "reg99a-concurrency-checkin-token-32", adminDistRoot });
});

beforeEach(async () => {
  await seeder.setSystemKeys(true);
  await setOrgMail(prisma, ORG, true);
});

afterAll(async () => {
  if (!prisma) return;
  await seeder.wipe();
  await prisma.adminAuditLog.deleteMany({ where: { organization_id: ORG } });
  await setOrgMail(prisma, ORG, false);
  await removeStaff(prisma, [ADMIN_EMAIL]);
  await Promise.all([prisma.$disconnect(), holder?.$disconnect()]);
});

describe("two saves at once", () => {
  it("run one after the other: the one that waits judges what the first left, and is refused for it", async () => {
    const event = await addEvent("two-saves");
    await setEnabledAccessMethods(prisma, ["link", "password"]);
    const first = pausingClient(prisma, "eventRegistrationSettings", "findUnique");
    const enabling = updateEventRegistrationSettings(first.client, { eventId: event.id, patch: { mode: "automatic" }, actor: actor() });
    await first.reached;

    const switching = put(event.id, { access_methods: ["password"] });
    const held = await stillWaiting(switching);
    first.release();

    expect(held).toBe(true);
    expect((await enabling).kind).toBe("saved");
    const answer = await switching;
    // Judged on its own, the second save saw an event that was off, and would have been let through.
    expect(answer.status).toBe(409);
    expect(await answer.json()).toEqual({ error: "registration_not_ready", blockers: ["password"] });
    expect(await settingsRow(event.id)).toMatchObject({ mode: "automatic", access_methods: ["link"] });
    expect(await auditCount(event.id)).toBe(1);
  });

  it("turn registration on once when both ask for it: one change, one entry in the audit log", async () => {
    const event = await addEvent("both-enable");
    const first = pausingClient(prisma, "eventRegistrationSettings", "findUnique");
    const one = updateEventRegistrationSettings(first.client, { eventId: event.id, patch: { mode: "automatic" }, actor: actor() });
    await first.reached;

    const other = put(event.id, { mode: "automatic" });
    const held = await stillWaiting(other);
    first.release();

    expect(held).toBe(true);
    expect((await one).kind).toBe("saved");
    expect((await other).status).toBe(200);
    expect(await auditCount(event.id)).toBe(1);
    expect((await settingsRow(event.id))?.mode).toBe("automatic");
  });
});

describe("a save and a writer of the event's texts or questions", () => {
  it("makes a text that registration needs wait to be withdrawn until the save has put it in use, and then refuses it", async () => {
    const event = await addEvent("consent-race", { settings: { mode: "automatic" }, legal: { consents: ["photos"] } });
    const first = pausingClient(prisma, "eventRegistrationSettings", "findUnique");
    const adding = updateEventRegistrationSettings(first.client, { eventId: event.id, patch: { consent_keys: ["photos"] }, actor: actor() });
    await first.reached;

    const withdrawing = send(event.id, "POST", "/api/admin/events/:eventId/legal-documents/consent-photos/unpublish");
    const held = await stillWaiting(withdrawing);
    first.release();

    expect(held).toBe(true);
    expect((await adding).kind).toBe("saved");
    const answer = await withdrawing;
    expect(answer.status).toBe(409);
    expect(await answer.json()).toEqual({ error: "legal_document_in_use" });
    expect((await settingsRow(event.id))?.consent_keys).toEqual(["photos"]);
    const text = await prisma.legalDocument.findFirst({ where: { event_id: event.id, kind: "consent", key: "photos" } });
    expect(text?.published_at).not.toBeNull();
  });

  it("makes a question that the form would not ask wait until the save has turned registration on, and then refuses it", async () => {
    const event = await addEvent("field-race");
    const first = pausingClient(prisma, "eventCustomField", "findMany");
    const enabling = updateEventRegistrationSettings(first.client, { eventId: event.id, patch: { mode: "automatic" }, actor: actor() });
    await first.reached;

    const saving = send(event.id, "POST", "/api/admin/events/:eventId/custom-fields", {
      source_field: "late",
      label: "Late",
      required: true,
      show_on_form: false,
    });
    const held = await stillWaiting(saving);
    first.release();

    expect(held).toBe(true);
    expect((await enabling).kind).toBe("saved");
    const answer = await saving;
    // Before the save the event was off, and a question of this kind was allowed; after it, it is not.
    expect(answer.status).toBe(422);
    expect(await answer.json()).toEqual({ error: "required_field_not_on_form" });
    expect(await prisma.eventCustomField.count({ where: { event_id: event.id } })).toBe(0);
  });
});

describe("a save that waits for a lock", () => {
  it("judges the end of the event by the clock read once it holds its locks, not by the one of the moment it was asked", async () => {
    // The event's day is 2099-05-14 in Warsaw: it is over from the night after.
    const event = await addEvent("clock");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2099-05-14T08:00:00Z"));
      const holding = holdLock(event.id, acquireEventCustomFieldsLock);
      await holding.started;
      const enabling = updateEventRegistrationSettings(prisma, { eventId: event.id, patch: { mode: "automatic" }, actor: actor() });
      await sleep(200);

      vi.setSystemTime(new Date("2099-05-15T08:00:00Z"));
      await holding.release();

      expect(await enabling).toEqual({ kind: "not_ready", blockers: ["event_not_ended"] });
      expect((await settingsRow(event.id))?.mode).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a save and the deletion of its event", () => {
  it("answers that the event is not there, and writes nothing, when the event is deleted after the save has read it", async () => {
    const event = await addEvent("deleted");
    const first = pausingClient(prisma, "eventRegistrationSettings", "findUnique");
    const saving = updateEventRegistrationSettings(first.client, { eventId: event.id, patch: { waitlist_enabled: false }, actor: actor() });
    await first.reached;

    await prisma.event.delete({ where: { id: event.id } });
    first.release();

    expect(await saving).toEqual({ kind: "not_found" });
    expect(await settingsRow(event.id)).toBeNull();
    expect(await auditCount(event.id)).toBe(0);
  });
});

describe("a save and the writers of registrations", () => {
  it.each([
    ["an import, which holds the capacity lock", acquireEventCapacityLock],
    ["an erasure, which holds the registration queue", lockRegistrationQueue],
  ] as const)("does not wait for %s, and does not hold it up", async (_label, acquire) => {
    const event = await addEvent("writers");
    const holding = holdLock(event.id, acquire);
    await holding.started;

    const answer = await put(event.id, { mode: "automatic", waitlist_enabled: false });
    await holding.release();

    expect(answer.status).toBe(200);
    expect(await settingsRow(event.id)).toMatchObject({ mode: "automatic", waitlist_enabled: false });
  });

  /** A guest sends the form while an import holds the capacity lock; `meanwhile` runs while the guest waits for it. */
  async function guestWaitsForTheLock(label: string, meanwhile: (h: ReturnType<typeof harness>, eventId: string) => Promise<void>) {
    const event = await addEvent(label, { settings: { mode: "automatic", verify_email: false } });
    const h = harness({ prisma, placement: { retryMs: 10_000, pauseMs: [20, 40] } });
    const importing = holdLock(event.id, acquireEventCapacityLock);
    await importing.started;

    const guest = h.post(event.slug, h.body(event.slug));
    await sleep(400);
    await meanwhile(h, event.id);
    await importing.release();
    const answer = await guest;
    return { answer, registrations: await prisma.registration.count({ where: { event_id: event.id } }), mails: await prisma.registrationMail.count({ where: { event_id: event.id } }) };
  }

  it("lets a guest who waits for the capacity lock register when nothing changes meanwhile (the control of the next test)", async () => {
    const { answer, registrations } = await guestWaitsForTheLock("guest-control", async () => {});

    expect(answer.status).toBe(200);
    expect(registrations).toBe(1);
  });

  it("turns registration off for a guest who is already on the way: they are told it is closed, and nothing is stored", async () => {
    const { answer, registrations, mails } = await guestWaitsForTheLock("guest-off", async (h, eventId) => {
      const off = await h.app.request(`${ORIGIN}${settingsPath(eventId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: adminCookie },
        body: JSON.stringify({ mode: null }),
      });
      expect(off.status).toBe(200);
    });

    // The one not-found answer of the registration routes, as for an event that never had the form.
    expect(answer.status).toBe(404);
    expect(registrations).toBe(0);
    expect(mails).toBe(0);
  });
});
