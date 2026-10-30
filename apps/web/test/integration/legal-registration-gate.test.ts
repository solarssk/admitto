import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import {
  acquireEventLegalDocumentsLock,
  guardRegistrationLegalGate,
  loadRequiredLegalDocuments,
  registrationNeedsLegalDocument,
} from "../../src/legal/registration-gate.js";

const ORG = "org-legal-gate";
const EVENT = "evt-legal-gate";
const EVENT_OTHER = "evt-legal-gate-other";
const EVENT_IDS = [EVENT, EVENT_OTHER];

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await prisma.legalDocument.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await prisma.eventRegistrationSettings.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await prisma.event.deleteMany({ where: { id: { in: EVENT_IDS } } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
  await prisma.organization.create({ data: { id: ORG, name: "Legal Gate Org", slug: "legal-gate-org" } });
  await prisma.event.createMany({
    data: [
      { id: EVENT, title: "Legal Gate", slug: "legal-gate", date: new Date("2026-10-01"), organization_id: ORG },
      { id: EVENT_OTHER, title: "Legal Gate Other", slug: "legal-gate-other", date: new Date("2026-10-02"), organization_id: ORG },
    ],
  });
});

beforeEach(async () => {
  await prisma.legalDocument.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
  await prisma.eventRegistrationSettings.deleteMany({ where: { event_id: { in: EVENT_IDS } } });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

type Kind = "privacy_notice" | "event_terms" | "consent";

async function write(eventId: string, kind: Kind, options: { key?: string; published?: boolean; title?: string } = {}) {
  const { key = "", published = true, title = `${kind} ${key}`.trim() } = options;
  await prisma.legalDocument.create({
    data: {
      event_id: eventId,
      kind,
      key,
      title,
      content_html: "<p>Text</p>",
      published_at: published ? new Date("2026-10-20T10:00:00Z") : null,
    },
  });
}

const NOTICE = { ref: "privacy-notice", kind: "privacy_notice", key: null };
const TERMS = { ref: "event-terms", kind: "event_terms", key: null };

/** The shape of the screen that turns registration on (PR 99a): a route that asks the gate first, in the
 * transaction that would save the settings. */
function gateApp(db: PrismaClient) {
  const app = new Hono();
  app.post("/events/:eventId/turn-on", async (c) => {
    const body = (await c.req.json()) as { consent_keys: string[] };
    return db.$transaction(
      async (tx) => (await guardRegistrationLegalGate(c, tx, c.req.param("eventId"), body.consent_keys)) ?? c.json({ ok: true }),
    );
  });
  return app;
}

const turnOn = (app: ReturnType<typeof gateApp>, eventId: string, consent_keys: string[]) =>
  app.request(`/events/${eventId}/turn-on`, { method: "POST", body: JSON.stringify({ consent_keys }) });

describe("loadRequiredLegalDocuments", () => {
  it("misses both required texts for an event with none", async () => {
    const { published, missing } = await loadRequiredLegalDocuments(prisma, EVENT, []);
    expect(published).toEqual([]);
    expect(missing).toEqual([
      { kind: "privacy_notice", key: "" },
      { kind: "event_terms", key: "" },
    ]);
  });

  it("lists the published texts with their titles, in the order a form shows them", async () => {
    await write(EVENT, "consent", { key: "photos", title: "Photos" });
    await write(EVENT, "event_terms", { title: "Terms of entry" });
    await write(EVENT, "privacy_notice", { title: "Information clause" });
    await write(EVENT, "consent", { key: "news", title: "News" });
    const { published, missing } = await loadRequiredLegalDocuments(prisma, EVENT, ["news", "photos"]);
    expect(missing).toEqual([]);
    expect(published).toEqual([
      { kind: "privacy_notice", key: "", title: "Information clause" },
      { kind: "event_terms", key: "", title: "Terms of entry" },
      { kind: "consent", key: "news", title: "News" },
      { kind: "consent", key: "photos", title: "Photos" },
    ]);
  });

  it("does not count a draft", async () => {
    await write(EVENT, "privacy_notice");
    await write(EVENT, "event_terms", { published: false });
    const { missing } = await loadRequiredLegalDocuments(prisma, EVENT, []);
    expect(missing).toEqual([{ kind: "event_terms", key: "" }]);
  });

  it("asks for a consent only when the event lists it, and misses one it lists but has not written", async () => {
    await write(EVENT, "privacy_notice");
    await write(EVENT, "event_terms");
    await write(EVENT, "consent", { key: "photos", published: false });
    expect((await loadRequiredLegalDocuments(prisma, EVENT, [])).missing).toEqual([]);
    expect((await loadRequiredLegalDocuments(prisma, EVENT, ["photos", "news"])).missing).toEqual([
      { kind: "consent", key: "photos" },
      { kind: "consent", key: "news" },
    ]);
  });

  it("never takes another event's text", async () => {
    await write(EVENT_OTHER, "privacy_notice");
    await write(EVENT_OTHER, "event_terms");
    expect((await loadRequiredLegalDocuments(prisma, EVENT, [])).missing).toHaveLength(2);
    expect((await loadRequiredLegalDocuments(prisma, EVENT_OTHER, [])).missing).toEqual([]);
  });

  it("reads inside a transaction too", async () => {
    await write(EVENT, "privacy_notice");
    const missing = await prisma.$transaction(async (tx) => (await loadRequiredLegalDocuments(tx, EVENT, [])).missing);
    expect(missing).toEqual([{ kind: "event_terms", key: "" }]);
  });
});

describe("guardRegistrationLegalGate", () => {
  it("answers 409 with what is missing, so registration cannot be turned on", async () => {
    const res = await turnOn(gateApp(prisma), EVENT, []);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "legal_documents_missing", missing: [NOTICE, TERMS] });
  });

  it("names only the texts still missing", async () => {
    await write(EVENT, "privacy_notice");
    const res = await turnOn(gateApp(prisma), EVENT, ["photos"]);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "legal_documents_missing",
      missing: [TERMS, { ref: "consent-photos", kind: "consent", key: "photos" }],
    });
  });

  it("answers 409 for a draft", async () => {
    await write(EVENT, "privacy_notice");
    await write(EVENT, "event_terms", { published: false });
    const res = await turnOn(gateApp(prisma), EVENT, []);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "legal_documents_missing", missing: [TERMS] });
  });

  it("lets the caller through once everything is published", async () => {
    await write(EVENT, "privacy_notice");
    await write(EVENT, "event_terms");
    await write(EVENT, "consent", { key: "photos" });
    const res = await turnOn(gateApp(prisma), EVENT, ["photos"]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("shuts again when a text is withdrawn", async () => {
    await write(EVENT, "privacy_notice");
    await write(EVENT, "event_terms");
    expect((await turnOn(gateApp(prisma), EVENT, [])).status).toBe(200);
    await prisma.legalDocument.updateMany({ where: { event_id: EVENT, kind: "event_terms" }, data: { published_at: null } });
    expect((await turnOn(gateApp(prisma), EVENT, [])).status).toBe(409);
  });

  it("does not look at another event's texts", async () => {
    await write(EVENT_OTHER, "privacy_notice");
    await write(EVENT_OTHER, "event_terms");
    expect((await turnOn(gateApp(prisma), EVENT, [])).status).toBe(409);
  });
});

describe("registrationNeedsLegalDocument", () => {
  const notice = { kind: "privacy_notice", key: "" } as const;
  const photos = { kind: "consent", key: "photos" } as const;

  it("is false while the event has no settings or registration is off", async () => {
    expect(await registrationNeedsLegalDocument(prisma, EVENT, notice)).toBe(false);
    await prisma.eventRegistrationSettings.create({ data: { event_id: EVENT, mode: null, consent_keys: ["photos"] } });
    expect(await registrationNeedsLegalDocument(prisma, EVENT, notice)).toBe(false);
    expect(await registrationNeedsLegalDocument(prisma, EVENT, photos)).toBe(false);
  });

  it("is true for the notice and the terms once registration is on, and for the consents the event lists", async () => {
    await prisma.eventRegistrationSettings.create({ data: { event_id: EVENT, mode: "automatic", consent_keys: ["photos"] } });
    expect(await registrationNeedsLegalDocument(prisma, EVENT, notice)).toBe(true);
    expect(await registrationNeedsLegalDocument(prisma, EVENT, { kind: "event_terms", key: "" })).toBe(true);
    expect(await registrationNeedsLegalDocument(prisma, EVENT, photos)).toBe(true);
    expect(await registrationNeedsLegalDocument(prisma, EVENT, { kind: "consent", key: "news" })).toBe(false);
  });

  it("is about this event only", async () => {
    await prisma.eventRegistrationSettings.create({ data: { event_id: EVENT_OTHER, mode: "approval" } });
    expect(await registrationNeedsLegalDocument(prisma, EVENT, notice)).toBe(false);
    expect(await registrationNeedsLegalDocument(prisma, EVENT_OTHER, notice)).toBe(true);
  });
});

describe("guardRegistrationLegalGate and the lock", () => {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("holds the event's lock until its transaction ends, so no text is withdrawn between the check and the save", async () => {
    await write(EVENT, "privacy_notice");
    await write(EVENT, "event_terms");
    let checked!: () => void;
    const guardDone = new Promise<void>((resolve) => (checked = resolve));
    let release!: () => void;
    const mayCommit = new Promise<void>((resolve) => (release = resolve));
    const gate = new Hono();
    gate.post("/", (c) =>
      prisma.$transaction(async (tx) => {
        const blocked = await guardRegistrationLegalGate(c, tx, EVENT, []);
        checked();
        await mayCommit;
        return blocked ?? c.json({ ok: true });
      }),
    );
    const turnOnResult = Promise.resolve(gate.request("/", { method: "POST" }));
    await guardDone;

    // Another transaction that wants the same event's lock (what unpublish, delete and save do).
    let withdrawn = false;
    const withdrawal = prisma.$transaction(async (tx) => {
      await acquireEventLegalDocumentsLock(tx, EVENT);
      withdrawn = true;
    });
    await wait(300);
    expect(withdrawn).toBe(false);

    release();
    expect((await turnOnResult).status).toBe(200);
    await withdrawal;
    expect(withdrawn).toBe(true);
  });
});

describe("acquireEventLegalDocumentsLock", () => {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("holds a second transaction of the same event until the first ends, and not one of another event", async () => {
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    let release!: () => void;
    const mayCommit = new Promise<void>((resolve) => (release = resolve));
    const holder = prisma.$transaction(async (tx) => {
      await acquireEventLegalDocumentsLock(tx, EVENT);
      locked();
      await mayCommit;
    });
    await lockTaken;

    const events: string[] = [];
    const sameEvent = prisma.$transaction(async (tx) => {
      await acquireEventLegalDocumentsLock(tx, EVENT);
      events.push("same event got the lock");
    });
    const otherEvent = prisma.$transaction(async (tx) => {
      await acquireEventLegalDocumentsLock(tx, EVENT_OTHER);
      events.push("other event got the lock");
    });
    await otherEvent;
    await wait(300);
    expect(events).toEqual(["other event got the lock"]);

    release();
    await holder;
    await sameEvent;
    expect(events).toEqual(["other event got the lock", "same event got the lock"]);
  });
});
