/**
 * Guest registration while the superadmin set bot protection to "not used" (A2), against a real database: the form opens
 * and takes a submission without the Turnstile keys and without a token, never calls Cloudflare, and is held back by the
 * same counts as with the check (they are not tightened: the people of a company share one address). The tests of the same routes with the check are in ./registration-submit-route.test.ts and
 * ./registration-submit-password.test.ts.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@admitto/auth";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { setEnabledAccessMethods } from "../../src/registration/access-methods.js";
import { setBotProtectionMode } from "../../src/registration/bot-protection-mode.js";
import { documentOf } from "../helpers/registration-form-fixtures.js";
import { SelectiveStore, eventSeeder, harness, nextEmail, signature, type EventSeed } from "../helpers/registration-submit-harness.js";

const peer = vi.hoisted(() => ({ address: "203.0.113.10" }));
vi.mock("@hono/node-server/conninfo", () => ({
  getConnInfo: vi.fn(() => ({ remote: { address: peer.address, port: 1234 } })),
}));

const ORG = "org-reg-a2-unchecked";
const PASSWORD = "test-password";
const WRONG = "wrong-password";

let prisma: PrismaClient;
let seeder: ReturnType<typeof eventSeeder>;
let hash: string;
let slugCounter = 0;
const nextSlug = (label: string) => `rega2-${label}-${(slugCounter += 1)}`;

beforeAll(async () => {
  prisma = createTestPrismaClient();
  seeder = eventSeeder(prisma, ORG);
  await seeder.prepare();
  hash = await hashPassword(PASSWORD);
});

afterAll(async () => {
  await seeder?.wipe();
  await prisma?.$disconnect();
});

beforeEach(async () => {
  peer.address = "203.0.113.10";
  resetSystemLogBufferForTest();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await setBotProtectionMode(prisma, "not_used");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await seeder.setSystemKeys(true);
});

const addLinkEvent = (slug: string, seed: EventSeed = {}) => seeder.addEvent(slug, seed);
const addPasswordEvent = (slug: string) =>
  seeder.addEvent(slug, { settings: { mode: "automatic", verify_email: true, access_methods: ["password"], password_hash: hash } });

const registrations = (eventId: string) => prisma.registration.count({ where: { event_id: eventId } });

describe("the page without the check", () => {
  it("opens with no keys saved at all, has no widget and tells the browser nothing about Cloudflare", async () => {
    const slug = nextSlug("page");
    await addLinkEvent(slug);
    await seeder.setSystemKeys(false);
    await setBotProtectionMode(prisma, "not_used");
    // `setSystemKeys(false)` also removes the ways in: turn them on again, with no keys.
    await setEnabledAccessMethods(prisma, ["link", "password"]);
    const h = harness({ prisma });

    const res = await h.get(`/r/${slug}`);

    expect(res.status).toBe(200);
    const doc = documentOf(await res.text());
    expect(doc.querySelector(".cf-turnstile")).toBeNull();
    expect(doc.querySelector("script[src]")).toBeNull();
    expect(doc.getElementById("reg-form").hidden).toBe(false);
    const policy = res.headers.get("content-security-policy") ?? "";
    expect(policy).not.toContain("challenges.cloudflare.com");
    expect(policy).toContain("script-src 'nonce-");
  });

  it("is the one 404 again, and has the widget, once the check is required and the keys are not there", async () => {
    const slug = nextSlug("required-again");
    await addLinkEvent(slug);
    const h = harness({ prisma });
    expect(documentOf(await (await h.get(`/r/${slug}`)).text()).querySelector(".cf-turnstile")).toBeNull();

    await setBotProtectionMode(prisma, "required");
    const required = await h.get(`/r/${slug}`);
    expect(required.status).toBe(200);
    expect(documentOf(await required.text()).querySelector(".cf-turnstile")).not.toBeNull();
    expect(required.headers.get("content-security-policy")).toContain("https://challenges.cloudflare.com");

    await seeder.setSystemKeys(false);
    expect((await h.get(`/r/${slug}`)).status).toBe(404);
  });
});

describe("a submission without the check", () => {
  it("is taken with no token, and Cloudflare is never asked", async () => {
    const slug = nextSlug("link");
    const eventId = await addLinkEvent(slug);
    const h = harness({ prisma });

    const res = await h.post(slug, h.body(slug, { challenge: undefined }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await registrations(eventId)).toBe(1);
    expect(h.cf.mock).not.toHaveBeenCalled();
  });

  it("does not read a token that is sent anyway: a refused one passes, and Cloudflare is still not asked", async () => {
    const slug = nextSlug("token-ignored");
    const eventId = await addLinkEvent(slug);
    const h = harness({ prisma });

    const res = await h.post(slug, h.body(slug, { challenge: "refused:x:1" }));

    expect(res.status).toBe(200);
    expect(await registrations(eventId)).toBe(1);
    expect(h.cf.mock).not.toHaveBeenCalled();
  });

  it("gives the same answer as a submission with the check, byte for byte, apart from the date", async () => {
    const slug = nextSlug("same-answer");
    await addLinkEvent(slug);
    const h = harness({ prisma });
    const without = await signature(await h.post(slug, h.body(slug)));

    await setBotProtectionMode(prisma, "required");
    const withCheck = await signature(await h.post(slug, h.body(slug)));

    expect(without).toEqual(withCheck);
  });

  it("asks for the token again the moment the check is required: no token is a 400, with the sentence of the page", async () => {
    const slug = nextSlug("required");
    const eventId = await addLinkEvent(slug);
    await setBotProtectionMode(prisma, "required");
    const h = harness({ prisma });

    const res = await h.post(slug, h.body(slug, { challenge: undefined }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ errors: { challenge: "The security check did not pass. Try again." } });
    expect(await registrations(eventId)).toBe(0);
  });

  it("is held to the usual ceiling of the event, 600 a minute, and to no other", async () => {
    const slug = nextSlug("ceiling");
    const eventId = await addLinkEvent(slug);
    const store = new SelectiveStore();
    const h = harness({ prisma, store });

    expect((await h.post(slug, h.body(slug))).status).toBe(200);
    expect(store.keys.filter((key) => key.includes("event"))).toEqual([`registration:event:${eventId}`]);

    for (let i = 0; i < 599; i += 1) await store.inner.hit(`registration:event:${eventId}`, 60_000, 600); // NOSONAR - counts requests in order
    const before = await registrations(eventId);
    const refused = await h.post(slug, h.body(slug));

    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "too many requests" });
    expect(await registrations(eventId)).toBe(before);
  });

  it("is the one 404 for an event that is not open, whatever the mode", async () => {
    const slug = nextSlug("off");
    await addLinkEvent(slug, { archived: true });
    const h = harness({ prisma });

    expect((await h.post(slug, h.body(slug))).status).toBe(404);
  });
});

describe("the password without the check", () => {
  it("opens with the right password and no token, and turns a wrong one away with the one 403", async () => {
    const slug = nextSlug("pw");
    const eventId = await addPasswordEvent(slug);
    const h = harness({ prisma });

    const wrong = await h.post(slug, h.body(slug, { challenge: undefined, password: WRONG }));
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toEqual({ error: "access_denied" });
    expect(await registrations(eventId)).toBe(0);

    const right = await h.post(slug, h.body(slug, { challenge: undefined, password: PASSWORD }));
    expect(right.status).toBe(200);
    expect(await registrations(eventId)).toBe(1);
    expect(h.cf.mock).not.toHaveBeenCalled();
  });

  it("allows 30 tries in 15 minutes for a client, as with the check, and the 31st is a 429 with one line for the operator", async () => {
    const slug = nextSlug("pw-client");
    const eventId = await addPasswordEvent(slug);
    const store = new SelectiveStore();
    const h = harness({ prisma, store });

    for (let i = 0; i < 30; i += 1) {
      expect((await h.post(slug, h.body(slug, { password: WRONG }))).status, `try ${i + 1}`).toBe(403);
    }
    const before = await registrations(eventId);
    const refused = await h.post(slug, h.body(slug, { password: PASSWORD }));

    expect(refused.status).toBe(429);
    expect(await registrations(eventId)).toBe(before);
    const lines = querySystemLogs({ search: "registration_password_tries_refused" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "warn", source: "security", fields: { event_id: eventId, budget: "client" } });
    // Another office has its own tries.
    peer.address = "198.51.100.77";
    expect((await h.post(slug, h.body(slug, { password: PASSWORD }))).status).toBe(200);
  });

  it("allows 120 tries a minute for the event from everybody, as with the check, and the next is a 429 in the budget of the event", async () => {
    const slug = nextSlug("pw-event");
    const eventId = await addPasswordEvent(slug);
    const store = new SelectiveStore();
    const h = harness({ prisma, store });
    for (let i = 0; i < 120; i += 1) await store.inner.hit(`registration:password-event:${eventId}`, 60_000, 120); // NOSONAR - counts requests in order

    const refused = await h.post(slug, h.body(slug, { password: PASSWORD }));

    expect(refused.status).toBe(429);
    expect(querySystemLogs({ search: "registration_password_tries_refused" })[0]).toMatchObject({ fields: { event_id: eventId, budget: "event" } });
  });

  it("uses the very keys it uses with the check, in the same order, and no key of its own", async () => {
    const slug = nextSlug("pw-keys");
    const eventId = await addPasswordEvent(slug);
    const keysOf = async () => {
      const store = new SelectiveStore();
      const h = harness({ prisma, store });
      await h.post(slug, h.body(slug, { password: PASSWORD }));
      // The mail budget of the address is the same too, but it is not what is asked here.
      return store.keys.filter((key) => !key.startsWith("registration:mail-")).map((key) => key.replace(eventId, "<event>"));
    };

    const withoutCheck = await keysOf();
    await setBotProtectionMode(prisma, "required");
    peer.address = "198.51.100.88";
    const withCheck = await keysOf();

    expect(withoutCheck).toEqual([
      "registration:submit:ip:203.0.113.10",
      "registration:event:<event>",
      "registration:password:ip:203.0.113.10",
      "registration:password-event:<event>",
    ]);
    expect(withCheck.map((key) => key.replace("198.51.100.88", "203.0.113.10"))).toEqual(withoutCheck);
  });

  it("is spent by a stranger who has no token: a wrong try costs a try, and there is nothing to hold it back", async () => {
    const slug = nextSlug("pw-stranger");
    await addPasswordEvent(slug);
    const store = new SelectiveStore();
    const h = harness({ prisma, store });

    await h.post(slug, h.body(slug, { challenge: undefined, password: WRONG, email: nextEmail("stranger") }));

    expect(store.keys.filter((key) => key.startsWith("registration:password:"))).toHaveLength(1);
  });
});
