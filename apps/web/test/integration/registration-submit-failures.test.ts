/**
 * What `POST /r/:slug` does when things go wrong, and that nothing a guest typed is written down by the way: not in
 * a log line, not in the system log, not in an answer (SEC-10, DP-16, ERA-14). The failures are made on purpose: a
 * database that errors with a message that carries the guest's address and name, an event that is deleted while the
 * request runs, a unique address taken in the meantime.
 */
import { inspect } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { eventSeeder, harness, recordingPace, signature } from "../helpers/registration-submit-harness.js";

const ORG = "org-reg95c-failures";

let prisma: PrismaClient;
let seeder: ReturnType<typeof eventSeeder>;
let slugCounter = 0;
const nextSlug = (label: string) => `reg95c-fail-${label}-${(slugCounter += 1)}`;

/** What the guest in these tests types; none of it may come back out of the route in any form but the 200 itself. */
const NAME = "Zofia";
const SURNAME = "Kowalczyk-Example";
const ADDRESS = "zofia.secret@example.com";
const IDENTIFYING = [NAME, SURNAME, ADDRESS, "kowalczyk", "zofia."].map((text) => text.toLowerCase());

const consoleMethods = ["log", "info", "warn", "error", "debug"] as const;
const spies = new Map<(typeof consoleMethods)[number], { mock: { calls: unknown[][] } }>();

beforeAll(async () => {
  prisma = createTestPrismaClient();
  seeder = eventSeeder(prisma, ORG);
  await seeder.prepare();
});

afterAll(async () => {
  await seeder?.wipe();
  await prisma?.$disconnect();
});

beforeEach(() => {
  resetSystemLogBufferForTest();
  for (const method of consoleMethods) spies.set(method, vi.spyOn(console, method).mockImplementation(() => {}));
});

afterEach(() => {
  vi.restoreAllMocks();
  spies.clear();
});

/** Everything that was written to the console or to the system log since the test began, as one lower-case text. */
function written(): string {
  const lines = [...spies.values()].flatMap((spy) => spy.mock.calls.map((call) => call.map((arg) => inspect(arg, { depth: 6 })).join(" ")));
  const entries = querySystemLogs().map((entry) => JSON.stringify(entry));
  return [...lines, ...entries].join("\n").toLowerCase();
}

function expectNothingIdentifying(text: string): void {
  for (const fragment of IDENTIFYING) expect(text).not.toContain(fragment);
}

/** The client, with a failure at one place. The message of every error carries what the guest typed. */
function failing(client: PrismaClient, where: { transaction?: unknown; eventRead?: unknown }): PrismaClient {
  return new Proxy(client, {
    get(target, key, receiver) {
      if (key === "$transaction" && where.transaction !== undefined) return () => Promise.reject(where.transaction);
      if (key === "event" && where.eventRead !== undefined) return { findUnique: () => Promise.reject(where.eventRead) };
      return Reflect.get(target, key, receiver);
    },
  });
}

const leaky = () => new Error(`insert failed for ${ADDRESS} (${NAME} ${SURNAME})`);
const known = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(`Constraint failed on the values (${ADDRESS}, ${NAME})`, { code, clientVersion: "test" });

describe("an error nobody expected", () => {
  it("answers 500 with a fixed body, and logs the class of the error and the route, nothing else", async () => {
    const slug = nextSlug("boom");
    await seeder.addEvent(slug);
    const h = harness({ prisma: failing(prisma, { transaction: leaky() }) });

    const res = await h.post(slug, h.body(slug, { email: ADDRESS, first_name: NAME, last_name: SURNAME }));

    expect(res.status).toBe(500);
    expect(await res.text()).toBe('{"error":"internal_error"}');
    expect(spies.get("error")!.mock.calls).toEqual([["registration submit failed:", { reason: "Error", code: undefined }]]);
    const entries = querySystemLogs();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ level: "error", source: "api", message: "registration_submit_failed", fields: { route: "/r/:slug" } });
    expectNothingIdentifying(written());
  });

  it("does the same when the event cannot be read", async () => {
    const slug = nextSlug("unreadable");
    const h = harness({ prisma: failing(prisma, { eventRead: leaky() }) });

    const res = await h.post(slug, h.body(slug, { email: ADDRESS, first_name: NAME, last_name: SURNAME }));

    expect(res.status).toBe(500);
    expect(await res.text()).toBe('{"error":"internal_error"}');
    expectNothingIdentifying(written());
  });

  it("logs the code of a database error, which names a kind of error and never a value", async () => {
    const slug = nextSlug("coded");
    await seeder.addEvent(slug);
    const h = harness({ prisma: failing(prisma, { transaction: known("P2034") }) });

    const res = await h.post(slug, h.body(slug, { email: ADDRESS, first_name: NAME, last_name: SURNAME }));

    expect(res.status).toBe(500);
    expect(spies.get("error")!.mock.calls).toEqual([["registration submit failed:", { reason: "PrismaClientKnownRequestError", code: "P2034" }]]);
    expectNothingIdentifying(written());
  });

  it("does not let an error of the challenge's transport, which may name the token, reach a log or an answer", async () => {
    const slug = nextSlug("transport");
    await seeder.addEvent(slug);
    const h = harness({ prisma });
    h.cf.mock.mockRejectedValueOnce(new Error(`connect ECONNREFUSED token=${slug} ${ADDRESS}`));

    const res = await h.post(slug, h.body(slug, { email: ADDRESS, first_name: NAME, last_name: SURNAME }));

    expect(res.status).toBe(503);
    expect(await res.text()).toBe('{"error":"try_again"}');
    expectNothingIdentifying(written());
  });
});

describe("an event that goes while the request runs, and an address that is taken meanwhile", () => {
  it("answers the 404 of an event that is not there when the database refuses the row for its event (P2003)", async () => {
    const slug = nextSlug("gone");
    await seeder.addEvent(slug);
    const h = harness({ prisma: failing(prisma, { transaction: known("P2003") }) });
    const unknown = await signature(await h.post("reg95c-fail-no-such-event", h.body("reg95c-fail-no-such-event")));

    const res = await h.post(slug, h.body(slug, { email: ADDRESS, first_name: NAME, last_name: SURNAME }));

    expect(await signature(res)).toEqual(unknown);
    expectNothingIdentifying(written());
  });

  it("holds that answer for the same floor as every other 'received', for the work of a new address is what the wait hides (P2002)", async () => {
    const slug = nextSlug("taken-floor");
    await seeder.addEvent(slug, { settings: { verify_email: true } });
    const { pace, sleep } = recordingPace(250);
    const h = harness({ prisma: failing(prisma, { transaction: known("P2002") }), pace });

    const res = await h.post(slug, h.body(slug, { email: ADDRESS, first_name: NAME, last_name: SURNAME }));

    expect(res.status).toBe(200);
    expect(sleep.mock.calls).toEqual([[250]]);
  });

  it("answers what a known address is told when the database says the address is taken (P2002)", async () => {
    const slug = nextSlug("taken");
    await seeder.addEvent(slug, { settings: { verify_email: true } });
    const ok = harness({ prisma });
    const normal = await signature(await ok.post(slug, ok.body(slug)));
    const h = harness({ prisma: failing(prisma, { transaction: known("P2002") }) });

    const res = await h.post(slug, h.body(slug, { email: ADDRESS, first_name: NAME, last_name: SURNAME }));

    expect(await signature(res)).toEqual(normal);
    expectNothingIdentifying(written());
  });
});

describe("nothing that identifies a guest is written down, whatever the request comes to", () => {
  it("logs nothing at all for a form that is refused, a challenge that fails, a closed event, a full event, or a success", async () => {
    const open = nextSlug("quiet-open");
    const full = nextSlug("quiet-full");
    const closed = nextSlug("quiet-closed");
    await seeder.addEvent(open, { settings: { verify_email: true } });
    const fullId = await seeder.addEvent(full, { capacity: 1, settings: { waitlist_enabled: false, verify_email: false } });
    await prisma.attendee.create({ data: { event_id: fullId, email: "taker-95c@example.com", name: "Seat Taker" } });
    await seeder.addEvent(closed, { archived: true });
    const h = harness({ prisma });
    const identity = { email: ADDRESS, first_name: NAME, last_name: SURNAME };

    const answers = [
      await h.post(open, h.body(open, identity)),
      await h.post(open, h.body(open, { ...identity, last_name: "see https://evil.example" })),
      await h.post(open, h.body(open, { ...identity, terms: false })),
      await h.post(open, h.body(open, { ...identity, challenge: "refused:x:1" })),
      await h.post(open, h.body(open, { ...identity, challenge: "down:x:1" })),
      await h.post(open, null, { raw: `{"email":"${ADDRESS}",` }),
      await h.post(open, h.body(open, { ...identity, extra: NAME })),
      await h.post(closed, h.body(closed, identity)),
      await h.post(full, h.body(full, identity)),
      await h.post(open, h.body(open, { ...identity, consents: [NAME] })),
    ];

    expect(answers.map((res) => res.status)).toEqual([200, 422, 422, 400, 503, 400, 400, 404, 409, 400]);
    const bodies = (await Promise.all(answers.map((res) => res.text()))).join("\n").toLowerCase();
    // The answers repeat nothing of what was typed, apart from the page's own fixed sentences.
    expectNothingIdentifying(bodies);
    expect(spies.get("error")!.mock.calls).toEqual([]);
    expect(querySystemLogs()).toEqual([]);
    expectNothingIdentifying(written());
  });
});
