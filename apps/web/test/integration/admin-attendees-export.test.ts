import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { encryptToString } from "@admitto/crypto";
import { resolvePreviewEventTimeZone } from "@admitto/mail-templates";
import { generateToken, hashToken } from "@admitto/tickets";
import { createApp } from "../../src/app.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/index.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const CHECKIN_TOKEN = "admin-export-checkin-token-32chars!!";

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

async function seed(client: PrismaClient) {
  const eventIds = [EVENT_EX, EVENT_EX_B, EVENT_EMPTY, EVENT_EX_JACKET, EVENT_EX_SHIRT, EVENT_EX_INJ_HEADER];
  await client.attendeeActionLog.deleteMany({ where: { event_id: { in: eventIds } } });
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
      {
        event_id: EVENT_EX_JACKET,
        key: "giftbag",
        label: "Gift bag",
        config: { contents: [{ label: "Jacket size", source_field: "jacket_size" }] },
      },
      {
        event_id: EVENT_EX_SHIRT,
        key: "giftbag",
        label: "Gift bag",
        config: { contents: [{ label: "Shirt size", source_field: "shirt_size" }] },
      },
      {
        event_id: EVENT_EX_INJ_HEADER,
        key: "giftbag",
        label: "Gift bag",
        config: {
          contents: [{ label: '=HYPERLINK("https://evil.com","click")', source_field: "evil_field" }],
        },
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
  prisma = new PrismaClient();
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

describe("GET /api/admin/events/:eventId/attendees/ticket-types", () => {
  it("returns distinct ticket types for event", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EX}/attendees/ticket-types`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { types: string[] };
    expect(body.types).toEqual(["standard", "vip"]);
  });

  it("returns empty array when no ticket_type set", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EMPTY}/attendees/ticket-types`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { types: string[] };
    expect(body.types).toEqual([]);
  });

  it("operator → 403", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EX}/attendees/ticket-types`, {
      headers: { Cookie: opCookie },
    });
    expect(res.status).toBe(403);
  });
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
      expect(res.status).toBe(200);
    }

    const limited = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=csv`,
      { headers: { Cookie: adminCookie } },
    );
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "too many requests" });
  });

  it("format=xlsx → 200, Content-Type xlsx, Content-Disposition attachment", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=xlsx&ticket_type=vip`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers.get("Content-Disposition")).toMatch(/attachment/);
    expect(res.headers.get("Content-Disposition")).toMatch(/filename="attendees-/);
  });

  it("format=csv → 200, Content-Type text/csv", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=csv`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
  });

  it("missing format → 400", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_EX}/attendees/export`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(400);
  });

  it("bad format=invalid → 400", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=invalid`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(400);
  });

  it("format=pdf → 200, application/pdf, PDF magic bytes", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=pdf&ticket_type=vip`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/pdf");
    expect(res.headers.get("Content-Disposition")).toMatch(/attachment/);
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf[0]).toBe(0x25);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x44);
    expect(buf[3]).toBe(0x46);
  });

  it("operator → 403 on PDF export", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=pdf`,
      { headers: { Cookie: opCookie } },
    );
    expect(res.status).toBe(403);
  });

  it("xlsx has check-off column and print settings", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=xlsx`,
      { headers: { Cookie: adminCookie } },
    );
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
    const res = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=xlsx&status=admitted`,
      { headers: { Cookie: adminCookie } },
    );
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
    const res = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=csv`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    const header = text.split("\r\n")[0] ?? "";
    expect(header).not.toContain("Shirt size");
    expect(header).not.toContain("shirt_size");
    expect(header).not.toContain("Jacket size");
  });

  it("export includes dynamic Jacket size column from event item contents", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_EX_JACKET}/attendees/export?format=csv&status=admitted`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const lines = (await res.text()).split("\r\n").filter(Boolean);
    const header = lines[0] ?? "";
    expect(header).toContain("Jacket size");
    expect(header).not.toContain("Shirt size");
    const jacketRow = lines.find((l) => l.includes("Jacket Guest"));
    expect(jacketRow).toContain('"L"');
  });

  it("export includes Shirt size column for dedicated event contents", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_EX_SHIRT}/attendees/export?format=xlsx`,
      { headers: { Cookie: adminCookie } },
    );
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

    const exportRes = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=csv&${query}`,
      { headers: { Cookie: adminCookie } },
    );
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
    const res = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=pdf`,
      { headers: { Cookie: adminCookie } },
    );
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
    const res = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=xlsx&ticket_type=vip`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const rows = await parseXlsxRows(await res.arrayBuffer());
    expect(rows.length).toBe(5);
    const dataRows = rows.slice(1);
    expect(dataRows.every((r) => r[5] === "vip")).toBe(true);
    expect(dataRows.some((r) => r[1] === "Standard Guest")).toBe(false);
  });

  it("export respects status filter", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=csv&status=admitted`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.split("\r\n").filter(Boolean);
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain("Vip One");
    expect(lines[1]).not.toContain("Standard Guest");
  });

  it("export respects q filter", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=csv&q=Standard`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Standard Guest");
    expect(text).not.toContain("Vip One");
  });

  it("export respects all active filters simultaneously", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=csv&ticket_type=vip&status=admitted&q=Vip+One`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const lines = (await res.text()).split("\r\n").filter(Boolean);
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain("Vip One");
    expect(lines[1]).not.toContain("Vip Two");
    expect(lines[1]).not.toContain("Standard Guest");
  });

  it("json custom_data search respects ticket_type before export cap", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=csv&ticket_type=vip&q=MegaCorp`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const lines = (await res.text()).split("\r\n").filter(Boolean);
    expect(lines.length).toBe(2);
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

    const res = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=csv&ticket_type=vip&q=SharedBulkCorp`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const lines = (await res.text()).split("\r\n").filter(Boolean);
    expect(lines.length).toBe(1);
  });

  it("no matches → file with headers only", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=csv&ticket_type=nonexistent`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.split("\r\n").filter(Boolean);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("Name");
    expect(lines[0]).toContain("Email");
  });

  it("formula injection CSV: cell prefixed with apostrophe", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=csv&ticket_type=vip&q=HYPERLINK`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    const injLine = text.split("\r\n").find((l) => l.includes("HYPERLINK"));
    expect(injLine).toBeDefined();
    expect(injLine).toMatch(/'=HYPERLINK/);
  });

  it("formula injection CSV: attribute column header quoted and sanitized", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_EX_INJ_HEADER}/attendees/export?format=csv`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const header = (await res.text()).split("\r\n")[0] ?? "";
    expect(header).toMatch(/"'=HYPERLINK\(""https:\/\/evil\.com"",""click""\)"/);
  });

  it("formula injection XLSX: cell starts with apostrophe", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=xlsx&ticket_type=vip&q=HYPERLINK`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const rows = await parseXlsxRows(await res.arrayBuffer());
    const injRow = rows.find((r) => r[1]?.includes("HYPERLINK"));
    expect(injRow).toBeDefined();
    expect(injRow![1]).toMatch(/^'=HYPERLINK/);
  });

  it("exported rows do NOT contain token_hash / token_enc / QR fields", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=csv`,
      { headers: { Cookie: adminCookie } },
    );
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
    const res = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=csv`,
      { headers: { Cookie: adminCookie } },
    );
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
    await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=csv&q=secret`,
      { headers: { Cookie: adminCookie } },
    );

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
    const res = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=csv`,
      { headers: { Cookie: opCookie } },
    );
    expect(res.status).toBe(403);
  });
});
