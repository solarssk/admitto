/**
 * POST …/attendees/:id/erase and …/attendees/bulk-erase: the person is anonymised in place, the
 * audit trail holds ids and counts only, a wallet pass is deleted at the provider afterwards (and
 * tried again when the same request is repeated), copies in saved import results are blanked, and
 * it works on an archived event.
 *
 * POST …/attendees/:id/remove and …/attendees/bulk-remove (at the end): the person is deleted for
 * good, with a reason from a fixed list, the audit trail holds the reason, ids and counts only, and
 * it is refused on an archived event.
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
import { handleBulkRemoveEventAttendees, handleRemoveEventAttendee } from "../../src/admin/attendee-remove-routes.js";
import { ATTENDEE_REMOVAL_REASONS } from "@admitto/shared";
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
    expect(await res.json()).toEqual({ erased: 1, already_erased: 0, not_found: 0, wallet_pending: 0, wallet_removed_ids: [] });
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

    expect(await again.json()).toEqual({ erased: 0, already_erased: 1, not_found: 0, wallet_pending: 0, wallet_removed_ids: [] });
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

  it("answers 403, not a server error, for an event that does not exist (a superadmin passes the access check for it)", async () => {
    const single = await post(erasePath("evt-erase-api-missing", "erase-api-att-none"));
    const bulk = await post(bulkPath("evt-erase-api-missing"), { attendeeIds: ["erase-api-att-none"] });

    expect(single.status).toBe(403);
    expect(await single.json()).toEqual({ error: "forbidden" });
    expect(bulk.status).toBe(403);
    expect(await bulk.json()).toEqual({ error: "forbidden" });
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

    expect(await res.json()).toMatchObject({ erased: 1, wallet_pending: 0, wallet_removed_ids: [a.id] });
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

    expect(await first.json()).toMatchObject({ erased: 1, wallet_pending: 1, wallet_removed_ids: [] });
    expect((await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: a.id } })).provider_removed_at).toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const retry = await post(erasePath(EVENT_ID, a.id));

    expect(await retry.json()).toEqual({ erased: 0, already_erased: 1, not_found: 0, wallet_pending: 0, wallet_removed_ids: [a.id] });
    expect((await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: a.id } })).provider_removed_at).not.toBeNull();
  });

  it("is deleted when the credentials are there although the event's Wallet switch is off", async () => {
    const a = await createAttendee(WALLET_OFF_EVENT_ID);
    await prisma.walletPass.create({ data: { attendee_id: a.id, status: "active", provider_pass_id: `pc-${a.id}` } });
    const fetchMock = vi.fn(async (_url: unknown) => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await post(erasePath(WALLET_OFF_EVENT_ID, a.id));

    expect(await res.json()).toMatchObject({ erased: 1, wallet_pending: 0, wallet_removed_ids: [a.id] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stays pending, without calling anyone, when the event has no wallet credentials", async () => {
    const a = await createAttendee(ARCHIVED_EVENT_ID);
    await prisma.walletPass.create({ data: { attendee_id: a.id, status: "active", provider_pass_id: `pc-${a.id}` } });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await post(erasePath(ARCHIVED_EVENT_ID, a.id));

    expect(await res.json()).toMatchObject({ erased: 1, wallet_pending: 1, wallet_removed_ids: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not report a pass that never reached the provider as removed now", async () => {
    const a = await createAttendee();
    await prisma.walletPass.create({ data: { attendee_id: a.id, status: "active", provider_pass_id: null } });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await post(erasePath(EVENT_ID, a.id));

    expect(await res.json()).toMatchObject({ erased: 1, wallet_pending: 0, wallet_removed_ids: [] });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: a.id } })).provider_removed_at).toBeNull();
  });

  it("does not report a pass that was removed before as removed now, and keeps the date it was removed", async () => {
    const a = await createAttendee();
    const removedBefore = new Date("2026-09-01T10:00:00.000Z");
    await prisma.walletPass.create({
      data: { attendee_id: a.id, status: "active", provider_pass_id: `pc-${a.id}`, provider_removed_at: removedBefore },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await post(erasePath(EVENT_ID, a.id));

    expect(await res.json()).toMatchObject({ erased: 1, wallet_pending: 0, wallet_removed_ids: [] });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await prisma.walletPass.findUniqueOrThrow({ where: { attendee_id: a.id } })).provider_removed_at).toEqual(removedBefore);
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
    expect(await first.json()).toMatchObject({ erased: 2, wallet_pending: 1, wallet_removed_ids: [b.id] });

    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const retry = await post(bulkPath(EVENT_ID), { attendeeIds: [a.id, b.id] });
    expect(await retry.json()).toMatchObject({ erased: 0, already_erased: 2, wallet_pending: 0, wallet_removed_ids: [a.id] });
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

    expect(await res.json()).toEqual({ erased: 2, already_erased: 1, not_found: 1, wallet_pending: 0, wallet_removed_ids: [] });
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

    expect(await res.json()).toEqual({ erased: 0, already_erased: 0, not_found: 2, wallet_pending: 0, wallet_removed_ids: [] });
    expect(await prisma.attendeeActionLog.count({ where: { event_id: EVENT_ID, action_type: "attendees_bulk_erased" } })).toBe(before);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still answers, with the pass pending, when the provider follow-up itself breaks", async () => {
    const a = await createAttendee();
    await prisma.walletPass.create({ data: { attendee_id: a.id, status: "active", provider_pass_id: `pc-${a.id}` } });
    // The first read of the passes is the snapshot taken before the follow-up, the second is the follow-up's own.
    const realFindMany = prisma.walletPass.findMany.bind(prisma.walletPass);
    let reads = 0;
    vi.spyOn(prisma.walletPass, "findMany").mockImplementation(((args: Parameters<typeof realFindMany>[0]) => {
      reads += 1;
      return reads === 2 ? Promise.reject(new Error("db hiccup")) : realFindMany(args);
    }) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post(erasePath(EVENT_ID, a.id));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ erased: 1, wallet_pending: 1, wallet_removed_ids: [] });
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
    expect(await second.json()).toMatchObject({ already_erased: 1, wallet_pending: 1, wallet_removed_ids: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release();
    expect(await (await first).json()).toMatchObject({ erased: 1, wallet_pending: 0, wallet_removed_ids: [a.id] });
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

describe("the request budget of a single erasure", () => {
  // An id that is no attendee of the event: the answer is a 403, and what is counted is the request.
  const ghost = "erase-api-att-none";
  const refreshStatus = (eventId: string) => post(`/api/admin/events/${eventId}/attendees/${ghost}/wallet/refresh-status`);

  it("spends the wallet-action budget (10 a minute) when the event has wallet credentials, like every other single-attendee wallet action", async () => {
    for (let i = 0; i < 10; i += 1) {
      expect((await post(erasePath(EVENT_ID, ghost))).status).not.toBe(429);
    }

    expect((await post(erasePath(EVENT_ID, ghost))).status).toBe(429);
  });

  it("shares that budget with the other single-attendee wallet actions", async () => {
    for (let i = 0; i < 5; i += 1) await post(erasePath(EVENT_ID, ghost));
    for (let i = 0; i < 5; i += 1) {
      expect((await refreshStatus(EVENT_ID)).status).not.toBe(429);
    }

    expect((await post(erasePath(EVENT_ID, ghost))).status).toBe(429);
    expect((await refreshStatus(EVENT_ID)).status).toBe(429);
  });

  it("does not spend it on an event without wallet credentials, where no provider can be called", async () => {
    for (let i = 0; i < 12; i += 1) {
      expect((await post(erasePath(ARCHIVED_EVENT_ID, ghost))).status).not.toBe(429);
    }
  });
});

describe("a request without an event id in its path", () => {
  const withoutEventId = {
    req: { param: () => undefined },
    json: (body: unknown, status: number) => new Response(JSON.stringify(body), { status }),
  } as unknown as Context;

  it("is answered 400 by both erase handlers before anything is looked up", async () => {
    expect((await handleEraseEventAttendee(withoutEventId, prisma)).status).toBe(400);
    expect((await handleBulkEraseEventAttendees(withoutEventId, prisma)).status).toBe(400);
  });

  it("is answered 400 by both remove handlers before anything is looked up", async () => {
    expect((await handleRemoveEventAttendee(withoutEventId, prisma)).status).toBe(400);
    expect((await handleBulkRemoveEventAttendees(withoutEventId, prisma)).status).toBe(400);
  });
});

describe("removing attendees from an event", () => {
  const removePath = (eventId: string, attendeeId: string) => `/api/admin/events/${eventId}/attendees/${attendeeId}/remove`;
  const bulkRemovePath = (eventId: string) => `/api/admin/events/${eventId}/attendees/bulk-remove`;
  const REASON = "duplicate";

  /** A session of a user created on first use, with the role and MFA a test needs. */
  async function cookieOf(email: string, password: string, setup: (userId: string) => Promise<void>): Promise<string> {
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({ data: { email, password_hash: await hashPassword(password) } });
      await setup(user.id);
    }
    const session = await createSession(prisma, { userId: user.id, stage: SESSION_STAGE.FULL });
    return `admitto_session=${session.rawToken}`;
  }
  const operatorCookie = () =>
    cookieOf("erase-api-operator@example.com", "erase-api-operator-pass-123", async (userId) => {
      await prisma.roleAssignment.create({ data: { user_id: userId, role: "operator", scope_type: "event", scope_id: EVENT_ID } });
    });
  const otherAdminCookie = () =>
    cookieOf(OTHER_ADMIN_EMAIL, "erase-api-other-admin-pass-123", async (userId) => {
      await prisma.roleAssignment.create({ data: { user_id: userId, role: "admin", scope_type: "organization", scope_id: OTHER_ORG_ID } });
      await prisma.userMfaMethod.create({
        data: { user_id: userId, type: "totp", secret_enc: encryptTotpSecret(generateTotpSecret()), confirmed_at: new Date() },
      });
    });
  const postAs = (as: string, path: string, body: unknown) =>
    app.request(path, { method: "POST", headers: { Cookie: as, ...sameOrigin, "Content-Type": "application/json" }, body: JSON.stringify(body) });

  async function withDependents(eventId = EVENT_ID, extra: Record<string, unknown> = {}) {
    const a = await createAttendee(eventId, extra);
    await prisma.emailDelivery.create({
      data: {
        organization_id: ORG_ID,
        event_id: eventId,
        attendee_id: a.id,
        purpose: "initial",
        provider: "smtp",
        status: "sent",
        recipient_email: a.email,
        rendered_subject: "Your ticket",
        rendered_html: "<p>ticket</p>",
      },
    });
    await prisma.checkIn.create({ data: { attendee_id: a.id, event_id: eventId, status: "VALID" } });
    await prisma.attendeeNote.create({ data: { attendee_id: a.id, event_id: eventId, author_user_id: "staff-1", body: "note" } });
    return a;
  }
  const gone = async (attendeeId: string) =>
    (await prisma.attendee.count({ where: { id: attendeeId } })) +
    (await prisma.emailDelivery.count({ where: { attendee_id: attendeeId } })) +
    (await prisma.checkIn.count({ where: { attendee_id: attendeeId } })) +
    (await prisma.attendeeNote.count({ where: { attendee_id: attendeeId } })) === 0;

  it("removes the attendee with their deliveries, check-ins and notes, and answers with counts", async () => {
    const a = await withDependents();
    const keep = await withDependents();

    const res = await post(removePath(EVENT_ID, a.id), { reason: REASON });

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ removed: 1, not_found: 0 });
    expect(await gone(a.id)).toBe(true);
    expect(await gone(keep.id)).toBe(false);
  });

  it("writes the reason, the id and counts to both audit logs, and no name or address", async () => {
    const a = await withDependents();
    await post(removePath(EVENT_ID, a.id), { reason: "test_person" });

    const eventLog = await prisma.attendeeActionLog.findFirstOrThrow({
      where: { event_id: EVENT_ID, action_type: "attendee_erased", attendee_id: null },
      orderBy: { created_at: "desc" },
    });
    const central = await prisma.adminAuditLog.findFirstOrThrow({
      where: { action_type: "attendee_erased", organization_id: ORG_ID },
      orderBy: { created_at: "desc" },
    });
    expect(eventLog.metadata).toMatchObject({ attendee_id: a.id, method: "remove", reason: "test_person", removed: { emailDeliveries: 1, checkIns: 1 } });
    expect(central.metadata).toMatchObject({ attendee_id: a.id, method: "remove", reason: "test_person", event_id: EVENT_ID });
    for (const metadata of [eventLog.metadata, central.metadata]) {
      const text = JSON.stringify(metadata).toLowerCase();
      expect(text).not.toContain(a.name.toLowerCase());
      expect(text).not.toContain("example.com");
    }
  });

  it.each(ATTENDEE_REMOVAL_REASONS)("accepts the reason %s", async (reason) => {
    const a = await createAttendee();
    const res = await post(removePath(EVENT_ID, a.id), { reason });
    expect(res.status).toBe(200);
    expect(await prisma.attendee.count({ where: { id: a.id } })).toBe(0);
  });

  it.each([
    ["no reason", {}],
    ["a reason that is not on the list", { reason: "because" }],
    ["the label instead of the code", { reason: "Duplicate entry" }],
    ["a free-text note", { reason: REASON, note: "same person as someone else" }],
    ["a reason that is not a string", { reason: 7 }],
  ])("rejects %s with 400 and removes nothing", async (_name, body) => {
    const a = await createAttendee();
    const single = await post(removePath(EVENT_ID, a.id), body);
    const bulk = await post(bulkRemovePath(EVENT_ID), { attendeeIds: [a.id], ...body });

    expect(single.status).toBe(400);
    expect(await single.json()).toEqual({ error: "validation_failed" });
    expect(bulk.status).toBe(400);
    expect(await prisma.attendee.count({ where: { id: a.id } })).toBe(1);
  });

  it("rejects a grossly oversized body with 400 before it is read", async () => {
    const a = await createAttendee();
    const oversized = { reason: REASON, padding: "x".repeat(600 * 1024) };

    const single = await post(removePath(EVENT_ID, a.id), oversized);
    const bulk = await post(bulkRemovePath(EVENT_ID), { attendeeIds: [a.id], ...oversized });

    expect(single.status).toBe(400);
    expect(await single.json()).toEqual({ error: "request too large" });
    expect(bulk.status).toBe(400);
    expect(await prisma.attendee.count({ where: { id: a.id } })).toBe(1);
  });

  it("rejects a body that is not JSON with 400", async () => {
    const a = await createAttendee();
    const res = await app.request(removePath(EVENT_ID, a.id), {
      method: "POST",
      headers: { Cookie: cookie, ...sameOrigin, "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect(await prisma.attendee.count({ where: { id: a.id } })).toBe(1);
  });

  it("is refused on an archived event, which is final, and removes nothing", async () => {
    const a = await withDependents(ARCHIVED_EVENT_ID);

    const single = await post(removePath(ARCHIVED_EVENT_ID, a.id), { reason: REASON });
    const bulk = await post(bulkRemovePath(ARCHIVED_EVENT_ID), { attendeeIds: [a.id], reason: REASON });

    expect(single.status).toBe(403);
    expect(await single.json()).toEqual({ code: "event_archived" });
    expect(bulk.status).toBe(403);
    expect(await bulk.json()).toEqual({ code: "event_archived" });
    expect(await gone(a.id)).toBe(false);
  });

  it("removes someone who was erased before: the anonymous entry goes too", async () => {
    const a = await withDependents();
    await post(erasePath(EVENT_ID, a.id));

    const res = await post(removePath(EVENT_ID, a.id), { reason: "other" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: 1, not_found: 0 });
    expect(await prisma.attendee.count({ where: { id: a.id } })).toBe(0);
  });

  it("blanks the address in a saved import result and in the creation entry of the central audit log", async () => {
    const a = await createAttendee(EVENT_ID, { email: "  Remove.Copy@Example.COM " });
    const job = await prisma.adminJob.create({
      data: {
        type: "import_commit",
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        result_json: { skipped: [{ email: "remove.copy@example.com", reason: "Duplicate email" }] },
      },
    });
    const created = await prisma.adminAuditLog.create({
      data: {
        organization_id: ORG_ID,
        actor_user_id: "staff-1",
        action_type: "attendee_created_manual",
        metadata: { event_id: EVENT_ID, attendee_id: a.id, attendee_name: a.name, attendee_email: a.email },
      },
    });

    await post(removePath(EVENT_ID, a.id), { reason: "wrong_import" });

    expect(JSON.stringify((await prisma.adminJob.findUniqueOrThrow({ where: { id: job.id } })).result_json).toLowerCase()).not.toContain("remove.copy");
    expect((await prisma.adminAuditLog.findUniqueOrThrow({ where: { id: created.id } })).metadata).toEqual({ event_id: EVENT_ID, attendee_id: a.id });
  });

  it("answers 403 for an attendee of another event and leaves them alone", async () => {
    const a = await createAttendee(WALLET_OFF_EVENT_ID);
    const res = await post(removePath(EVENT_ID, a.id), { reason: REASON });
    expect(res.status).toBe(403);
    expect(await prisma.attendee.count({ where: { id: a.id } })).toBe(1);
  });

  it("answers 403, not a server error, for an event that does not exist (a superadmin passes the access check for it)", async () => {
    const single = await post(removePath("evt-erase-api-missing", "erase-api-att-none"), { reason: REASON });
    const bulk = await post(bulkRemovePath("evt-erase-api-missing"), { attendeeIds: ["erase-api-att-none"], reason: REASON });

    expect(single.status).toBe(403);
    expect(bulk.status).toBe(403);
  });

  it("is refused for a door operator, an administrator of another organisation, and without a session", async () => {
    const a = await createAttendee();
    const operator = await operatorCookie();
    const otherAdmin = await otherAdminCookie();

    for (const as of [operator, otherAdmin]) {
      expect((await postAs(as, removePath(EVENT_ID, a.id), { reason: REASON })).status).toBe(403);
      expect((await postAs(as, bulkRemovePath(EVENT_ID), { attendeeIds: [a.id], reason: REASON })).status).toBe(403);
    }
    const anonymous = await app.request(removePath(EVENT_ID, a.id), {
      method: "POST",
      headers: { ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ reason: REASON }),
    });
    expect([401, 403]).toContain(anonymous.status);
    expect(await prisma.attendee.count({ where: { id: a.id } })).toBe(1);
  });

  it("deletes the wallet pass at the provider first", async () => {
    const a = await createAttendee();
    await prisma.walletPass.create({ data: { attendee_id: a.id, status: "active", provider_pass_id: `pc-${a.id}` } });
    const fetchMock = vi.fn(async (_url: unknown) => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await post(removePath(EVENT_ID, a.id), { reason: REASON });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`pc-${a.id}`);
    expect(await prisma.walletPass.count({ where: { attendee_id: a.id } })).toBe(0);
  });

  it("removes the attendee although the provider cannot be reached, and says so in the system log", async () => {
    const a = await createAttendee();
    await prisma.walletPass.create({ data: { attendee_id: a.id, status: "active", provider_pass_id: `pc-${a.id}` } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 500 })));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post(removePath(EVENT_ID, a.id), { reason: REASON });

    expect(res.status).toBe(200);
    expect(await prisma.attendee.count({ where: { id: a.id } })).toBe(0);
    expect(errSpy).toHaveBeenCalled();
  });

  it("removes a selection: the ones that exist, counts the rest, and audits the ids once", async () => {
    const a = await withDependents();
    const b = await withDependents();
    const other = await createAttendee(WALLET_OFF_EVENT_ID);

    const res = await post(bulkRemovePath(EVENT_ID), { attendeeIds: [a.id, b.id, other.id, "nobody", a.id], reason: "added_by_mistake" });

    expect(await res.json()).toEqual({ removed: 2, not_found: 2 });
    expect(await gone(a.id)).toBe(true);
    expect(await gone(b.id)).toBe(true);
    expect(await prisma.attendee.count({ where: { id: other.id } })).toBe(1);
    const log = await prisma.attendeeActionLog.findFirstOrThrow({
      where: { event_id: EVENT_ID, action_type: "attendees_bulk_erased" },
      orderBy: { created_at: "desc" },
    });
    expect(log.metadata).toMatchObject({ count: 2, method: "remove", reason: "added_by_mistake", removed: { emailDeliveries: 2, checkIns: 2 } });
    expect((log.metadata as { attendee_ids: string[] }).attendee_ids.sort()).toEqual([a.id, b.id].sort());
    const text = JSON.stringify(log.metadata).toLowerCase();
    expect(text).not.toContain("example.com");
  });

  it("only unknown ids: nothing is removed, nothing is audited, no provider is called", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const before = await prisma.attendeeActionLog.count({ where: { event_id: EVENT_ID, action_type: "attendees_bulk_erased" } });

    const res = await post(bulkRemovePath(EVENT_ID), { attendeeIds: ["nobody-1", "nobody-2"], reason: REASON });

    expect(await res.json()).toEqual({ removed: 0, not_found: 2 });
    expect(await prisma.attendeeActionLog.count({ where: { event_id: EVENT_ID, action_type: "attendees_bulk_erased" } })).toBe(before);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses more than 100 attendees at once when the event has wallet credentials, and an empty or too long list", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `nobody-${i}`);
    expect((await post(bulkRemovePath(EVENT_ID), { attendeeIds: ids, reason: REASON })).status).toBe(400);
    expect((await post(bulkRemovePath(EVENT_ID), { attendeeIds: [], reason: REASON })).status).toBe(400);
    expect((await post(bulkRemovePath(EVENT_ID), { attendeeIds: ["x".repeat(129)], reason: REASON })).status).toBe(400);
  });

  it("two overlapping requests for the same people remove each of them once", async () => {
    const a = await createAttendee();
    const b = await createAttendee();

    const [first, second] = await Promise.all([
      post(bulkRemovePath(EVENT_ID), { attendeeIds: [a.id, b.id], reason: REASON }),
      post(bulkRemovePath(EVENT_ID), { attendeeIds: [b.id, a.id], reason: REASON }),
    ]);
    const bodies = [(await first.json()) as { removed: number; not_found: number }, (await second.json()) as { removed: number; not_found: number }];

    expect(bodies[0]!.removed + bodies[1]!.removed).toBe(2);
    expect(bodies[0]!.not_found + bodies[1]!.not_found).toBe(2);
  });
});

describe("an address the person had before it was edited", () => {
  const removePath = (eventId: string, attendeeId: string) => `/api/admin/events/${eventId}/attendees/${attendeeId}/remove`;
  let runs = 0;

  const deliveryTo = (attendeeId: string, recipient: string, status: string, purpose = "initial") =>
    prisma.emailDelivery.create({
      data: {
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        attendee_id: attendeeId,
        purpose,
        provider: "smtp",
        status,
        recipient_email: recipient,
        rendered_subject: "Your ticket",
        rendered_html: "<p>ticket</p>",
      },
    });
  const importResultNaming = (addresses: string[]) =>
    prisma.adminJob.create({
      data: {
        type: "import_commit",
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        result_json: { skipped: addresses.map((email) => ({ email, reason: "Duplicate email" })) },
      },
    });
  const savedResult = async (jobId: string) =>
    JSON.stringify((await prisma.adminJob.findUniqueOrThrow({ where: { id: jobId } })).result_json).toLowerCase();
  const deliveryNow = (id: string) => prisma.emailDelivery.findUniqueOrThrow({ where: { id } });

  const actions = [
    { name: "erasing", act: (id: string) => post(erasePath(EVENT_ID, id)) },
    { name: "removing", act: (id: string) => post(removePath(EVENT_ID, id), { reason: "duplicate" }) },
  ];

  it.each(actions)("$name them scrubs the address their first ticket mail went to, from resent mail and saved import results", async ({ act }) => {
    const n = ++runs;
    const old = `typo.address.${n}@example.com`;
    const person = await createAttendee(EVENT_ID, { email: `right.address.${n}@example.com` });
    const other = await createAttendee();
    await deliveryTo(person.id, old, "sent");
    const resent = await deliveryTo(other.id, old.toUpperCase(), "queued", "resend");
    const job = await importResultNaming([old, `unrelated.address.${n}@example.com`]);

    expect((await act(person.id)).status).toBe(200);

    expect(await deliveryNow(resent.id)).toMatchObject({ recipient_email: null, status: "cancelled", retryable: false });
    const saved = await savedResult(job.id);
    expect(saved).not.toContain(old);
    expect(saved).toContain(`unrelated.address.${n}@example.com`);
  });

  it.each(actions)("$name them leaves alone an address another attendee holds now", async ({ act }) => {
    const n = ++runs;
    const held = `held.by.someone.else.${n}@example.com`;
    const person = await createAttendee();
    // Holds it now, with no first mail of their own to it: only the profile says it is theirs.
    await createAttendee(EVENT_ID, { email: held });
    const other = await createAttendee();
    await deliveryTo(person.id, held, "sent");
    const theirs = await deliveryTo(other.id, held, "queued", "resend");
    const job = await importResultNaming([held]);

    expect((await act(person.id)).status).toBe(200);

    expect(await deliveryNow(theirs.id)).toMatchObject({ recipient_email: held, status: "queued" });
    expect(await savedResult(job.id)).toContain(held);
  });

  it.each(actions)("$name them leaves alone an address the first mail of another attendee went to as well", async ({ act }) => {
    const n = ++runs;
    const shared = `shared.before.${n}@example.com`;
    const person = await createAttendee();
    const other = await createAttendee();
    await deliveryTo(person.id, shared, "sent");
    const theirs = await deliveryTo(other.id, shared, "queued");
    const job = await importResultNaming([shared]);

    expect((await act(person.id)).status).toBe(200);

    expect(await deliveryNow(theirs.id)).toMatchObject({ recipient_email: shared, status: "queued" });
    expect(await savedResult(job.id)).toContain(shared);
  });

  it.each(actions)("$name them does not take an address that staff typed into a resend for theirs", async ({ act }) => {
    const n = ++runs;
    const manager = `manager.mailbox.${n}@example.com`;
    const person = await createAttendee();
    const other = await createAttendee();
    await deliveryTo(person.id, person.email, "sent");
    await deliveryTo(person.id, manager, "sent", "resend");
    const theirs = await deliveryTo(other.id, manager, "queued", "resend");
    const job = await importResultNaming([manager]);

    expect((await act(person.id)).status).toBe(200);

    expect(await deliveryNow(theirs.id)).toMatchObject({ recipient_email: manager, status: "queued" });
    expect(await savedResult(job.id)).toContain(manager);
  });
});
