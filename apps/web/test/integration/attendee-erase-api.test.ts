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
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { deleteProviderPassesBestEffort } from "../../src/admin/attendees-api-routes.js";
import { ATTENDEE_REMOVAL_REASONS } from "@admitto/shared";
import { drainExportJobs, EXPORT_STOPPED_BY_ERASURE_ERROR, IMPORT_STOPPED_BY_ERASURE_ERROR, stopOpenAttendeeJobs } from "@admitto/tickets";
import { drainImportJobs } from "@admitto/import";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { getDefaultStorage, resetDefaultStorageForTests } from "@admitto/storage";
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
    // The person's own activity log goes with them: it is not an audit entry of the removal (those have no attendee id).
    await prisma.attendeeActionLog.create({
      data: { event_id: eventId, attendee_id: a.id, action_type: "test_existing_attendee_log", actor_user_id: "staff-1" },
    });
    return a;
  }
  const gone = async (attendeeId: string) =>
    (await prisma.attendee.count({ where: { id: attendeeId } })) +
    (await prisma.emailDelivery.count({ where: { attendee_id: attendeeId } })) +
    (await prisma.checkIn.count({ where: { attendee_id: attendeeId } })) +
    (await prisma.attendeeNote.count({ where: { attendee_id: attendeeId } })) +
    (await prisma.attendeeActionLog.count({ where: { attendee_id: attendeeId } })) === 0;

  it("removes the attendee with their deliveries, check-ins, notes and activity log, and answers with counts", async () => {
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

  it("deletes at the provider, after the commit, a pass that was saved after the first delete had read the passes", async () => {
    const a = await createAttendee();
    const b = await createAttendee();
    await prisma.walletPass.create({ data: { attendee_id: a.id, status: "active", provider_pass_id: `pc-${a.id}` } });
    // B has no pass when the removal starts. One that an Add to Wallet request was still creating
    // is saved while A's pass is being deleted, which is after the first delete read the passes.
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes(`pc-${a.id}`)) {
        await prisma.walletPass.create({ data: { attendee_id: b.id, status: "active", provider_pass_id: `pc-${b.id}` } });
      }
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await post(bulkRemovePath(EVENT_ID), { attendeeIds: [a.id, b.id], reason: REASON });

    expect(await res.json()).toEqual({ removed: 2, not_found: 0 });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining(`pc-${a.id}`),
      expect.stringContaining(`pc-${b.id}`),
    ]);
    expect(await prisma.walletPass.count({ where: { attendee_id: { in: [a.id, b.id] } } })).toBe(0);
  });

  it("does not call the provider for a pass that was deleted there before", async () => {
    const a = await createAttendee();
    await prisma.walletPass.create({
      data: { attendee_id: a.id, status: "active", provider_pass_id: `pc-${a.id}`, provider_removed_at: new Date() },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await post(removePath(EVENT_ID, a.id), { reason: REASON });

    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.walletPass.count({ where: { attendee_id: a.id } })).toBe(0);
  });

  it("tries a pass again after the commit when the first delete could not delete it", async () => {
    const a = await createAttendee();
    await prisma.walletPass.create({ data: { attendee_id: a.id, status: "active", provider_pass_id: `pc-${a.id}` } });
    const fetchMock = vi.fn(async (_url: unknown) =>
      fetchMock.mock.calls.length === 1 ? new Response("down", { status: 500 }) : new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post(removePath(EVENT_ID, a.id), { reason: REASON });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(errSpy).toHaveBeenCalled();
    expect(await prisma.attendee.count({ where: { id: a.id } })).toBe(0);
  });

  it("still answers, and logs the pass that is left, when the clean-up after the commit itself breaks", async () => {
    const a = await createAttendee();
    await prisma.walletPass.create({ data: { attendee_id: a.id, status: "active", provider_pass_id: `pc-${a.id}` } });
    // The first delete fails, so the pass is left for the clean-up, whose read of the event's
    // credentials (the one that happens once the attendee is gone) then breaks.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 500 })));
    const realFindUnique = prisma.event.findUnique.bind(prisma.event);
    let brokenReads = 0;
    vi.spyOn(prisma.event, "findUnique").mockImplementation(((args: Parameters<typeof realFindUnique>[0]) => {
      if (!args?.select || !("wallet_api_key_enc" in args.select)) return realFindUnique(args);
      return prisma.attendee.count({ where: { id: a.id } }).then((still) => {
        if (still > 0) return realFindUnique(args);
        brokenReads += 1;
        return Promise.reject(new Error("db hiccup"));
      });
    }) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post(removePath(EVENT_ID, a.id), { reason: REASON });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: 1, not_found: 0 });
    expect(await prisma.attendee.count({ where: { id: a.id } })).toBe(0);
    expect(brokenReads).toBe(1);
    expect(errSpy).toHaveBeenCalled();
    // One entry for the first delete that failed, one for the clean-up that broke.
    const logged = querySystemLogs({ source: "admin" }).filter(
      (entry) => entry.message === "wallet_pass_erasure_delete_failed" && entry.fields?.attendeeId === a.id,
    );
    expect(logged).toHaveLength(2);
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

describe("deleting wallet passes at the provider", () => {
  const targets = [
    { attendeeId: "gone-a", providerPassId: "pc-gone-a" },
    { attendeeId: "gone-b", providerPassId: "pc-gone-b" },
  ];

  it("answers the provider ids it deleted, and leaves out the ones that failed", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) =>
      String(url).includes("pc-gone-b") ? new Response("down", { status: 500 }) : new Response(null, { status: 200 }),
    ));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const deleted = await deleteProviderPassesBestEffort(prisma, EVENT_ID, targets);

    expect(deleted).toEqual(new Set(["pc-gone-a"]));
    expect(errSpy).toHaveBeenCalled();
  });

  it("calls nobody for an event that does not exist, or one without wallet credentials, and for nothing to delete", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await deleteProviderPassesBestEffort(prisma, "evt-nobody", targets)).toEqual(new Set());
    expect(await deleteProviderPassesBestEffort(prisma, ARCHIVED_EVENT_ID, targets)).toEqual(new Set());
    expect(await deleteProviderPassesBestEffort(prisma, EVENT_ID, [])).toEqual(new Set());
    expect(fetchMock).not.toHaveBeenCalled();
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

describe("the request budget of a single removal", () => {
  // An id that is no attendee of the event: the answer is a 403, and what is counted is the request.
  const ghost = "erase-api-att-none";
  const remove = (eventId: string) => post(`/api/admin/events/${eventId}/attendees/${ghost}/remove`, { reason: "duplicate" });
  const refreshStatus = (eventId: string) => post(`/api/admin/events/${eventId}/attendees/${ghost}/wallet/refresh-status`);

  it("spends the wallet-action budget (10 a minute) when the event has wallet credentials, like every other single-attendee wallet action", async () => {
    for (let i = 0; i < 10; i += 1) {
      expect((await remove(EVENT_ID)).status).not.toBe(429);
    }

    expect((await remove(EVENT_ID)).status).toBe(429);
  });

  it("shares that budget with the other single-attendee wallet actions", async () => {
    for (let i = 0; i < 5; i += 1) await remove(EVENT_ID);
    for (let i = 0; i < 5; i += 1) {
      expect((await refreshStatus(EVENT_ID)).status).not.toBe(429);
    }

    expect((await remove(EVENT_ID)).status).toBe(429);
    expect((await refreshStatus(EVENT_ID)).status).toBe(429);
  });

  it("does not spend it on an event without wallet credentials, where no provider can be called", async () => {
    for (let i = 0; i < 12; i += 1) {
      expect((await remove(ARCHIVED_EVENT_ID)).status).not.toBe(429);
    }
  });
});

describe("export files of the event, after an erasure or a removal", () => {
  let uploadDir: string;
  let savedUploadDir: string | undefined;
  const jobIds: string[] = [];

  beforeAll(() => {
    savedUploadDir = process.env.UPLOAD_DIR;
    uploadDir = mkdtempSync(join(tmpdir(), "admitto-erase-exports-"));
    process.env.UPLOAD_DIR = uploadDir;
    resetDefaultStorageForTests();
  });

  afterAll(async () => {
    await prisma.adminJob.deleteMany({ where: { id: { in: jobIds } } });
    rmSync(uploadDir, { recursive: true, force: true });
    if (savedUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = savedUploadDir;
    resetDefaultStorageForTests();
  });

  beforeEach(() => resetSystemLogBufferForTest());

  const removePath = (eventId: string, attendeeId: string) => `/api/admin/events/${eventId}/attendees/${attendeeId}/remove`;
  const bulkRemovePath = (eventId: string) => `/api/admin/events/${eventId}/attendees/bulk-remove`;

  /** A finished job of `type` whose file is in storage, as an export or an import job leaves it. */
  async function seedJobFile(eventId: string, type = "export", finished = true) {
    const { key } = await getDefaultStorage().put(Buffer.from("name,email\nA B,a@example.com\n"), {
      orgId: ORG_ID,
      eventId,
      scope: "event",
      ext: ".csv",
    });
    const job = await prisma.adminJob.create({
      data: {
        type,
        status: finished ? "succeeded" : "pending",
        organization_id: ORG_ID,
        event_id: eventId,
        storage_key: key,
        filename: "attendees.csv",
        finished_at: finished ? new Date() : null,
      },
    });
    jobIds.push(job.id);
    return { jobId: job.id, key };
  }
  const present = (key: string) => existsSync(join(uploadDir, key));
  const keyOf = async (jobId: string) => (await prisma.adminJob.findUniqueOrThrow({ where: { id: jobId } })).storage_key;

  it("erasing someone deletes the export files and the staged CSV of every import of the event that is finished or was waiting, clears their keys, and leaves another event's files", async () => {
    const a = await createAttendee();
    const first = await seedJobFile(EVENT_ID);
    const second = await seedJobFile(EVENT_ID);
    const otherEvent = await seedJobFile(WALLET_OFF_EVENT_ID);
    const failedImport = await seedJobFile(EVENT_ID, "import_commit");
    const waitingImport = await seedJobFile(EVENT_ID, "import_commit", false);
    const otherEventImport = await seedJobFile(WALLET_OFF_EVENT_ID, "import_commit");
    const otherEventWaitingImport = await seedJobFile(WALLET_OFF_EVENT_ID, "import_commit", false);

    try {
      const res = await post(erasePath(EVENT_ID, a.id));

      expect(res.status).toBe(200);
      // The import that was waiting is stopped by the erasure (its job is finished then), and its file goes with it.
      for (const gone of [first, second, failedImport, waitingImport]) {
        expect(present(gone.key)).toBe(false);
        expect(await keyOf(gone.jobId)).toBeNull();
      }
      for (const kept of [otherEvent, otherEventImport, otherEventWaitingImport]) {
        expect(present(kept.key)).toBe(true);
        expect(await keyOf(kept.jobId)).toBe(kept.key);
      }
    } finally {
      // Not left in the queue for the next test's worker to pick up, whatever happened above.
      await prisma.adminJob.delete({ where: { id: otherEventWaitingImport.jobId } });
    }
  });

  it.each([
    ["erasing", (attendeeId: string) => post(erasePath(EVENT_ID, attendeeId))],
    ["removing", (attendeeId: string) => post(`/api/admin/events/${EVENT_ID}/attendees/${attendeeId}/remove`, { reason: "duplicate" })],
  ])("%s someone while an export is running stops that export, and the file it was building does not survive", async (_name, act) => {
    const a = await createAttendee();
    const { id: jobId } = await prisma.adminJob.create({
      data: {
        type: "export",
        status: "pending",
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        result_json: { request: { kind: "attendees_filtered", format: "csv", filters: { q: "Erase Api" } } },
      },
    });
    jobIds.push(jobId);
    // The export has read its rows (this person is in them) and stored its file when the erasure commits.
    const real = getDefaultStorage();
    const stored: string[] = [];
    const storage = {
      put: async (bytes: Buffer, opts: Parameters<typeof real.put>[1]) => {
        const staged = await real.put(bytes, opts);
        if (opts.eventId === EVENT_ID) {
          stored.push(staged.key);
          expect((await act(a.id)).status).toBe(200);
        }
        return staged;
      },
      delete: (key: string) => real.delete(key),
    };

    await drainExportJobs(prisma, storage as never, { limit: 50 });

    const job = await prisma.adminJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job).toMatchObject({ status: "failed", error: EXPORT_STOPPED_BY_ERASURE_ERROR, storage_key: null });
    expect(JSON.stringify(job.result_json)).not.toContain("Erase Api");
    expect(stored).toHaveLength(1);
    expect(present(stored[0] as string)).toBe(false);
  });

  const exportJob = async (status: "pending" | "running") => {
    const { id } = await prisma.adminJob.create({
      data: {
        type: "export",
        status,
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        result_json: { request: { kind: "attendees_filtered", format: "csv", filters: { q: "Erase Api" } } },
      },
    });
    jobIds.push(id);
    return id;
  };

  it.each([
    ["erasing", (attendeeId: string) => post(erasePath(EVENT_ID, attendeeId))],
    ["removing", (attendeeId: string) => post(`/api/admin/events/${EVENT_ID}/attendees/${attendeeId}/remove`, { reason: "duplicate" })],
  ])("%s someone while an export is waiting for the worker stops it, so that nothing is built for it afterwards", async (_name, act) => {
    const a = await createAttendee();
    const jobId = await exportJob("pending");
    const put = vi.fn();

    expect((await act(a.id)).status).toBe(200);
    const drained = await drainExportJobs(prisma, { put, delete: vi.fn() } as never, { limit: 50 });

    const job = await prisma.adminJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job).toMatchObject({ status: "failed", error: EXPORT_STOPPED_BY_ERASURE_ERROR, storage_key: null });
    expect(JSON.stringify(job.result_json)).not.toContain("Erase Api");
    expect(drained.claimed).toBe(0);
    expect(put).not.toHaveBeenCalled();
  });

  /**
   * Waits until a statement whose text contains `text` (`%` stands for any run of characters) waits for a lock that
   * another transaction holds. By default an update of a job row: what a worker's claim and its record of a result are.
   */
  const waitUntilAStatementWaitsForALock = (text = "UPDATE%AdminJob") =>
    vi.waitFor(
      async () => {
        const rows = await prisma.$queryRaw<{ waiting: bigint }[]>`
          SELECT count(*)::bigint AS "waiting" FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE ${`%${text}%`}
        `;
        expect(Number(rows[0]?.waiting ?? 0)).toBeGreaterThan(0);
      },
      { timeout: 5000, interval: 25 },
    );

  /** The transaction of an erasure, kept open after it has stopped the open exports and imports of the event. */
  async function holdErasureOfJobs() {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let stopped!: () => void;
    const hasStopped = new Promise<void>((resolve) => {
      stopped = resolve;
    });
    const transaction = prisma.$transaction(
      async (tx) => {
        await stopOpenAttendeeJobs(tx, EVENT_ID);
        stopped();
        await released;
      },
      { timeout: 30_000 },
    );
    await hasStopped;
    return {
      commit: async () => {
        release();
        await transaction;
      },
    };
  }

  it("a worker that is done while an erasure still holds its job waits for it, finds the job closed, and deletes its file", async () => {
    const jobId = await exportJob("pending");
    const real = getDefaultStorage();
    const stored: string[] = [];
    let held: Awaited<ReturnType<typeof holdErasureOfJobs>> | undefined;
    const storage = {
      put: async (bytes: Buffer, opts: Parameters<typeof real.put>[1]) => {
        const staged = await real.put(bytes, opts);
        if (opts.eventId === EVENT_ID) {
          stored.push(staged.key);
          held = await holdErasureOfJobs();
        }
        return staged;
      },
      delete: (key: string) => real.delete(key),
    };

    const drained = drainExportJobs(prisma, storage as never, { limit: 50 });
    try {
      await waitUntilAStatementWaitsForALock();
      expect(held).toBeDefined();
    } finally {
      // Whatever happened, the erasure's transaction ends here, so a failure never leaves a lock behind.
      await held?.commit();
    }

    expect(await drained).toMatchObject({ succeeded: 0 });
    const job = await prisma.adminJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job).toMatchObject({ status: "failed", error: EXPORT_STOPPED_BY_ERASURE_ERROR, storage_key: null });
    expect(stored).toHaveLength(1);
    expect(present(stored[0] as string)).toBe(false);
  });

  it("a worker that wants a waiting export which an erasure still holds waits for it, finds it closed, and builds nothing", async () => {
    const jobId = await exportJob("pending");
    const held = await holdErasureOfJobs();
    const put = vi.fn();

    const drained = drainExportJobs(prisma, { put, delete: vi.fn() } as never, { limit: 50 });
    try {
      await waitUntilAStatementWaitsForALock();
    } finally {
      await held.commit();
    }

    expect(await drained).toMatchObject({ claimed: 0 });
    expect(put).not.toHaveBeenCalled();
    expect(await prisma.adminJob.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({
      status: "failed",
      error: EXPORT_STOPPED_BY_ERASURE_ERROR,
    });
  });

  /** A queued or running import whose staged CSV lists `email`, as the import enqueue leaves it. */
  async function queuedImport(email: string, status: "pending" | "running" = "pending") {
    const { key } = await getDefaultStorage().put(Buffer.from(`first_name,last_name,email\nQueued,Person,${email}\n`, "utf8"), {
      orgId: ORG_ID,
      eventId: EVENT_ID,
      scope: "event",
      ext: ".csv",
    });
    const job = await prisma.adminJob.create({
      data: {
        type: "import_commit",
        status,
        organization_id: ORG_ID,
        event_id: EVENT_ID,
        storage_key: key,
        filename: "queued.csv",
        import_id: randomUUID(),
        overwrite: false,
        force_capacity: false,
      },
    });
    jobIds.push(job.id);
    return { jobId: job.id, key };
  }
  const peopleWithAddress = (email: string) =>
    prisma.attendee.count({ where: { event_id: EVENT_ID, email: { equals: email, mode: "insensitive" } } });

  it.each([
    ["erasing", (attendeeId: string) => post(erasePath(EVENT_ID, attendeeId))],
    ["removing", (attendeeId: string) => post(`/api/admin/events/${EVENT_ID}/attendees/${attendeeId}/remove`, { reason: "duplicate" })],
  ])("%s someone whom an import in the queue lists stops that import, so that it cannot create them again, and deletes its file", async (_name, act) => {
    const a = await createAttendee();
    const queued = await queuedImport(a.email);

    expect((await act(a.id)).status).toBe(200);
    await drainImportJobs(prisma, getDefaultStorage(), { limit: 50 });

    expect(await prisma.adminJob.findUniqueOrThrow({ where: { id: queued.jobId } })).toMatchObject({
      status: "failed",
      error: IMPORT_STOPPED_BY_ERASURE_ERROR,
      storage_key: null,
    });
    expect(present(queued.key)).toBe(false);
    expect(await peopleWithAddress(a.email)).toBe(0);
  });

  it("an import that runs when an erasure closes its job creates nobody, and the job keeps the erasure's reason", async () => {
    const email = `import-in-flight-${++seq}@example.com`;
    const queued = await queuedImport(email);
    const real = getDefaultStorage();
    let held: Awaited<ReturnType<typeof holdErasureOfJobs>> | undefined;
    const storage = {
      // The worker has claimed the job and is about to import: the erasure closes it now and stays open.
      get: async (key: string) => {
        const bytes = await real.get(key);
        held = await holdErasureOfJobs();
        return bytes;
      },
      delete: (key: string) => real.delete(key),
    };

    const drained = drainImportJobs(prisma, storage as never, { limit: 50 });
    try {
      // The import has created its people and reaches the update that marks its job done, which waits.
      await waitUntilAStatementWaitsForALock();
    } finally {
      await held?.commit();
    }

    expect(await drained).toMatchObject({ claimed: 1, succeeded: 0, failed: 1 });
    expect(await prisma.adminJob.findUniqueOrThrow({ where: { id: queued.jobId } })).toMatchObject({
      status: "failed",
      error: IMPORT_STOPPED_BY_ERASURE_ERROR,
    });
    expect(await peopleWithAddress(email)).toBe(0);
  });

  it("a worker that wants a waiting import which an erasure still holds waits for it, finds it closed, and imports nothing", async () => {
    const email = `import-held-${++seq}@example.com`;
    const queued = await queuedImport(email);
    const held = await holdErasureOfJobs();
    const get = vi.fn();

    const drained = drainImportJobs(prisma, { get, delete: vi.fn() } as never, { limit: 50 });
    try {
      await waitUntilAStatementWaitsForALock();
    } finally {
      await held.commit();
    }

    expect(await drained).toMatchObject({ claimed: 0 });
    expect(get).not.toHaveBeenCalled();
    expect(await prisma.adminJob.findUniqueOrThrow({ where: { id: queued.jobId } })).toMatchObject({
      status: "failed",
      error: IMPORT_STOPPED_BY_ERASURE_ERROR,
    });
    expect(await peopleWithAddress(email)).toBe(0);
  });

  it("an export that is requested while an erasure is open waits for it, and is created after it", async () => {
    const erasure = await holdErasureOfJobs();

    const requested = app.request(`/api/admin/events/${EVENT_ID}/attendees/export?format=csv`, { headers: { Cookie: cookie } });
    try {
      await waitUntilAStatementWaitsForALock("pg_advisory_xact_lock_shared");
      expect(await prisma.adminJob.count({ where: { event_id: EVENT_ID, type: "export", status: "pending" } })).toBe(0);
    } finally {
      await erasure.commit();
    }

    const res = await requested;
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: string };
    jobIds.push(jobId);
    expect(await prisma.adminJob.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ type: "export", status: "pending" });
  });

  it("an export that waits for an open erasure longer than a transaction normally lasts is still created", async () => {
    const erasure = await holdErasureOfJobs();

    const requested = app.request(`/api/admin/events/${EVENT_ID}/attendees/export?format=csv`, { headers: { Cookie: cookie } });
    try {
      await waitUntilAStatementWaitsForALock("pg_advisory_xact_lock_shared");
      // Prisma ends a transaction after 5 seconds unless it is told otherwise; the wait for an erasure may be longer.
      await new Promise((resolve) => setTimeout(resolve, 5_600));
    } finally {
      await erasure.commit();
    }

    const res = await requested;
    expect(res.status).toBe(202);
    jobIds.push(((await res.json()) as { jobId: string }).jobId);
  }, 20_000);

  it("removing someone, one or a selection, does the same", async () => {
    const a = await createAttendee();
    const b = await createAttendee();
    const first = await seedJobFile(EVENT_ID);
    const afterSingle = await post(removePath(EVENT_ID, a.id), { reason: "duplicate" });
    expect(afterSingle.status).toBe(200);
    expect(present(first.key)).toBe(false);
    expect(await keyOf(first.jobId)).toBeNull();

    const second = await seedJobFile(EVENT_ID);
    const afterBulk = await post(bulkRemovePath(EVENT_ID), { attendeeIds: [b.id], reason: "other" });
    expect(afterBulk.status).toBe(200);
    expect(present(second.key)).toBe(false);
    expect(await keyOf(second.jobId)).toBeNull();
  });

  it("leaves them alone when nobody was erased or removed by the request", async () => {
    const a = await createAttendee();
    await post(erasePath(EVENT_ID, a.id));
    const file = await seedJobFile(EVENT_ID);

    const again = await post(erasePath(EVENT_ID, a.id));
    const unknown = await post(bulkRemovePath(EVENT_ID), { attendeeIds: ["nobody"], reason: "duplicate" });

    expect(again.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(present(file.key)).toBe(true);
    expect(await keyOf(file.jobId)).toBe(file.key);
  });

  it("reports a file it could not delete in the System logs, keeps its key for the retention run, and still erases", async () => {
    const a = await createAttendee();
    const stuck = await seedJobFile(EVENT_ID);
    const fine = await seedJobFile(EVENT_ID);
    const realDelete = getDefaultStorage().delete.bind(getDefaultStorage());
    vi.spyOn(getDefaultStorage(), "delete").mockImplementation(async (key: string) => {
      if (key === stuck.key) throw new Error("EBUSY");
      return realDelete(key);
    });

    const res = await post(erasePath(EVENT_ID, a.id));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ erased: 1 });
    expect(await keyOf(stuck.jobId)).toBe(stuck.key);
    expect(present(stuck.key)).toBe(true);
    expect(await keyOf(fine.jobId)).toBeNull();
    expect(querySystemLogs({ search: "job_file_purge_incomplete" })).toEqual([
      expect.objectContaining({ level: "warn", fields: { eventId: EVENT_ID, failed: 1 } }),
    ]);
  });

  it("still answers, and logs it, when the purge itself breaks", async () => {
    const a = await createAttendee();
    vi.spyOn(prisma.adminJob, "findMany").mockRejectedValueOnce(new Error("db hiccup"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post(removePath(EVENT_ID, a.id), { reason: "duplicate" });

    expect(res.status).toBe(200);
    expect(await prisma.attendee.count({ where: { id: a.id } })).toBe(0);
    expect(errSpy).toHaveBeenCalled();
    expect(querySystemLogs({ search: "job_file_purge_failed" })).toHaveLength(1);
  });
});
