import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { buildXlsxBuffer } from "../../src/admin/xlsx-to-csv.js";
import { createApp } from "../../src/app.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/index.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_A = "org-admin-import-a";
const ORG_B = "org-admin-import-b";
const EVENT_A = "evt-admin-import-a";
const EVENT_B = "evt-admin-import-b";

const EMAIL_ADMIN = "admin-import-admin@example.com";
const EMAIL_OP = "admin-import-op@example.com";
const PASSWORD = "admin-import-pass-123";

const EXISTING_ATT = "att-import-existing";

const VALID_CSV = [
  "first_name,last_name,email,ticket_type,company",
  "Eve,Example,eve@example.com,standard,Example Co",
  "Frank,Fresh,frank@example.com,vip,Fresh Ltd",
].join("\n");

const INVALID_CSV = [
  "first_name,last_name,email",
  "Bad,,missing@example.com",
  "Good,Row,not-an-email",
].join("\n");

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let rateLimitStore: InMemoryRateLimitStore;
let adminId: string;
let adminCookie = "";
let opCookie = "";

/** Build multipart form data for a CSV import fixture. */
function csvFormData(content: string, filename = "import.csv", overwrite = false): FormData {
  const fd = new FormData();
  fd.append("file", new Blob([content], { type: "text/csv" }), filename);
  if (overwrite) fd.append("overwrite", "true");
  return fd;
}

/** Build multipart form data for an XLSX import fixture. */
async function xlsxFormData(rows: string[][]): Promise<FormData> {
  const buf = await buildXlsxBuffer(rows);
  const fd = new FormData();
  fd.append("file", new Blob([buf]), "import.xlsx");
  return fd;
}

/** POST a multipart import request with session cookie and CSRF Origin header. */
async function postImport(
  path: string,
  formData: FormData,
  cookie: string,
): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { Cookie: cookie, ...sameOrigin },
    body: formData,
  });
}

/** Seed orgs, events, users, and a baseline attendee for import integration tests. */
async function seed(client: PrismaClient) {
  await client.attendeeActionLog.deleteMany({
    where: { event_id: { in: [EVENT_A, EVENT_B] } },
  });
  await client.attendee.deleteMany({ where: { event_id: { in: [EVENT_A, EVENT_B] } } });
  await client.roleAssignment.deleteMany({
    where: { OR: [{ scope_id: { in: [ORG_A, ORG_B, EVENT_A, EVENT_B] } }] },
  });
  await client.session.deleteMany({
    where: { user: { email: { in: [EMAIL_ADMIN, EMAIL_OP] } } },
  });
  await client.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_ADMIN] } } },
  });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_ADMIN, EMAIL_OP] } } });
  await client.event.deleteMany({ where: { id: { in: [EVENT_A, EVENT_B] } } });
  await client.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });

  const password_hash = await hashPassword(PASSWORD);

  await client.organization.createMany({
    data: [
      { id: ORG_A, name: "Org Import A", slug: "admin-import-a" },
      { id: ORG_B, name: "Org Import B", slug: "admin-import-b" },
    ],
  });

  await client.event.createMany({
    data: [
      {
        id: EVENT_A,
        title: "Import Event A",
        slug: "event-admin-import-a",
        date: new Date("2026-10-01"),
        organization_id: ORG_A,
      },
      {
        id: EVENT_B,
        title: "Import Event B",
        slug: "event-admin-import-b",
        date: new Date("2026-11-01"),
        organization_id: ORG_B,
      },
    ],
  });

  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  const opUser = await client.user.create({ data: { email: EMAIL_OP, password_hash } });
  adminId = adminUser.id;

  await client.roleAssignment.createMany({
    data: [
      { user_id: adminId, role: "admin", scope_type: "organization", scope_id: ORG_A },
      { user_id: opUser.id, role: "operator", scope_type: "event", scope_id: EVENT_A },
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

  await client.attendee.create({
    data: {
      id: EXISTING_ATT,
      event_id: EVENT_A,
      email: "existing@example.com",
      name: "Existing Person",
      company: "Old Co",
    },
  });
}

/** Create a full-session cookie string for the given user id. */
async function sessionCookieFor(userId: string): Promise<string> {
  const { rawToken } = await createSession(prisma, { userId, stage: SESSION_STAGE.FULL });
  return `admitto_session=${rawToken}`;
}

beforeAll(async () => {
  prisma = new PrismaClient();
  await seed(prisma);
  rateLimitStore = new InMemoryRateLimitStore();
  app = createApp({
    prisma,
    checkinToken: "admin-import-checkin-token-32chars!",
    allowCheckinBearer: true,
    baseUrl: "https://tickets.example.com",
    rateLimitStore,
    skipCheckinBootValidation: true,
    adminDistRoot,
  });
  adminCookie = await sessionCookieFor(adminId);
  const opUser = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL_OP } });
  opCookie = await sessionCookieFor(opUser.id);
});

beforeEach(() => {
  rateLimitStore.reset();
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("POST /api/admin/events/:eventId/import/preview", () => {
  it("returns dry-run counts and invalid rows without raw PII", async () => {
    const mixed = [
      "first_name,last_name,email",
      "Eve,Example,eve@example.com",
      "Bad,,bad@example.com",
    ].join("\n");

    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/preview`,
      csvFormData(mixed),
      adminCookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      parse: {
        validCount: number;
        invalidRows: { rowIndex: number; reason: string; raw?: unknown }[];
        warnings: string[];
      };
      summary: { toCreate: number; toUpdate: number; toSkip: number };
    };

    expect(body.parse.validCount).toBe(1);
    expect(body.summary.toCreate).toBe(1);
    expect(body.parse.invalidRows).toHaveLength(1);
    expect(body.parse.invalidRows[0]).not.toHaveProperty("raw");
    expect(body.parse.invalidRows[0]!.reason).toMatch(/first_name|last_name|name/i);
    expect(body.parse.invalidRows[0]!.reason).not.toMatch(/@/);
  });

  it("sanitizes invalid-email reasons without exposing the address", async () => {
    const csv = ["first_name,last_name,email", "Ann,Example,not-an-email"].join("\n");
    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/preview`,
      csvFormData(csv),
      adminCookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      parse: { invalidRows: { reason: string }[] };
    };
    expect(body.parse.invalidRows[0]!.reason).toBe("Invalid email format");
    expect(body.parse.invalidRows[0]!.reason).not.toContain("not-an-email");
  });

  it("sanitizes duplicate-email reasons without exposing the address", async () => {
    const csv = [
      "first_name,last_name,email",
      "Ann,One,dup@example.com",
      "Bob,Two,dup@example.com",
    ].join("\n");
    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/preview`,
      csvFormData(csv),
      adminCookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      parse: { invalidRows: { reason: string }[] };
    };
    expect(body.parse.invalidRows[0]!.reason).toBe("Duplicate email in file");
    expect(body.parse.invalidRows[0]!.reason).not.toContain("dup@example.com");
    expect(body.parse.invalidRows[0]!.reason).not.toMatch(/@/);
  });

  it("sanitizes unknown-column warnings that could contain email addresses", async () => {
    // No header row — first data row is treated as headers, values become column names.
    const csv = ["john@example.com,Smith,col3", "Jane,Doe,jane@example.com"].join("\n");
    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/preview`,
      csvFormData(csv),
      adminCookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { parse: { warnings: string[] } };
    expect(body.parse.warnings.length).toBeGreaterThan(0);
    expect(body.parse.warnings.some((w) => w.includes("Unknown column ignored"))).toBe(true);
    const allWarnings = body.parse.warnings.join(" ");
    expect(allWarnings).not.toMatch(/@/);
    expect(allWarnings).not.toContain("john@example.com");
  });

  it("sanitizes single-word name warnings without exposing the name", async () => {
    const csv = ["name,email", "Madonna,solo@example.com"].join("\n");
    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/preview`,
      csvFormData(csv),
      adminCookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { parse: { warnings: string[] } };
    expect(body.parse.warnings.length).toBeGreaterThan(0);
    expect(body.parse.warnings[0]).toMatch(/single-word name/);
    expect(body.parse.warnings[0]).not.toContain("Madonna");
  });

  it("returns importId on successful preview", async () => {
    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/preview`,
      csvFormData(VALID_CSV),
      adminCookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { importId: string };
    expect(body.importId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("returns importId when upload is rejected", async () => {
    const fd = new FormData();
    fd.append("file", new Blob(["hello"]), "notes.txt");
    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/preview`,
      fd,
      adminCookie,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; importId: string };
    expect(body.error).toBe("unsupported file type");
    expect(body.importId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("rejects csv with zip magic bytes (renamed xlsx)", async () => {
    const zipLike = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    const fd = new FormData();
    fd.append("file", new Blob([zipLike]), "renamed.csv");
    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/preview`,
      fd,
      adminCookie,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; importId: string };
    expect(body.error).toBe("invalid file content");
    expect(body.importId).toBeTruthy();
  });

  it("rejects corrupt XLSX with 400", async () => {
    const fd = new FormData();
    fd.append("file", new Blob(["not-a-real-xlsx"]), "broken.xlsx");
    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/preview`,
      fd,
      adminCookie,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid file content");
  });

  it("counts existing attendee as skip when overwrite=false", async () => {
    const csv = [
      "first_name,last_name,email",
      "Existing,Person,existing@example.com",
      "New,Person,new@example.com",
    ].join("\n");

    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/preview`,
      csvFormData(csv),
      adminCookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: { toCreate: number; toSkip: number };
    };
    expect(body.summary.toCreate).toBe(1);
    expect(body.summary.toSkip).toBe(1);
  });

  it("rejects unsupported file type", async () => {
    const fd = new FormData();
    fd.append("file", new Blob(["hello"]), "notes.txt");
    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/preview`,
      fd,
      adminCookie,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unsupported file type");
  });

  it("rejects oversized file", async () => {
    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array(5 * 1024 * 1024 + 1)]), "big.csv");
    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/preview`,
      fd,
      adminCookie,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("file too large");
  });

  it("rejects operator and cross-event admin", async () => {
    const fd = csvFormData(VALID_CSV);
    const opRes = await postImport(
      `/api/admin/events/${EVENT_A}/import/preview`,
      fd,
      opCookie,
    );
    expect(opRes.status).toBe(403);

    const crossRes = await postImport(
      `/api/admin/events/${EVENT_B}/import/preview`,
      csvFormData(VALID_CSV),
      adminCookie,
    );
    expect(crossRes.status).toBe(403);
  });

  it("parses XLSX uploaded as multipart", async () => {
    const fd = await xlsxFormData([
      ["first_name", "last_name", "email"],
      ["Xls", "User", "xls@example.com"],
    ]);
    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/preview`,
      fd,
      adminCookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { parse: { validCount: number }; summary: { toCreate: number } };
    expect(body.parse.validCount).toBe(1);
    expect(body.summary.toCreate).toBe(1);
  });
});

describe("POST /api/admin/events/:eventId/import/commit", () => {
  it("creates attendees and writes bulk audit without PII", async () => {
    await prisma.attendeeActionLog.deleteMany({ where: { event_id: EVENT_A } });
    await prisma.attendee.deleteMany({
      where: { event_id: EVENT_A, id: { not: EXISTING_ATT } },
    });

    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/commit`,
      csvFormData(VALID_CSV, "batch.csv"),
      adminCookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      importId: string;
      created: number;
      skipped: { email: string; reason: string }[];
    };
    expect(body.importId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(body.created).toBe(2);

    const rows = await prisma.attendee.findMany({
      where: { event_id: EVENT_A, email: { in: ["eve@example.com", "frank@example.com"] } },
    });
    expect(rows).toHaveLength(2);

    const audit = await prisma.attendeeActionLog.findMany({
      where: { event_id: EVENT_A, action_type: "attendees_imported" },
      orderBy: { created_at: "desc" },
      take: 1,
    });
    expect(audit).toHaveLength(1);
    const entry = audit[0]!;
    expect(entry.attendee_id).toBeNull();
    expect(entry.actor_user_id).toBe(adminId);
    const meta = entry.metadata as Record<string, unknown>;
    expect(meta.created).toBe(2);
    expect(meta.filename).toBe("batch.csv");
    expect(meta).not.toHaveProperty("rows");
    expect(JSON.stringify(meta)).not.toMatch(/eve@example.com/);
  });

  it("re-import overwrite=false skips all existing", async () => {
    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/commit`,
      csvFormData(VALID_CSV),
      adminCookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      created: number;
      updated: number;
      skipped: { email: string; reason: string }[];
    };
    expect(body.created).toBe(0);
    expect(body.updated).toBe(0);
    expect(body.skipped.length).toBe(2);
    expect(body.skipped.every((s) => s.reason.includes("overwrite=false"))).toBe(true);
  });

  it("re-import overwrite=true updates profile fields", async () => {
    const updatedCsv = [
      "first_name,last_name,email,company",
      "Eve,Updated,eve@example.com,New Co",
      "Frank,Updated,frank@example.com,New Ltd",
    ].join("\n");

    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/commit`,
      csvFormData(updatedCsv, "update.csv", true),
      adminCookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { updated: number };
    expect(body.updated).toBe(2);

    const eve = await prisma.attendee.findFirst({
      where: { event_id: EVENT_A, email: "eve@example.com" },
    });
    expect(eve?.name).toBe("Eve Updated");
    expect(eve?.company).toBe("New Co");
  });

  it("rejects operator on commit", async () => {
    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/commit`,
      csvFormData(VALID_CSV),
      opCookie,
    );
    expect(res.status).toBe(403);
  });

  it("returns invalid row reasons without raw on preview only", async () => {
    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/preview`,
      csvFormData(INVALID_CSV),
      adminCookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      parse: { validCount: number; invalidRows: Record<string, unknown>[] };
    };
    expect(body.parse.validCount).toBe(0);
    expect(body.parse.invalidRows.length).toBeGreaterThan(0);
    for (const row of body.parse.invalidRows) {
      expect(row).not.toHaveProperty("raw");
      expect(row).toHaveProperty("rowIndex");
      expect(row).toHaveProperty("reason");
      expect(row.reason).not.toMatch(/@/);
    }
  });
});

describe("GET /api/admin/events/:eventId/import/template", () => {
  it("returns CSV header row with attachment headers", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/import/template`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    expect(res.headers.get("content-disposition")).toMatch(/admitto-import-template\.csv/);
    const body = await res.text();
    expect(body).toBe(
      "first_name,last_name,email,ticket_type,company,department,external_uuid,qr_payload\n",
    );
  });

  it("rejects operator", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/import/template`,
      { headers: { Cookie: opCookie } },
    );
    expect(res.status).toBe(403);
  });
});
