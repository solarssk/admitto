/**
 * POST …/attendees/:id/erase and …/attendees/bulk-erase: the person is anonymised in place, the
 * audit trail holds ids and counts only, a wallet pass is deleted at the provider afterwards (and
 * tried again when the same request is repeated), copies in saved import results are blanked, and
 * it works on an archived event.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { encryptToString } from "@admitto/crypto";
import type { Context } from "hono";
import { createApp } from "../../src/app.js";
import { handleBulkEraseEventAttendees, handleEraseEventAttendee } from "../../src/admin/attendee-erase-routes.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";

const ORG_ID = "org-erase-api";
const EVENT_ID = "evt-erase-api";
const ARCHIVED_EVENT_ID = "evt-erase-api-archived";
const WALLET_OFF_EVENT_ID = "evt-erase-api-wallet-off";
const OTHER_ORG_ID = "org-erase-api-other";
const OTHER_ADMIN_EMAIL = "erase-api-other-admin@example.com";
const SUPER_EMAIL = "erase-api-super@example.com";
const SUPER_PASSWORD = "erase-api-super-pass-123";
const sameOrigin = { Origin: "http://localhost" };

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let cookie = "";
let seq = 0;

const post = (path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { Cookie: cookie, ...sameOrigin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const erasePath = (eventId: string, attendeeId: string) => `/api/admin/events/${eventId}/attendees/${attendeeId}/erase`;
const bulkPath = (eventId: string) => `/api/admin/events/${eventId}/attendees/bulk-erase`;

async function createAttendee(eventId = EVENT_ID, extra: Record<string, unknown> = {}) {
  const n = ++seq;
  return prisma.attendee.create({
    data: {
      id: `erase-api-att-${n}`,
      event_id: eventId,
      email: `Erase.Api.${n}@example.com`,
      name: `Erase Api ${n}`,
      first_name: "Erase",
      last_name: `Api ${n}`,
      company: "Acme",
      ...extra,
    },
  });
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  for (const id of [EVENT_ID, ARCHIVED_EVENT_ID, WALLET_OFF_EVENT_ID]) {
    await prisma.adminJob.deleteMany({ where: { event_id: id } });
    await prisma.attendeeActionLog.deleteMany({ where: { event_id: id } });
    await prisma.walletPass.deleteMany({ where: { attendee: { event_id: id } } });
    await prisma.attendee.deleteMany({ where: { event_id: id } });
    await prisma.event.deleteMany({ where: { id } });
  }
  await prisma.organization.deleteMany({ where: { id: { in: [ORG_ID, OTHER_ORG_ID] } } });
  await prisma.organization.create({ data: { id: ORG_ID, name: "Org", slug: "erase-api-org" } });
  await prisma.organization.create({ data: { id: OTHER_ORG_ID, name: "Other Org", slug: "erase-api-other-org" } });
  const base = { organization_id: ORG_ID, date: new Date("2099-09-01") };
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      title: "Erase Api",
      slug: "erase-api",
      wallet_template_id: "tmpl-erase-api",
      wallet_api_key_enc: encryptToString("erase-api-key"),
      ...base,
    },
  });
  await prisma.event.create({
    data: { id: ARCHIVED_EVENT_ID, title: "Archived", slug: "erase-api-archived", archived_at: new Date("2099-10-01"), ...base },
  });
  // Credentials present, the Wallet switch off: the pass is still deleted at the provider.
  await prisma.event.create({
    data: {
      id: WALLET_OFF_EVENT_ID,
      title: "Wallet Off",
      slug: "erase-api-wallet-off",
      wallet_enabled: false,
      wallet_template_id: "tmpl-erase-api-off",
      wallet_api_key_enc: encryptToString("erase-api-key-off"),
      ...base,
    },
  });

  for (const email of [OTHER_ADMIN_EMAIL]) {
    await prisma.session.deleteMany({ where: { user: { email } } });
    await prisma.roleAssignment.deleteMany({ where: { user: { email } } });
    await prisma.user.deleteMany({ where: { email } });
  }
  await prisma.session.deleteMany({ where: { user: { email: "erase-api-operator@example.com" } } });
  await prisma.roleAssignment.deleteMany({ where: { user: { email: "erase-api-operator@example.com" } } });
  await prisma.user.deleteMany({ where: { email: "erase-api-operator@example.com" } });
  await prisma.session.deleteMany({ where: { user: { email: SUPER_EMAIL } } });
  await prisma.roleAssignment.deleteMany({ where: { user: { email: SUPER_EMAIL } } });
  await prisma.user.deleteMany({ where: { email: SUPER_EMAIL } });
  const user = await prisma.user.create({
    data: { email: SUPER_EMAIL, password_hash: await hashPassword(SUPER_PASSWORD) },
  });
  await prisma.roleAssignment.create({
    data: { user_id: user.id, role: "superadmin", scope_type: "instance", scope_id: null },
  });
  await prisma.userMfaMethod.create({
    data: {
      user_id: user.id,
      type: "totp",
      secret_enc: encryptTotpSecret(generateTotpSecret()),
      confirmed_at: new Date(),
    },
  });
  const session = await createSession(prisma, { userId: user.id, stage: SESSION_STAGE.FULL });
  cookie = `admitto_session=${session.rawToken}`;
  app = createApp({
    prisma,
    baseUrl: "https://tickets.example.com",
    rateLimitStore: createRateLimitStore(),
    skipCheckinBootValidation: true,
  });
});

beforeEach(() => {
  // A fresh rate-limit budget for every test: the bulk limiter would otherwise run out.
  app = createApp({
    prisma,
    baseUrl: "https://tickets.example.com",
    rateLimitStore: createRateLimitStore(),
    skipCheckinBootValidation: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("erasing one attendee", () => {
  it("anonymises the row and answers with counts", async () => {
    const a = await createAttendee();
    const res = await post(erasePath(EVENT_ID, a.id));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ erased: 1, already_erased: 0, not_found: 0, wallet_pending: 0 });
    const row = await prisma.attendee.findUniqueOrThrow({ where: { id: a.id } });
    expect(row).toMatchObject({ name: "Erased attendee", email: `erased-${a.id}@erased.invalid`, company: null });
    expect(row.erased_at).not.toBeNull();
  });

  it("writes ids and counts to both audit logs, and no name or address", async () => {
    const a = await createAttendee();
    await post(erasePath(EVENT_ID, a.id));

    const eventLog = await prisma.attendeeActionLog.findFirstOrThrow({
      where: { event_id: EVENT_ID, action_type: "attendee_erased", attendee_id: null },
      orderBy: { created_at: "desc" },
    });
    const central = await prisma.adminAuditLog.findFirstOrThrow({
      where: { action_type: "attendee_erased", organization_id: ORG_ID },
      orderBy: { created_at: "desc" },
    });
    for (const metadata of [eventLog.metadata, central.metadata]) {
      expect(metadata).toMatchObject({ attendee_id: a.id, method: "erase" });
      const text = JSON.stringify(metadata).toLowerCase();
      expect(text).not.toContain(a.name.toLowerCase());
      expect(text).not.toContain("example.com");
    }
  });

  it("is the same call to repeat: nothing is erased twice and nothing new is audited", async () => {
    const a = await createAttendee();
    await post(erasePath(EVENT_ID, a.id));
    const countAudit = async () => [
      await prisma.attendeeActionLog.count({ where: { event_id: EVENT_ID, action_type: "attendee_erased" } }),
      await prisma.adminAuditLog.count({ where: { organization_id: ORG_ID, action_type: "attendee_erased" } }),
    ];
    const before = await countAudit();

    const again = await post(erasePath(EVENT_ID, a.id));

    expect(await again.json()).toEqual({ erased: 0, already_erased: 1, not_found: 0, wallet_pending: 0 });
    expect(await countAudit()).toEqual(before);
  });

  it("erases an attendee whose stored address has capitals and padding, and blanks it in an import result", async () => {
    const a = await createAttendee(EVENT_ID, { email: "  Legacy.Mixed@Example.COM " });
    const job = await prisma.adminJob.create({
      data: {
        type: "import_commit",
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        result_json: { skipped: [{ email: "legacy.mixed@example.com", reason: "Duplicate email" }] },
      },
    });

    const res = await post(erasePath(EVENT_ID, a.id));

    expect(res.status).toBe(200);
    expect(JSON.stringify((await prisma.adminJob.findUniqueOrThrow({ where: { id: job.id } })).result_json).toLowerCase()).not.toContain("legacy.mixed");
  });

  it("two overlapping requests for the same people erase each of them once", async () => {
    const a = await createAttendee();
    const b = await createAttendee();

    const [first, second] = await Promise.all([
      post(bulkPath(EVENT_ID), { attendeeIds: [a.id, b.id] }),
      post(bulkPath(EVENT_ID), { attendeeIds: [b.id, a.id] }),
    ]);
    const bodies = [(await first.json()) as { erased: number; already_erased: number }, (await second.json()) as { erased: number; already_erased: number }];

    expect(bodies[0]!.erased + bodies[1]!.erased).toBe(2);
    expect(bodies[0]!.already_erased + bodies[1]!.already_erased).toBe(2);
  });

  it("works on an archived event", async () => {
    const a = await createAttendee(ARCHIVED_EVENT_ID);
    const res = await post(erasePath(ARCHIVED_EVENT_ID, a.id));
    expect(res.status).toBe(200);
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: a.id } })).erased_at).not.toBeNull();
  });

  it("answers 403 for an attendee of another event and leaves them alone", async () => {
    const a = await createAttendee(ARCHIVED_EVENT_ID);
    const res = await post(erasePath(EVENT_ID, a.id));
    expect(res.status).toBe(403);
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: a.id } })).erased_at).toBeNull();
  });

  it("is refused for a door operator of the event", async () => {
    const operator = await prisma.user.create({
      data: { email: "erase-api-operator@example.com", password_hash: await hashPassword("erase-api-operator-pass-123") },
    });
    await prisma.roleAssignment.create({
      data: { user_id: operator.id, role: "operator", scope_type: "event", scope_id: EVENT_ID },
    });
    const session = await createSession(prisma, { userId: operator.id, stage: SESSION_STAGE.FULL });
    const a = await createAttendee();

    const res = await app.request(erasePath(EVENT_ID, a.id), {
      method: "POST",
      headers: { Cookie: `admitto_session=${session.rawToken}`, ...sameOrigin, "Content-Type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(403);
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: a.id } })).erased_at).toBeNull();
  });

  it("is refused for an administrator of another organisation", async () => {
    const admin = await prisma.user.create({
      data: { email: OTHER_ADMIN_EMAIL, password_hash: await hashPassword("erase-api-other-admin-pass-123") },
    });
    await prisma.roleAssignment.create({
      data: { user_id: admin.id, role: "admin", scope_type: "organization", scope_id: OTHER_ORG_ID },
    });
    await prisma.userMfaMethod.create({
      data: { user_id: admin.id, type: "totp", secret_enc: encryptTotpSecret(generateTotpSecret()), confirmed_at: new Date() },
    });
    const session = await createSession(prisma, { userId: admin.id, stage: SESSION_STAGE.FULL });
    const a = await createAttendee();
    const headers = { Cookie: `admitto_session=${session.rawToken}`, ...sameOrigin, "Content-Type": "application/json" };

    const single = await app.request(erasePath(EVENT_ID, a.id), { method: "POST", headers, body: "{}" });
    const bulk = await app.request(bulkPath(EVENT_ID), { method: "POST", headers, body: JSON.stringify({ attendeeIds: [a.id] }) });

    expect(single.status).toBe(403);
    expect(bulk.status).toBe(403);
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: a.id } })).erased_at).toBeNull();
  });

  it("is refused without a session", async () => {
    const a = await createAttendee();
    const res = await app.request(erasePath(EVENT_ID, a.id), {
      method: "POST",
      headers: { ...sameOrigin, "Content-Type": "application/json" },
      body: "{}",
    });
    expect([401, 403]).toContain(res.status);
    expect((await prisma.attendee.findUniqueOrThrow({ where: { id: a.id } })).erased_at).toBeNull();
  });

  it("blanks the erased address in a saved import result", async () => {
    const a = await createAttendee(EVENT_ID, { email: "import.copy@example.com" });
    const job = await prisma.adminJob.create({
      data: {
        type: "import_commit",
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        result_json: { created: 1, skipped: [{ email: "import.copy@example.com", reason: "Duplicate email" }], skippedCount: 1 },
      },
    });

    await post(erasePath(EVENT_ID, a.id));

    const after = (await prisma.adminJob.findUniqueOrThrow({ where: { id: job.id } })).result_json;
    expect(JSON.stringify(after)).not.toContain("import.copy@example.com");
    expect(after).toMatchObject({ created: 1, skippedCount: 1 });
  });
});

describe("the wallet pass of an erased attendee", () => {
  const withPass = async () => {
    const a = await createAttendee();
    await prisma.walletPass.create({
      data: { attendee_id: a.id, status: "active", provider_pass_id: `pc-${a.id}`, apple_url: "https://pc.test/a", user_agent: "UA/1.0" },
    });
    return a;
  };

  it("is deleted at the provider and marked removed", async () => {
    const a = await withPass();
    const fetchMock = vi.fn(async (_url: unknown) => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await post(erasePath(EVENT_ID, a.id));

    expect(await res.json()).toMatchObject({ erased: 1, wallet_pending: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`pc-${a.id}`);
    const pass = await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: a.id } });
    expect(pass).toMatchObject({ apple_url: null, user_agent: null });
    expect(pass.provider_removed_at).not.toBeNull();
  });

  it("is reported as pending when the provider fails, and repeating the request finishes it", async () => {
    const a = await withPass();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 500 })));

    const first = await post(erasePath(EVENT_ID, a.id));

    expect(await first.json()).toMatchObject({ erased: 1, wallet_pending: 1 });
    expect((await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: a.id } })).provider_removed_at).toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const retry = await post(erasePath(EVENT_ID, a.id));

    expect(await retry.json()).toEqual({ erased: 0, already_erased: 1, not_found: 0, wallet_pending: 0 });
    expect((await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: a.id } })).provider_removed_at).not.toBeNull();
  });

  it("is deleted when the credentials are there although the event's Wallet switch is off", async () => {
    const a = await createAttendee(WALLET_OFF_EVENT_ID);
    await prisma.walletPass.create({ data: { attendee_id: a.id, status: "active", provider_pass_id: `pc-${a.id}` } });
    const fetchMock = vi.fn(async (_url: unknown) => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await post(erasePath(WALLET_OFF_EVENT_ID, a.id));

    expect(await res.json()).toMatchObject({ erased: 1, wallet_pending: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stays pending, without calling anyone, when the event has no wallet credentials", async () => {
    const a = await createAttendee(ARCHIVED_EVENT_ID);
    await prisma.walletPass.create({ data: { attendee_id: a.id, status: "active", provider_pass_id: `pc-${a.id}` } });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await post(erasePath(ARCHIVED_EVENT_ID, a.id));

    expect(await res.json()).toMatchObject({ erased: 1, wallet_pending: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("erasing a selection", () => {
  it("reports the passes that could not be deleted as pending, and repeating the request finishes them", async () => {
    const a = await createAttendee();
    const b = await createAttendee();
    for (const x of [a, b]) {
      await prisma.walletPass.create({ data: { attendee_id: x.id, status: "active", provider_pass_id: `pc-${x.id}` } });
    }
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) =>
      String(url).includes(a.id) ? new Response("down", { status: 500 }) : new Response(null, { status: 200 }),
    ));

    const first = await post(bulkPath(EVENT_ID), { attendeeIds: [a.id, b.id] });
    expect(await first.json()).toMatchObject({ erased: 2, wallet_pending: 1 });

    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const retry = await post(bulkPath(EVENT_ID), { attendeeIds: [a.id, b.id] });
    expect(await retry.json()).toMatchObject({ erased: 0, already_erased: 2, wallet_pending: 0 });
  });

  it("refuses more than 100 attendees at once when the event has wallet credentials", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `nobody-${i}`);
    const res = await post(bulkPath(EVENT_ID), { attendeeIds: ids });
    expect(res.status).toBe(400);
  });

  it("erases the ones that exist, counts the rest, and audits the ids once", async () => {
    const a = await createAttendee();
    const b = await createAttendee();
    const done = await createAttendee();
    await post(erasePath(EVENT_ID, done.id));

    const res = await post(bulkPath(EVENT_ID), { attendeeIds: [a.id, b.id, done.id, "nobody"] });

    expect(await res.json()).toEqual({ erased: 2, already_erased: 1, not_found: 1, wallet_pending: 0 });
    const log = await prisma.attendeeActionLog.findFirstOrThrow({
      where: { event_id: EVENT_ID, action_type: "attendees_bulk_erased" },
      orderBy: { created_at: "desc" },
    });
    expect(log.metadata).toMatchObject({ count: 2, method: "erase" });
    expect((log.metadata as { attendee_ids: string[] }).attendee_ids.sort()).toEqual([a.id, b.id].sort());
    expect(JSON.stringify(log.metadata).toLowerCase()).not.toContain("example.com");
  });

  it("answers an invalid body with 400", async () => {
    const res = await app.request(bulkPath(EVENT_ID), {
      method: "POST",
      headers: { Cookie: cookie, ...sameOrigin, "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  it("only unknown ids: nothing is erased, nothing is audited, no provider is called", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const before = await prisma.attendeeActionLog.count({ where: { event_id: EVENT_ID, action_type: "attendees_bulk_erased" } });

    const res = await post(bulkPath(EVENT_ID), { attendeeIds: ["nobody-1", "nobody-2"] });

    expect(await res.json()).toEqual({ erased: 0, already_erased: 0, not_found: 2, wallet_pending: 0 });
    expect(await prisma.attendeeActionLog.count({ where: { event_id: EVENT_ID, action_type: "attendees_bulk_erased" } })).toBe(before);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still answers, with the pass pending, when the provider follow-up itself breaks", async () => {
    const a = await createAttendee();
    await prisma.walletPass.create({ data: { attendee_id: a.id, status: "active", provider_pass_id: `pc-${a.id}` } });
    vi.spyOn(prisma.walletPass, "findMany").mockRejectedValueOnce(new Error("db hiccup"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post(erasePath(EVENT_ID, a.id));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ erased: 1, wallet_pending: 1 });
    expect(errSpy).toHaveBeenCalled();
  });

  it("runs one provider follow-up at a time per user and event: a second request leaves the pass pending", async () => {
    const a = await createAttendee();
    await prisma.walletPass.create({ data: { attendee_id: a.id, status: "active", provider_pass_id: `pc-${a.id}` } });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => (started = resolve));
    const fetchMock = vi.fn(async (_url: unknown) => {
      started();
      await gate;
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = post(erasePath(EVENT_ID, a.id));
    await startedPromise;
    const second = await post(erasePath(EVENT_ID, a.id));
    expect(await second.json()).toMatchObject({ already_erased: 1, wallet_pending: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release();
    expect(await (await first).json()).toMatchObject({ erased: 1, wallet_pending: 0 });
  });

  it.each([
    ["no ids", { attendeeIds: [] }],
    ["an unknown field", { attendeeIds: ["x"], force: true }],
    ["an id that is too long", { attendeeIds: ["x".repeat(129)] }],
  ])("rejects %s", async (_name, body) => {
    const res = await post(bulkPath(EVENT_ID), body);
    expect(res.status).toBe(400);
  });
});

describe("a request without an event id in its path", () => {
  it("is answered 400 by both handlers before anything is looked up", async () => {
    const c = {
      req: { param: () => undefined },
      json: (body: unknown, status: number) => new Response(JSON.stringify(body), { status }),
    } as unknown as Context;

    expect((await handleEraseEventAttendee(c, prisma)).status).toBe(400);
    expect((await handleBulkEraseEventAttendees(c, prisma)).status).toBe(400);
  });
});
