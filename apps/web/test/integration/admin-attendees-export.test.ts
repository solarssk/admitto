import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { encryptToString } from "@admitto/crypto";
import { resolvePreviewEventTimeZone } from "@admitto/mail-templates";
import { generateToken, hashToken } from "@admitto/tickets";
import { drainExportJobs } from "@admitto/tickets";
import { getDefaultStorage } from "@admitto/storage";
import { createApp } from "../../src/app.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/index.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const CHECKIN_TOKEN = "admin-export-checkin-token-32chars!!";
const sameOrigin = { Origin: "http://localhost" };

const ORG_EX = "org-export-test";
const ORG_EX_B = "org-export-test-b";
const EVENT_EX = "evt-export-test";
const EVENT_EX_B = "evt-export-test-b";
const EVENT_EMPTY = "evt-export-empty";
const EVENT_EX_JACKET = "evt-export-jacket";
const EVENT_EX_SHIRT = "evt-export-shirt";
const EVENT_EX_INJ_HEADER = "evt-export-inj-header";

const EMAIL_ADMIN_EX = "export-admin@example.com";
const EMAIL_OP_EX = "export-op@example.com";
const PASSWORD = "export-test-pass-123";

const ATT_VIP1 = "att-export-vip1";
const ATT_VIP2 = "att-export-vip2";
const ATT_STD = "att-export-std";
const ATT_INJ = "att-export-inj";
const ATT_CROSS = "att-export-cross";
const ATT_MEGA_VIP = "att-export-mega-vip";
const ATT_MEGA_STD = "att-export-mega-std";
const ATT_JACKET = "att-export-jacket";
const ATT_SHIRT = "att-export-shirt";
const ATT_INJ_HEADER = "att-export-inj-header";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let rateLimitStore: InMemoryRateLimitStore;
let adminId: string;
let opId: string;
let adminCookie = "";
let opCookie = "";

/**
 * Enqueue filtered export (202), drain the worker job, return the download Response (200 file).
 * Non-202 responses (403/400/429) are returned unchanged.
 */
async function exportAttendeesAndDrain(path: string, cookie: string): Promise<Response> {
  const queued = await app.request(path, { headers: { Cookie: cookie } });
  if (queued.status !== 202) return queued;

  const body = (await queued.json()) as { jobId?: string };
  if (!body.jobId) {
    throw new Error("export enqueue 202 missing jobId");
  }

  for (let i = 0; i < 40; i += 1) {
    const job = await prisma.adminJob.findUnique({
      where: { id: body.jobId },
      select: { status: true },
    });
    if (job?.status === "succeeded" || job?.status === "failed") break;
    await drainExportJobs(prisma, getDefaultStorage(), { limit: 10 });
  }

  const eventMatch = /\/api\/admin\/events\/([^/?]+)/.exec(path);
  if (!eventMatch) {
    throw new Error(`export path missing event id: ${path}`);
  }
  return app.request(
    `/api/admin/events/${eventMatch[1]}/export/jobs/${body.jobId}/download`,
    { headers: { Cookie: cookie } },
  );
}


async function seed(client: PrismaClient) {
  const eventIds = [EVENT_EX, EVENT_EX_B, EVENT_EMPTY, EVENT_EX_JACKET, EVENT_EX_SHIRT, EVENT_EX_INJ_HEADER];
  await client.attendeeActionLog.deleteMany({ where: { event_id: { in: eventIds } } });
  await client.adminJob.deleteMany({ where: { event_id: { in: eventIds } } });
  await client.emailDelivery.deleteMany({ where: { event_id: { in: eventIds } } });
  await client.attendee.deleteMany({ where: { event_id: { in: eventIds } } });
  await client.eventItem.deleteMany({ where: { event_id: { in: eventIds } } });
  await client.roleAssignment.deleteMany({
    where: { OR: [{ scope_id: { in: [ORG_EX, ORG_EX_B, ...eventIds] } }] },
  });
  await client.session.deleteMany({
    where: { user: { email: { in: [EMAIL_ADMIN_EX, EMAIL_OP_EX] } } },
  });
  await client.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_ADMIN_EX] } } },
  });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_ADMIN_EX, EMAIL_OP_EX] } } });
  await client.event.deleteMany({ where: { id: { in: eventIds } } });
  await client.organization.deleteMany({ where: { id: { in: [ORG_EX, ORG_EX_B] } } });

  const password_hash = await hashPassword(PASSWORD);

  await client.organization.createMany({
    data: [
      { id: ORG_EX, name: "Export Org", slug: "export-org" },
      { id: ORG_EX_B, name: "Export Org B", slug: "export-org-b" },
    ],
  });

  await client.event.createMany({
    data: [
      {
        id: EVENT_EX,
        title: "Export Event",
        slug: "export-event",
        date: new Date("2026-10-01"),
        timezone: "Asia/Tokyo",
        organization_id: ORG_EX,
      },
      {
        id: EVENT_EX_B,
        title: "Export Event B",
        slug: "export-event-b",
        date: new Date("2026-11-01"),
        organization_id: ORG_EX_B,
      },
      {
        id: EVENT_EMPTY,
        title: "Empty Event",
        slug: "export-empty",
        date: new Date("2026-12-01"),
        organization_id: ORG_EX,
      },
      {
        id: EVENT_EX_JACKET,
        title: "Export Jacket Event",
        slug: "export-jacket",
        date: new Date("2026-10-02"),
        organization_id: ORG_EX,
      },
      {
        id: EVENT_EX_SHIRT,
        title: "Export Shirt Event",
        slug: "export-shirt",
        date: new Date("2026-10-03"),
        organization_id: ORG_EX,
      },
      {
        id: EVENT_EX_INJ_HEADER,
        title: "Export Inj Header Event",
        slug: "export-inj-header",
        date: new Date("2026-10-04"),
        organization_id: ORG_EX,
      },
    ],
  });

  // Real TicketType rows for every (event, key) pair the attendee fixtures below write - the
  // (event_id, ticket_type) FK (migration 20260714210009_add_attendee_ticket_type_fk) now
  // requires this for every insert. Cascade-deleted with their event in cleanup above, so no
  // separate teardown is needed here.
  await client.ticketType.createMany({
    data: [
      { event_id: EVENT_EX, key: "vip", label: "VIP" },
      { event_id: EVENT_EX, key: "standard", label: "Standard" },
      { event_id: EVENT_EX_B, key: "vip", label: "VIP" },
      { event_id: EVENT_EX_JACKET, key: "vip", label: "VIP" },
      { event_id: EVENT_EX_SHIRT, key: "standard", label: "Standard" },
      { event_id: EVENT_EX_INJ_HEADER, key: "standard", label: "Standard" },
    ],
  });

  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN_EX, password_hash } });
  const opUser = await client.user.create({ data: { email: EMAIL_OP_EX, password_hash } });
  adminId = adminUser.id;
  opId = opUser.id;

  await client.roleAssignment.createMany({
    data: [
      { user_id: adminId, role: "admin", scope_type: "organization", scope_id: ORG_EX },
      { user_id: opId, role: "operator", scope_type: "event", scope_id: EVENT_EX },
    ],
  });

  await client.userMfaMethod.create({
    data: {
      user_id: adminId,
      type: "totp",
      secret_enc: encryptTotpSecret(generateTotpSecret()),
      confirmed_at: new Date(),
    },
  });

  const mkToken = () => ({
    token_hash: hashToken(generateToken()),
    token_enc: encryptToString(generateToken()),
  });

  await client.attendee.createMany({
    data: [
      {
        id: ATT_VIP1,
        event_id: EVENT_EX,
        email: "vip1@example.com",
        name: "Vip One",
        company: "Vip Co",
        ticket_type: "vip",
        admitted_at: new Date("2026-10-01T10:00:00Z"),
        ...mkToken(),
      },
      {
        id: ATT_VIP2,
        event_id: EVENT_EX,
        email: "vip2@example.com",
        name: "Vip Two",
        company: "Vip Co",
        ticket_type: "vip",
        ...mkToken(),
      },
      {
        id: ATT_STD,
        event_id: EVENT_EX,
        email: "std@example.com",
        name: "Standard Guest",
        company: "Std Co",
        ticket_type: "standard",
        ...mkToken(),
      },
      {
        id: ATT_INJ,
        event_id: EVENT_EX,
        email: "inj@example.com",
        name: '=HYPERLINK("evil")',
        company: "Inj Co",
        ticket_type: "vip",
        ...mkToken(),
      },
      {
        id: "att-export-notype",
        event_id: EVENT_EX,
        email: "notype@example.com",
        name: "No Type Guest",
        ...mkToken(),
      },
      {
        id: ATT_CROSS,
        event_id: EVENT_EX_B,
        email: "cross@example.com",
        name: "Cross Event",
        ticket_type: "vip",
        ...mkToken(),
      },
    ],
  });

  await client.attendee.createMany({
    data: [
      {
        id: ATT_MEGA_STD,
        event_id: EVENT_EX,
        email: "mega-std@example.com",
        name: "Mega Bulk Guest",
        ticket_type: "standard",
        custom_data: { company: "MegaCorp" },
        ...mkToken(),
      },
      {
        id: ATT_MEGA_VIP,
        event_id: EVENT_EX,
        email: "mega-vip@example.com",
        name: "Mega Vip",
        ticket_type: "vip",
        custom_data: { company: "MegaCorp" },
        ...mkToken(),
      },
      {
        id: ATT_JACKET,
        event_id: EVENT_EX_JACKET,
        email: "jacket@example.com",
        name: "Jacket Guest",
        ticket_type: "vip",
        admitted_at: new Date("2026-10-02T10:00:00Z"),
        custom_data: { jacket_size: "L" },
        ...mkToken(),
      },
      {
        id: ATT_SHIRT,
        event_id: EVENT_EX_SHIRT,
        email: "shirt@example.com",
        name: "Shirt Guest",
        ticket_type: "standard",
        custom_data: { shirt_size: "M" },
        ...mkToken(),
      },
      {
        id: ATT_INJ_HEADER,
        event_id: EVENT_EX_INJ_HEADER,
        email: "inj-header@example.com",
        name: "Inj Header Guest",
        ticket_type: "standard",
        custom_data: { evil_field: "x" },
        ...mkToken(),
      },
    ],
  });

  await client.eventItem.createMany({
    data: [
      { event_id: EVENT_EX_JACKET, key: "giftbag", label: "Gift bag" },
      { event_id: EVENT_EX_SHIRT, key: "giftbag", label: "Gift bag" },
      { event_id: EVENT_EX_INJ_HEADER, key: "giftbag", label: "Gift bag" },
    ],
  });

  await client.eventCustomField.createMany({
    data: [
      { event_id: EVENT_EX_JACKET, source_field: "jacket_size", label: "Jacket size" },
      { event_id: EVENT_EX_SHIRT, source_field: "shirt_size", label: "Shirt size" },
      {
        event_id: EVENT_EX_INJ_HEADER,
        source_field: "evil_field",
        label: '=HYPERLINK("https://evil.com","click")',
      },
    ],
  });
}

async function sessionCookieFor(userId: string): Promise<string> {
  const { rawToken } = await createSession(prisma, { userId, stage: SESSION_STAGE.FULL });
  return `admitto_session=${rawToken}`;
}

async function parseXlsxRows(buf: ArrayBuffer): Promise<string[][]> {
  const sheet = await parseXlsxSheet(buf);
  if (!sheet) return [];
  const rows: string[][] = [];
  sheet.eachRow((row) => {
    const values = row.values as (ExcelJS.CellValue | undefined)[];
    rows.push(values.slice(1).map((v) => (v == null ? "" : String(v))));
  });
  return rows;
}

async function parseXlsxSheet(buf: ArrayBuffer): Promise<ExcelJS.Worksheet | undefined> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buf);
  return workbook.worksheets[0];
}

/** Mirror production export admitted_at formatting for assertions. */
function formatAdmittedAtLocal(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(",", "");
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await seed(prisma);
  rateLimitStore = new InMemoryRateLimitStore();
  app = createApp({
    prisma,
    checkinToken: CHECKIN_TOKEN,
    allowCheckinBearer: true,
    baseUrl: "https://tickets.example.com",
    rateLimitStore,
    skipCheckinBootValidation: true,
    adminDistRoot,
  });
  adminCookie = await sessionCookieFor(adminId);
  opCookie = await sessionCookieFor(opId);
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("GET /api/admin/events/:eventId/attendees — ticket_type filter", () => {
  it("filter ticket_type=vip returns only vip attendees", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EX}/attendees?ticket_type=vip`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string }[]; total: number };
    expect(body.total).toBe(4);
    const ids = body.items.map((i) => i.id);
    expect(ids).toContain(ATT_VIP1);
    expect(ids).toContain(ATT_VIP2);
    expect(ids).toContain(ATT_INJ);
    expect(ids).toContain(ATT_MEGA_VIP);
    expect(ids).not.toContain(ATT_STD);
  });

  it("ticket_type=vip + status=admitted returns subset", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees?ticket_type=vip&status=admitted`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string }[]; total: number };
    expect(body.total).toBe(1);
    expect(body.items[0]!.id).toBe(ATT_VIP1);
  });

  it("ticket_type=vip + q=string returns subset", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees?ticket_type=standard&q=Standard`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string }[]; total: number };
    expect(body.total).toBe(1);
    expect(body.items[0]!.id).toBe(ATT_STD);
  });

  it("no matches → items=[], total=0", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees?ticket_type=nonexistent`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; total: number };
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });
});

describe("GET /api/admin/events/:eventId/export/jobs/:jobId", () => {
  beforeEach(() => {
    rateLimitStore.reset();
  });

  it("returns job status over HTTP and 404/400 for bad job lookups", async () => {
    const queued = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=csv&ticket_type=vip`,
      { headers: { Cookie: adminCookie } },
    );
    expect(queued.status).toBe(202);
    const { jobId } = (await queued.json()) as { jobId: string };

    const pending = await app.request(`/api/admin/events/${EVENT_EX}/export/jobs/${jobId}`, {
      headers: { Cookie: adminCookie },
    });
    expect(pending.status).toBe(200);
    expect(await pending.json()).toMatchObject({ jobId, status: "pending" });
    expect(pending.headers.get("Cache-Control")).toBe("no-store");

    const notReady = await app.request(
      `/api/admin/events/${EVENT_EX}/export/jobs/${jobId}/download`,
      { headers: { Cookie: adminCookie } },
    );
    expect(notReady.status).toBe(404);
    expect(await notReady.json()).toEqual({ error: "not_ready" });

    await drainExportJobs(prisma, getDefaultStorage(), { limit: 5 });

    const done = await app.request(`/api/admin/events/${EVENT_EX}/export/jobs/${jobId}`, {
      headers: { Cookie: adminCookie },
    });
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ jobId, status: "succeeded" });

    const missing = await app.request(`/api/admin/events/${EVENT_EX}/export/jobs/does-not-exist`, {
      headers: { Cookie: adminCookie },
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not_found" });

    const blank = await app.request(`/api/admin/events/${EVENT_EX}/export/jobs/%20`, {
      headers: { Cookie: adminCookie },
    });
    expect(blank.status).toBe(400);
    expect(await blank.json()).toEqual({ error: "jobId required" });

    const missingDownload = await app.request(
      `/api/admin/events/${EVENT_EX}/export/jobs/does-not-exist/download`,
      { headers: { Cookie: adminCookie } },
    );
    expect(missingDownload.status).toBe(404);
    expect(await missingDownload.json()).toEqual({ error: "not_found" });

    const blankDownload = await app.request(
      `/api/admin/events/${EVENT_EX}/export/jobs/%20/download`,
      { headers: { Cookie: adminCookie } },
    );
    expect(blankDownload.status).toBe(400);
    expect(await blankDownload.json()).toEqual({ error: "jobId required" });
  });

  it("download falls back to octet-stream and export.bin when job meta is sparse", async () => {
    const queued = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=csv&ticket_type=vip`,
      { headers: { Cookie: adminCookie } },
    );
    expect(queued.status).toBe(202);
    const { jobId } = (await queued.json()) as { jobId: string };
    await drainExportJobs(prisma, getDefaultStorage(), { limit: 5 });

    await prisma.adminJob.update({
      where: { id: jobId },
      data: {
        filename: null,
        result_json: { request: { kind: "attendees_filtered", format: "csv", filters: {} } },
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT_EX}/export/jobs/${jobId}/download`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Disposition")).toMatch(/filename="export\.bin"/);
  });

  it("treats succeeded jobs without a storage key and array result_json as not ready / sparse meta", async () => {
    const queued = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=csv&ticket_type=vip`,
      { headers: { Cookie: adminCookie } },
    );
    const { jobId } = (await queued.json()) as { jobId: string };
    await drainExportJobs(prisma, getDefaultStorage(), { limit: 5 });

    const job = await prisma.adminJob.findUniqueOrThrow({ where: { id: jobId } });
    await prisma.adminJob.update({
      where: { id: jobId },
      data: { storage_key: null },
    });
    const noKey = await app.request(`/api/admin/events/${EVENT_EX}/export/jobs/${jobId}/download`, {
      headers: { Cookie: adminCookie },
    });
    expect(noKey.status).toBe(404);
    expect(await noKey.json()).toEqual({ error: "not_ready" });

    await prisma.adminJob.update({
      where: { id: jobId },
      data: {
        storage_key: job.storage_key,
        filename: null,
        result_json: [],
      },
    });
    const arrayMeta = await app.request(
      `/api/admin/events/${EVENT_EX}/export/jobs/${jobId}/download`,
      { headers: { Cookie: adminCookie } },
    );
    expect(arrayMeta.status).toBe(200);
    expect(arrayMeta.headers.get("Content-Type")).toBe("application/octet-stream");
  });
});

describe("GET /api/admin/events/:eventId/attendees/export", () => {
  beforeEach(() => {
    rateLimitStore.reset();
  });

  it("returns 429 after 10 exports per hour per admin user", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await app.request(
        `/api/admin/events/${EVENT_EX}/attendees/export?format=csv`,
        { headers: { Cookie: adminCookie } },
      );
      expect(res.status).toBe(202);
    }

    const limited = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=csv`,
      { headers: { Cookie: adminCookie } },
    );
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "too many requests" });

    // Drop queued jobs so later tests do not wait behind this rate-limit backlog.
    await prisma.adminJob.deleteMany({ where: { event_id: EVENT_EX, type: "export" } });
  });

  it("format=xlsx → 200, Content-Type xlsx, Content-Disposition attachment", async () => {
    const res = await exportAttendeesAndDrain(`/api/admin/events/${EVENT_EX}/attendees/export?format=xlsx&ticket_type=vip`, adminCookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers.get("Content-Disposition")).toMatch(/attachment/);
    expect(res.headers.get("Content-Disposition")).toMatch(/filename="attendees-/);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("format=csv → 200, Content-Type text/csv", async () => {
    const res = await exportAttendeesAndDrain(`/api/admin/events/${EVENT_EX}/attendees/export?format=csv`, adminCookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    // Baseline security headers are applied by app-level middleware AFTER the handler
    // returns, specifically so they also land on a bare `new Response(...)` like this CSV
    // export (not just handlers that go through c.json()) — see apps/web/src/app.ts.
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("missing format → 400", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EX}/attendees/export`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(400);
  });

  it("bad format=invalid → 400", async () => {
    const res = await exportAttendeesAndDrain(`/api/admin/events/${EVENT_EX}/attendees/export?format=invalid`, adminCookie);
    expect(res.status).toBe(400);
  });

  it("format=pdf → 200, application/pdf, PDF magic bytes", async () => {
    const res = await exportAttendeesAndDrain(`/api/admin/events/${EVENT_EX}/attendees/export?format=pdf&ticket_type=vip`, adminCookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/pdf");
    expect(res.headers.get("Content-Disposition")).toMatch(/attachment/);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf[0]).toBe(0x25);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x44);
    expect(buf[3]).toBe(0x46);
  });

  it("operator → 403 on PDF export", async () => {
    const res = await exportAttendeesAndDrain(`/api/admin/events/${EVENT_EX}/attendees/export?format=pdf`, opCookie);
    expect(res.status).toBe(403);
  });

  it("xlsx has check-off column and print settings", async () => {
    const res = await exportAttendeesAndDrain(`/api/admin/events/${EVENT_EX}/attendees/export?format=xlsx`, adminCookie);
    expect(res.status).toBe(200);
    const buf = await res.arrayBuffer();
    const sheet = await parseXlsxSheet(buf);
    expect(sheet).toBeDefined();
    const rows = await parseXlsxRows(buf);
    expect(rows[0]![0]).toBe("✓");
    expect(rows[0]).not.toContain("Shirt size");
    expect(sheet!.pageSetup.fitToPage).toBe(true);
    expect(sheet!.pageSetup.orientation).toBe("landscape");
    expect((sheet!.views?.[0] as { ySplit?: number } | undefined)?.ySplit).toBe(1);
  });

  it("xlsx formats admitted_at in event timezone (not raw ISO)", async () => {
    const res = await exportAttendeesAndDrain(`/api/admin/events/${EVENT_EX}/attendees/export?format=xlsx&status=admitted`, adminCookie);
    expect(res.status).toBe(200);
    const rows = await parseXlsxRows(await res.arrayBuffer());
    const vipRow = rows.find((r) => r[1] === "Vip One");
    expect(vipRow).toBeDefined();
    const admittedCol = vipRow![7];
    expect(admittedCol).not.toContain("T");
    expect(admittedCol).not.toContain("Z");
    const expected = formatAdmittedAtLocal(
      new Date("2026-10-01T10:00:00Z"),
      resolvePreviewEventTimeZone("Asia/Tokyo"),
    );
    expect(admittedCol).toBe(expected);
  });

  it("export does not include attribute columns when event has no contents", async () => {
    const res = await exportAttendeesAndDrain(`/api/admin/events/${EVENT_EX}/attendees/export?format=csv`, adminCookie);
    expect(res.status).toBe(200);
    const text = await res.text();
    const header = text.split("\r\n")[0] ?? "";
    expect(header).not.toContain("Shirt size");
    expect(header).not.toContain("shirt_size");
    expect(header).not.toContain("Jacket size");
  });

  it("export includes dynamic Jacket size column from the custom-field registry", async () => {
    const res = await exportAttendeesAndDrain(`/api/admin/events/${EVENT_EX_JACKET}/attendees/export?format=csv&status=admitted`, adminCookie);
    expect(res.status).toBe(200);
    const lines = (await res.text()).split("\r\n").filter(Boolean);
    const header = lines[0] ?? "";
    expect(header).toContain("Jacket size");
    expect(header).not.toContain("Shirt size");
    const jacketRow = lines.find((l) => l.includes("Jacket Guest"));
    expect(jacketRow).toContain('"L"');
  });

  it("export includes Shirt size column for a dedicated custom field", async () => {
    const res = await exportAttendeesAndDrain(`/api/admin/events/${EVENT_EX_SHIRT}/attendees/export?format=xlsx`, adminCookie);
    expect(res.status).toBe(200);
    const rows = await parseXlsxRows(await res.arrayBuffer());
    expect(rows[0]).toContain("Shirt size");
    const dataRow = rows.find((r) => r[1] === "Shirt Guest");
    expect(dataRow?.[8]).toBe("M");
  });

  it("list and export return same subset (parity)", async () => {
    const query = `ticket_type=vip&q=Vip`;
    const listRes = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees?${query}&pageSize=100`,
      { headers: { Cookie: adminCookie } },
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { items: { name: string }[]; total: number };

    const exportRes = await exportAttendeesAndDrain(`/api/admin/events/${EVENT_EX}/attendees/export?format=csv&${query}`, adminCookie);
    expect(exportRes.status).toBe(200);
    const lines = (await exportRes.text()).split("\r\n").filter(Boolean);
    expect(lines.length - 1).toBe(listBody.total);
    const exportNames = lines.slice(1).map((line) => {
      const match = /^"([^"]*)"/.exec(line);
      return match?.[1] ?? "";
    });
    const listNames = listBody.items.map((i) => i.name).sort();
    expect(exportNames.sort()).toEqual(listNames);
  });

  it("audit metadata includes format=pdf after PDF export", async () => {
    await prisma.attendeeActionLog.deleteMany({
      where: { event_id: EVENT_EX, action_type: "attendees_exported" },
    });
    const res = await exportAttendeesAndDrain(`/api/admin/events/${EVENT_EX}/attendees/export?format=pdf`, adminCookie);
    expect(res.status).toBe(200);

    const log = await prisma.attendeeActionLog.findFirst({
      where: { event_id: EVENT_EX, action_type: "attendees_exported" },
      orderBy: { created_at: "desc" },
    });
    expect(log).not.toBeNull();
    const meta = log!.metadata as Record<string, unknown>;
    expect(meta.format).toBe("pdf");
  });

  it("export respects ticket_type filter (xlsx: only vip rows)", async () => {
    const res = await exportAttendeesAndDrain(`/api/admin/events/${EVENT_EX}/attendees/export?format=xlsx&ticket_type=vip`, adminCookie);
    expect(res.status).toBe(200);
    const rows = await parseXlsxRows(await res.arrayBuffer());
    expect(rows).toHaveLength(5);
    const dataRows = rows.slice(1);
    // The export resolves a row's raw ticket_type key through the catalog to its display label
    // (packages/tickets/src/attendees-export.ts's resolveTicketTypeLabel) - "vip" is stored, but
    // "VIP" (the seeded catalog label) is what actually renders.
    expect(dataRows.every((r) => r[5] === "VIP")).toBe(true);
    expect(dataRows.some((r) => r[1] === "Standard Guest")).toBe(false);
  });

  it("export respects status filter", async () => {
    const res = await exportAttendeesAndDrain(`/api/admin/events/${EVENT_EX}/attendees/export?format=csv&status=admitted`, adminCookie);
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("Vip One");
    expect(lines[1]).not.toContain("Standard Guest");
  });

  it("export respects q filter", async () => {
    const res = await exportAttendeesAndDrain(`/api/admin/events/${EVENT_EX}/attendees/export?format=csv&q=Standard`, adminCookie);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Standard Guest");
    expect(text).not.toContain("Vip One");
  });

  it("export respects all active filters simultaneously", async () => {
    const res = await exportAttendeesAndDrain(`/api/admin/events/${EVENT_EX}/attendees/export?format=csv&ticket_type=vip&status=admitted&q=Vip+One`, adminCookie);
    expect(res.status).toBe(200);
    const lines = (await res.text()).split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("Vip One");
    expect(lines[1]).not.toContain("Vip Two");
    expect(lines[1]).not.toContain("Standard Guest");
  });

  it("json custom_data search respects ticket_type before export cap", async () => {
    const res = await exportAttendeesAndDrain(`/api/admin/events/${EVENT_EX}/attendees/export?format=csv&ticket_type=vip&q=MegaCorp`, adminCookie);
    expect(res.status).toBe(200);
    const lines = (await res.text()).split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("Mega Vip");
    expect(lines[1]).not.toContain("Mega Standard");
  });

  it("json search with many standard matches does not materialize ids for vip export", async () => {
    await prisma.attendee.createMany({
      data: Array.from({ length: 60 }, (_, i) => {
        const token = generateToken();
        return {
          id: `att-export-bulk-json-${i}`,
          event_id: EVENT_EX,
          email: `bulk-json-${i}@example.com`,
          name: `Bulk JSON ${i}`,
          ticket_type: "standard",
          custom_data: { company: "SharedBulkCorp" },
          token_hash: hashToken(token),
          token_enc: encryptToString(generateToken()),
        };
      }),
    });

    const res = await exportAttendeesAndDrain(`/api/admin/events/${EVENT_EX}/attendees/export?format=csv&ticket_type=vip&q=SharedBulkCorp`, adminCookie);
    expect(res.status).toBe(200);
    const lines = (await res.text()).split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(1);
  });

  it("no matches → file with headers only", async () => {
    const res = await exportAttendeesAndDrain(`/api/admin/events/${EVENT_EX}/attendees/export?format=csv&ticket_type=nonexistent`, adminCookie);
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Name");
    expect(lines[0]).toContain("Email");
  });

  it("formula injection CSV: cell prefixed with apostrophe", async () => {
    const res = await exportAttendeesAndDrain(`/api/admin/events/${EVENT_EX}/attendees/export?format=csv&ticket_type=vip&q=HYPERLINK`, adminCookie);
    expect(res.status).toBe(200);
    const text = await res.text();
    const injLine = text.split("\r\n").find((l) => l.includes("HYPERLINK"));
    expect(injLine).toBeDefined();
    expect(injLine).toMatch(/'=HYPERLINK/);
  });

  it("formula injection CSV: attribute column header quoted and sanitized", async () => {
    const res = await exportAttendeesAndDrain(`/api/admin/events/${EVENT_EX_INJ_HEADER}/attendees/export?format=csv`, adminCookie);
    expect(res.status).toBe(200);
    const header = (await res.text()).split("\r\n")[0] ?? "";
    expect(header).toMatch(/"'=HYPERLINK\(""https:\/\/evil\.com"",""click""\)"/);
  });

  it("formula injection XLSX: cell starts with apostrophe", async () => {
    const res = await exportAttendeesAndDrain(`/api/admin/events/${EVENT_EX}/attendees/export?format=xlsx&ticket_type=vip&q=HYPERLINK`, adminCookie);
    expect(res.status).toBe(200);
    const rows = await parseXlsxRows(await res.arrayBuffer());
    const injRow = rows.find((r) => r[1]?.includes("HYPERLINK"));
    expect(injRow).toBeDefined();
    expect(injRow![1]).toMatch(/^'=HYPERLINK/);
  });

  it("exported rows do NOT contain token_hash / token_enc / QR fields", async () => {
    const res = await exportAttendeesAndDrain(`/api/admin/events/${EVENT_EX}/attendees/export?format=csv`, adminCookie);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("token_hash");
    expect(text).not.toContain("token_enc");
    expect(text).not.toContain("qr_payload");
  });

  it("audit: attendees_exported, attendee_id=null", async () => {
    await prisma.attendeeActionLog.deleteMany({
      where: { event_id: EVENT_EX, action_type: "attendees_exported" },
    });
    const res = await exportAttendeesAndDrain(`/api/admin/events/${EVENT_EX}/attendees/export?format=csv`, adminCookie);
    expect(res.status).toBe(200);

    const log = await prisma.attendeeActionLog.findFirst({
      where: { event_id: EVENT_EX, action_type: "attendees_exported" },
      orderBy: { created_at: "desc" },
    });
    expect(log).not.toBeNull();
    expect(log!.attendee_id).toBeNull();
  });

  it("audit metadata: format, count, filters.has_query, NO raw q", async () => {
    await prisma.attendeeActionLog.deleteMany({
      where: { event_id: EVENT_EX, action_type: "attendees_exported" },
    });
    await exportAttendeesAndDrain(`/api/admin/events/${EVENT_EX}/attendees/export?format=csv&q=secret`, adminCookie);

    const log = await prisma.attendeeActionLog.findFirst({
      where: { event_id: EVENT_EX, action_type: "attendees_exported" },
      orderBy: { created_at: "desc" },
    });
    expect(log).not.toBeNull();
    const meta = log!.metadata as Record<string, unknown>;
    expect(meta.format).toBe("csv");
    expect(meta.filters).toMatchObject({ has_query: true });
    expect(JSON.stringify(meta)).not.toContain("secret");
  });

  it("operator → 403", async () => {
    const res = await exportAttendeesAndDrain(`/api/admin/events/${EVENT_EX}/attendees/export?format=csv`, opCookie);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/events/:eventId/attendees/export-selected (#520)", () => {
  beforeEach(() => {
    rateLimitStore.reset();
  });

  function postSelection(eventId: string, body: unknown, cookie: string = adminCookie) {
    return app.request(`/api/admin/events/${eventId}/attendees/export-selected`, {
      method: "POST",
      headers: { Cookie: cookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("exports exactly the selected rows, ignoring list filters — and never puts ids in the URL", async () => {
    // No filter params on this request at all — an explicit selection bypasses filters
    // entirely, and (Codex review, #520) the ids travel in the JSON body, not the query string.
    const res = await postSelection(EVENT_EX, { attendee_ids: [ATT_STD, ATT_VIP1], format: "csv" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const lines = (await res.text()).split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(3); // header + 2 selected rows
    const body = lines.slice(1).join("\n");
    expect(body).toContain("Standard Guest");
    expect(body).toContain("Vip One");
    expect(body).not.toContain("Vip Two");
  });

  it("silently ignores ids that belong to another event", async () => {
    const res = await postSelection(EVENT_EX, { attendee_ids: [ATT_VIP1, ATT_CROSS], format: "csv" });
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(2); // header + ATT_VIP1 only
    expect(lines[1]).toContain("Vip One");
    expect(text).not.toContain("Cross Event");
  });

  it("unknown ids only → file with headers only", async () => {
    const res = await postSelection(EVENT_EX, { attendee_ids: ["att-does-not-exist"], format: "csv" });
    expect(res.status).toBe(200);
    const lines = (await res.text()).split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(1);
  });

  it("empty attendee_ids → 400", async () => {
    const res = await postSelection(EVENT_EX, { attendee_ids: [], format: "csv" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "validation_failed" });
  });

  it("malformed JSON body → 400 invalid json", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EX}/attendees/export-selected`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: "{not valid json",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid json" });
  });

  it("more ids than the bulk cap → 400", async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `att-cap-${i}`);
    const res = await postSelection(EVENT_EX, { attendee_ids: ids, format: "csv" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "validation_failed" });
  });

  it("audit metadata records selected_count instead of list filters", async () => {
    await prisma.attendeeActionLog.deleteMany({
      where: { event_id: EVENT_EX, action_type: "attendees_exported" },
    });
    const res = await postSelection(EVENT_EX, {
      attendee_ids: [ATT_VIP1, ATT_VIP2, "att-does-not-exist"],
      format: "csv",
    });
    expect(res.status).toBe(200);

    const log = await prisma.attendeeActionLog.findFirst({
      where: { event_id: EVENT_EX, action_type: "attendees_exported" },
      orderBy: { created_at: "desc" },
    });
    expect(log).not.toBeNull();
    const meta = log!.metadata as Record<string, unknown>;
    expect(meta.format).toBe("csv");
    // count = rows actually exported; selected_count = ids the operator requested.
    expect(meta.count).toBe(2);
    expect(meta.filters).toEqual({ selected_count: 3 });
    // No attendee ids and no list-filter fields in the selection audit entry.
    expect(JSON.stringify(meta)).not.toContain(ATT_VIP1);
    expect(meta.filters).not.toHaveProperty("status");
  });

  it("selection works for xlsx too (format stays generic server-side)", async () => {
    const res = await postSelection(EVENT_EX, { attendee_ids: [ATT_VIP1], format: "xlsx" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  it("rejects a cross-origin POST (CSRF guard)", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EX}/attendees/export-selected`, {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", Origin: "https://evil.example" },
      body: JSON.stringify({ attendee_ids: [ATT_VIP1], format: "csv" }),
    });
    expect(res.status).toBe(403);
  });

  it("operator → 403", async () => {
    const res = await postSelection(EVENT_EX, { attendee_ids: [ATT_VIP1], format: "csv" }, opCookie);
    expect(res.status).toBe(403);
  });
});

describe("mail_status filter — list + export (#522)", () => {
  // Latest-delivery buckets: VIP1 sent (newer sent beats older failed), VIP2 pending (queued),
  // STD failed (newer bounced beats older sent), INJ sent (delivered); everyone else not_sent.
  beforeAll(async () => {
    const org = { organization_id: ORG_EX, event_id: EVENT_EX, provider: "smtp" };
    await prisma.emailDelivery.createMany({
      data: [
        { ...org, attendee_id: ATT_VIP1, status: "failed", created_at: new Date("2026-06-01T10:00:00Z") },
        { ...org, purpose: "resend", attendee_id: ATT_VIP1, status: "sent", created_at: new Date("2026-06-02T10:00:00Z") },
        { ...org, attendee_id: ATT_VIP2, status: "queued", created_at: new Date("2026-06-01T10:00:00Z") },
        { ...org, attendee_id: ATT_STD, status: "sent", created_at: new Date("2026-06-01T10:00:00Z") },
        { ...org, purpose: "resend", attendee_id: ATT_STD, status: "bounced", created_at: new Date("2026-06-03T10:00:00Z") },
        { ...org, attendee_id: ATT_INJ, status: "delivered", created_at: new Date("2026-06-01T10:00:00Z") },
      ],
    });
  });

  afterAll(async () => {
    await prisma.emailDelivery.deleteMany({ where: { event_id: EVENT_EX } });
  });

  beforeEach(() => {
    rateLimitStore.reset();
  });

  async function listIds(query: string): Promise<string[]> {
    // pageSize=100: EVENT_EX carries ~60 fixture attendees from earlier blocks — one page.
    const res = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees?pageSize=100&${query}`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string }[]; total: number };
    expect(body.total).toBe(body.items.length);
    return body.items.map((i) => i.id).sort();
  }

  it("sent bucket matches the LATEST delivery (a newer sent beats an older failed)", async () => {
    expect(await listIds("mail_status=sent")).toEqual([ATT_INJ, ATT_VIP1].sort());
  });

  it("failed bucket matches the LATEST delivery (a newer bounce beats an older sent)", async () => {
    expect(await listIds("mail_status=failed")).toEqual([ATT_STD]);
  });

  it("pending bucket returns attendees whose latest delivery is queued", async () => {
    expect(await listIds("mail_status=pending")).toEqual([ATT_VIP2]);
  });

  it("not_sent returns exactly the attendees with no deliveries at all", async () => {
    const all = await listIds("");
    const withDeliveries = [ATT_VIP1, ATT_VIP2, ATT_STD, ATT_INJ];
    const expected = all.filter((id) => !withDeliveries.includes(id));
    expect(await listIds("mail_status=not_sent")).toEqual(expected);
    expect(expected).toEqual(expect.arrayContaining([ATT_MEGA_STD, ATT_MEGA_VIP, "att-export-notype"]));
  });

  it("composes with ticket_type and with q (both raw-SQL paths)", async () => {
    expect(await listIds("mail_status=failed&ticket_type=standard")).toEqual([ATT_STD]);
    expect(await listIds("mail_status=sent&q=Vip")).toEqual([ATT_VIP1]);
  });

  it("an unknown mail_status value is ignored (no filter applied)", async () => {
    const all = await listIds("");
    expect(await listIds("mail_status=carrier-pigeon")).toEqual(all);
  });

  it("export respects mail_status and audit metadata records it", async () => {
    await prisma.attendeeActionLog.deleteMany({
      where: { event_id: EVENT_EX, action_type: "attendees_exported" },
    });
    const res = await exportAttendeesAndDrain(`/api/admin/events/${EVENT_EX}/attendees/export?format=csv&mail_status=failed`, adminCookie);
    expect(res.status).toBe(200);
    const lines = (await res.text()).split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(2); // header + ATT_STD
    expect(lines[1]).toContain("Standard Guest");

    const log = await prisma.attendeeActionLog.findFirst({
      where: { event_id: EVENT_EX, action_type: "attendees_exported" },
      orderBy: { created_at: "desc" },
    });
    const meta = log!.metadata as Record<string, unknown>;
    expect(meta.filters).toMatchObject({ mail_status: "failed" });
  });

  it("the Mail column badge and the mail_status filter agree on 'latest' when two deliveries share a timestamp (#522 code review)", async () => {
    // Same created_at on purpose - only the id tiebreak (DESC) distinguishes them. If the list
    // endpoint's badge lookup and the filter's SQL ever pick different rows as "latest", this
    // attendee would show one status in the Mail column while sitting in the wrong filter bucket.
    const tiedAt = new Date("2026-06-05T12:00:00.000Z");
    await prisma.emailDelivery.createMany({
      data: [
        {
          id: "tie-a-older-id-wins-nothing",
          organization_id: ORG_EX,
          event_id: EVENT_EX,
          attendee_id: ATT_MEGA_STD,
          purpose: "initial",
          provider: "smtp",
          status: "sent",
          created_at: tiedAt,
        },
        {
          id: "tie-b-higher-id-is-latest",
          organization_id: ORG_EX,
          event_id: EVENT_EX,
          attendee_id: ATT_MEGA_STD,
          purpose: "resend",
          provider: "smtp",
          status: "failed",
          created_at: tiedAt,
        },
      ],
    });
    try {
      const listRes = await app.request(`/api/admin/events/${EVENT_EX}/attendees?q=Mega+Bulk`, {
        headers: { Cookie: adminCookie },
      });
      const listBody = (await listRes.json()) as { items: { id: string; last_mail_status: string }[] };
      const row = listBody.items.find((i) => i.id === ATT_MEGA_STD);
      expect(row?.last_mail_status).toBe("failed");

      expect(await listIds("mail_status=failed&q=Mega+Bulk")).toEqual([ATT_MEGA_STD]);
      expect(await listIds("mail_status=sent&q=Mega+Bulk")).toEqual([]);
    } finally {
      await prisma.emailDelivery.deleteMany({ where: { id: { in: ["tie-a-older-id-wins-nothing", "tie-b-higher-id-is-latest"] } } });
    }
  });
});
