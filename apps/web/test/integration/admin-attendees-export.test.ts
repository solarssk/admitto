import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { encryptToString } from "@admitto/crypto";
import { generateToken, hashToken } from "@admitto/tickets";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const CHECKIN_TOKEN = "admin-export-checkin-token-32chars!!";

const ORG_EX = "org-export-test";
const ORG_EX_B = "org-export-test-b";
const EVENT_EX = "evt-export-test";
const EVENT_EX_B = "evt-export-test-b";
const EVENT_EMPTY = "evt-export-empty";

const EMAIL_ADMIN_EX = "export-admin@example.com";
const EMAIL_OP_EX = "export-op@example.com";
const PASSWORD = "export-test-pass-123";

const ATT_VIP1 = "att-export-vip1";
const ATT_VIP2 = "att-export-vip2";
const ATT_STD = "att-export-std";
const ATT_INJ = "att-export-inj";
const ATT_CROSS = "att-export-cross";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let adminId: string;
let opId: string;
let adminCookie = "";
let opCookie = "";

async function seed(client: PrismaClient) {
  const eventIds = [EVENT_EX, EVENT_EX_B, EVENT_EMPTY];
  await client.attendeeActionLog.deleteMany({ where: { event_id: { in: eventIds } } });
  await client.attendee.deleteMany({ where: { event_id: { in: eventIds } } });
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
}

async function sessionCookieFor(userId: string): Promise<string> {
  const { rawToken } = await createSession(prisma, { userId, stage: SESSION_STAGE.FULL });
  return `admitto_session=${rawToken}`;
}

async function parseXlsxRows(buf: ArrayBuffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buf);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const rows: string[][] = [];
  sheet.eachRow((row) => {
    const values = row.values as (ExcelJS.CellValue | undefined)[];
    rows.push(values.slice(1).map((v) => (v == null ? "" : String(v))));
  });
  return rows;
}

beforeAll(async () => {
  prisma = new PrismaClient();
  await seed(prisma);
  app = createApp({
    prisma,
    checkinToken: CHECKIN_TOKEN,
    allowCheckinBearer: true,
    baseUrl: "https://tickets.example.com",
    rateLimitStore: createRateLimitStore(),
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
    expect(body.total).toBe(3);
    const ids = body.items.map((i) => i.id);
    expect(ids).toContain(ATT_VIP1);
    expect(ids).toContain(ATT_VIP2);
    expect(ids).toContain(ATT_INJ);
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

  it("bad format=pdf → 400", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=pdf`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(400);
  });

  it("export respects ticket_type filter (xlsx: only vip rows)", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=xlsx&ticket_type=vip`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const rows = await parseXlsxRows(await res.arrayBuffer());
    expect(rows.length).toBe(4);
    const dataRows = rows.slice(1);
    expect(dataRows.every((r) => r[4] === "vip")).toBe(true);
    expect(dataRows.some((r) => r[0] === "Standard Guest")).toBe(false);
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

  it("formula injection XLSX: cell starts with apostrophe", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_EX}/attendees/export?format=xlsx&ticket_type=vip&q=HYPERLINK`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const rows = await parseXlsxRows(await res.arrayBuffer());
    const injRow = rows.find((r) => r[0]?.includes("HYPERLINK"));
    expect(injRow).toBeDefined();
    expect(injRow![0]).toMatch(/^'=HYPERLINK/);
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
