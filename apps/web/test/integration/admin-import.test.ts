import { dirname, join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient, Prisma } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { drainImportJobs } from "@admitto/import";
import { getDefaultStorage, resetDefaultStorageForTests } from "@admitto/storage";
import { buildXlsxBuffer } from "../../src/admin/xlsx-to-csv.js";
import { createApp } from "../../src/app.js";
import { CAPACITY_EXCLUDED_STATUSES } from "../../src/admin/event-capacity.js";
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
let uploadDir = "";
let prevUploadDir: string | undefined;

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

type ImportCommitResultBody = {
  importId: string;
  toCreate?: number;
  toUpdate?: number;
  toSkip?: number;
  created: number;
  updated: number;
  skipped: { email: string; reason: string }[];
  invalidRows?: { rowIndex: number; reason: string }[];
  invalidCount?: number;
};

/**
 * Enqueue commit (202), drain worker jobs, return job result payload.
 * Non-202 responses (403/409/…) are returned as-is without draining.
 */
async function postCommitAndDrain(
  eventId: string,
  formData: FormData,
  cookie: string,
  force = false,
): Promise<{ status: number; body: Record<string, unknown>; result: ImportCommitResultBody | null }> {
  const forceQuery = force ? "?force=1" : "";
  const res = await postImport(
    `/api/admin/events/${eventId}/import/commit${forceQuery}`,
    formData,
    cookie,
  );
  const body = (await res.json()) as Record<string, unknown>;
  if (res.status !== 202) {
    return { status: res.status, body, result: null };
  }

  const jobId = String(body.jobId);
  const drained = await drainImportJobs(prisma, getDefaultStorage(), { limit: 10 });
  expect(drained.claimed).toBeGreaterThanOrEqual(1);

  const statusRes = await app.request(
    `/api/admin/events/${eventId}/import/jobs/${encodeURIComponent(jobId)}`,
    { headers: { Cookie: cookie } },
  );
  expect(statusRes.status).toBe(200);
  const statusBody = (await statusRes.json()) as {
    status: string;
    error: string | null;
    result: ImportCommitResultBody | null;
  };
  expect(statusBody.status).toBe("succeeded");
  expect(statusBody.result).not.toBeNull();
  return { status: 202, body, result: statusBody.result };
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

  await client.eventItem.create({
    data: { event_id: EVENT_A, key: "swag", label: "Swag pack" },
  });
  await client.eventCustomField.createMany({
    data: [
      { event_id: EVENT_A, source_field: "sock_size", label: "Sock size" },
      {
        event_id: EVENT_A,
        source_field: "cap_size",
        label: "Cap size",
        type: "select",
        options: ["S", "M", "L"],
      },
    ],
  });
  await client.ticketType.createMany({
    data: [
      { event_id: EVENT_A, key: "standard", label: "Standard", sort_order: 0 },
      { event_id: EVENT_A, key: "vip", label: "VIP", color: "purple", sort_order: 1 },
    ],
  });
}

/** Create a full-session cookie string for the given user id. */
async function sessionCookieFor(userId: string): Promise<string> {
  const { rawToken } = await createSession(prisma, { userId, stage: SESSION_STAGE.FULL });
  return `admitto_session=${rawToken}`;
}

beforeAll(async () => {
  uploadDir = await mkdtemp(join(tmpdir(), "admitto-import-"));
  prevUploadDir = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = uploadDir;
  resetDefaultStorageForTests();

  prisma = createTestPrismaClient();
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

beforeEach(async () => {
  rateLimitStore.reset();
  await prisma.adminJob.deleteMany({
    where: { event_id: { in: [EVENT_A, EVENT_B] } },
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
  if (prevUploadDir === undefined) delete process.env.UPLOAD_DIR;
  else process.env.UPLOAD_DIR = prevUploadDir;
  resetDefaultStorageForTests();
  if (uploadDir) await rm(uploadDir, { recursive: true, force: true });
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

  // PII/log-leak fix (code review): "Unknown ticket type: <value>" had no sanitizePreviewReason
  // case, so groupInvalidByType derived its structured-log key straight from the raw CSV cell
  // value. The client-facing reason must keep showing that value (it's the admin's own upload,
  // not a log-leak concern) while the aggregated log key must not.
  it("redacts unknown-ticket-type values from the aggregated log key but not the client-facing reason", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const csv = [
        "first_name,last_name,email,ticket_type",
        "Sec,Ret,secret-value@example.com,TotallyBogusType",
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
      expect(body.parse.invalidRows).toHaveLength(1);
      expect(body.parse.invalidRows[0]!.reason).toBe('Unknown ticket type: "TotallyBogusType"');

      const logEntries = spy.mock.calls
        .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
        .filter((entry) => entry.msg === "Import preview complete");
      expect(logEntries).toHaveLength(1);
      const invalidByType = logEntries[0]!.invalidByType as Record<string, number>;
      expect(invalidByType.unknown_ticket_type).toBe(1);
      expect(JSON.stringify(invalidByType)).not.toMatch(/bogus/i);
    } finally {
      spy.mockRestore();
    }
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

  it("sanitizes duplicate-column warnings", async () => {
    const csv = [
      "first_name,last_name,email,email",
      "Jane,Example,jane@example.com,jane@example.com",
    ].join("\n");
    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/preview`,
      csvFormData(csv),
      adminCookie,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { parse: { warnings: string[] } };
    expect(body.parse.warnings).toContain("Duplicate column(s) detected");
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
      summary: { toCreate: number; toSkip: number; skipped: { email: string; reason: string }[] };
    };
    expect(body.summary.toCreate).toBe(1);
    expect(body.summary.toSkip).toBe(1);
    // The preview and commit endpoints must agree on why a row was skipped — an operator
    // deciding whether to turn on Overwrite reads this before ever reaching commit.
    expect(body.summary.skipped).toEqual([
      {
        email: "existing@example.com",
        reason: 'Attendee already exists. Turn on "Overwrite existing attendees" to update it instead of skipping',
      },
    ]);
  });

  it("caps skipped-row detail in the response, reporting the true total separately (CodeRabbit review)", async () => {
    // A re-import of a file where every row is already an existing attendee (overwrite off) - the
    // scenario that could otherwise put thousands of email/reason pairs in one response.
    const count = 25;
    const emails = Array.from({ length: count }, (_, i) => `cap-skip-${i}@example.com`);
    await prisma.attendee.createMany({
      data: emails.map((email, i) => ({
        event_id: EVENT_A,
        email,
        name: `Cap Skip ${i}`,
      })),
    });

    const csv = [
      "first_name,last_name,email",
      ...emails.map((email, i) => `Cap,Skip ${i},${email}`),
    ].join("\n");

    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/preview`,
      csvFormData(csv),
      adminCookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: { toSkip: number; skipped: { email: string; reason: string }[] };
    };
    expect(body.summary.toSkip).toBe(count);
    expect(body.summary.skipped).toHaveLength(20);

    await prisma.attendee.deleteMany({ where: { email: { in: emails } } });
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

  it("parses custom attribute columns into custom_data", async () => {
    const csv = [
      "first_name,last_name,email,sock_size,cap_size",
      "Gina,Gear,gina@example.com,42,L",
    ].join("\n");
    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/preview`,
      csvFormData(csv),
      adminCookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { parse: { validCount: number }; summary: { toCreate: number } };
    expect(body.parse.validCount).toBe(1);
    expect(body.summary.toCreate).toBe(1);
  });

  it("rejects invalid custom attribute values in preview", async () => {
    const csv = [
      "first_name,last_name,email,cap_size",
      "Bad,Cap,bad@example.com,XL",
    ].join("\n");
    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/preview`,
      csvFormData(csv),
      adminCookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      parse: { validCount: number; invalidRows: { reason: string }[] };
    };
    expect(body.parse.validCount).toBe(0);
    expect(body.parse.invalidRows[0]?.reason).toMatch(/invalid value/i);
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

  type PreviewBody = {
    importId: string;
    parse: { validCount: number; invalidRows: { rowIndex: number; reason: string }[]; warnings: string[] };
    summary: { toCreate: number; toUpdate: number; toSkip: number };
    sampleRows: Array<{
      rowIndex: number;
      name: string;
      email: string;
      ticket_type: string;
      company: string;
      department: string;
      external_uuid: string;
      custom_data: Record<string, string>;
    }>;
    attributeFieldLabels: Array<{ source_field: string; label: string }>;
  };

  function validRowsCsv(count: number): string {
    const header = "first_name,last_name,email";
    const rows = Array.from(
      { length: count },
      (_, i) => `User${i},Test${i},sample${i}@example.com`,
    );
    return [header, ...rows].join("\n");
  }

  it("returns sampleRows capped at 20 for large valid files", async () => {
    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/preview`,
      csvFormData(validRowsCsv(25)),
      adminCookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as PreviewBody;
    expect(body.parse.validCount).toBe(25);
    expect(body.sampleRows).toHaveLength(20);
    expect(body.sampleRows[0]!.email).toBe("sample0@example.com");
    expect(body.sampleRows[19]!.email).toBe("sample19@example.com");
  });

  it("returns all sampleRows when fewer than 20 valid rows", async () => {
    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/preview`,
      csvFormData(validRowsCsv(5)),
      adminCookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as PreviewBody;
    expect(body.sampleRows).toHaveLength(5);
  });

  it("returns empty sampleRows when no valid rows", async () => {
    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/preview`,
      csvFormData(INVALID_CSV),
      adminCookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as PreviewBody;
    expect(body.parse.validCount).toBe(0);
    expect(body.sampleRows).toEqual([]);
  });

  it("includes shaped sampleRows with joined name and empty optional fields", async () => {
    const csv = ["first_name,last_name,email", "Jan,Kowalski,jan@example.com"].join("\n");
    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/preview`,
      csvFormData(csv),
      adminCookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as PreviewBody;
    expect(body.sampleRows).toHaveLength(1);
    const row = body.sampleRows[0]!;
    expect(row).toMatchObject({
      rowIndex: 1,
      name: "Jan Kowalski",
      email: "jan@example.com",
      ticket_type: "",
      company: "",
      department: "",
      external_uuid: "",
      custom_data: { sock_size: "", cap_size: "" },
    });
    expect(body.importId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.summary).toMatchObject({ toCreate: 1, toUpdate: 0, toSkip: 0 });
  });

  it("preserves file rowIndex in sampleRows when invalid rows appear between valid rows", async () => {
    const csv = [
      "first_name,last_name,email",
      "Jan,Kowalski,jan@example.com",
      "Bad,,bad@example.com",
      "Eve,Example,eve@example.com",
    ].join("\n");
    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/preview`,
      csvFormData(csv),
      adminCookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as PreviewBody;
    expect(body.sampleRows).toHaveLength(2);
    expect(body.sampleRows[0]!.rowIndex).toBe(1);
    expect(body.sampleRows[1]!.rowIndex).toBe(3);
    expect(body.parse.invalidRows[0]!.rowIndex).toBe(2);
  });

  it("returns custom_data and attributeFieldLabels in sampleRows", async () => {
    const csv = [
      "first_name,last_name,email,sock_size,cap_size",
      "Gina,Gear,gina@example.com,42,L",
    ].join("\n");
    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/preview`,
      csvFormData(csv),
      adminCookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as PreviewBody;
    expect(body.sampleRows[0]!.custom_data).toEqual({ sock_size: "42", cap_size: "L" });
    expect(body.attributeFieldLabels).toEqual(
      expect.arrayContaining([
        { source_field: "sock_size", label: "Sock size" },
        { source_field: "cap_size", label: "Cap size" },
      ]),
    );
  });
});

describe("POST /api/admin/events/:eventId/import/commit", () => {
  async function withSavedEventCapacity(
    capacity: number | null,
    run: () => Promise<void>,
  ): Promise<void> {
    const prior = await prisma.event.findUnique({
      where: { id: EVENT_A },
      select: { capacity: true },
    });
    await prisma.event.update({ where: { id: EVENT_A }, data: { capacity } });
    try {
      await run();
    } finally {
      await prisma.event.update({
        where: { id: EVENT_A },
        data: { capacity: prior?.capacity ?? null },
      });
    }
  }

  it("creates attendees and writes bulk audit without PII", async () => {
    await prisma.attendeeActionLog.deleteMany({ where: { event_id: EVENT_A } });
    await prisma.attendee.deleteMany({
      where: { event_id: EVENT_A, id: { not: EXISTING_ATT } },
    });

    const { status, body, result } = await postCommitAndDrain(
      EVENT_A,
      csvFormData(VALID_CSV, "batch.csv"),
      adminCookie,
    );
    expect(status).toBe(202);
    expect(String(body.importId)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(result!.created).toBe(2);

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

  it("persists custom_data from attribute columns on create", async () => {
    await prisma.attendee.deleteMany({
      where: { event_id: EVENT_A, email: "swag@example.com" },
    });

    const csv = [
      "first_name,last_name,email,sock_size,cap_size",
      "Swag,User,swag@example.com,39,M",
    ].join("\n");
    const { status, result } = await postCommitAndDrain(
      EVENT_A,
      csvFormData(csv, "swag.csv"),
      adminCookie,
    );
    expect(status).toBe(202);
    expect(result!.created).toBe(1);

    const row = await prisma.attendee.findFirst({
      where: { event_id: EVENT_A, email: "swag@example.com" },
    });
    expect(row?.custom_data).toEqual({ sock_size: "39", cap_size: "M" });
  });

  it("re-import overwrite=false skips all existing", async () => {
    const { status, result } = await postCommitAndDrain(
      EVENT_A,
      csvFormData(VALID_CSV),
      adminCookie,
    );
    expect(status).toBe(202);
    expect(result!.created).toBe(0);
    expect(result!.updated).toBe(0);
    expect(result!.skipped).toHaveLength(2);
    expect(result!.skipped.every((s) => s.reason.includes("Overwrite existing attendees"))).toBe(true);
  });

  it("caps skipped-row detail on commit too, reporting the true total separately (CodeRabbit review)", async () => {
    const count = 25;
    const emails = Array.from({ length: count }, (_, i) => `cap-commit-skip-${i}@example.com`);
    await prisma.attendee.createMany({
      data: emails.map((email, i) => ({
        event_id: EVENT_A,
        email,
        name: `Cap Commit Skip ${i}`,
      })),
    });

    const csv = [
      "first_name,last_name,email",
      ...emails.map((email, i) => `Cap,Commit ${i},${email}`),
    ].join("\n");

    const { status, result } = await postCommitAndDrain(
      EVENT_A,
      csvFormData(csv),
      adminCookie,
    );
    expect(status).toBe(202);
    expect(result!.toSkip).toBe(count);
    expect(result!.skipped).toHaveLength(20);

    await prisma.attendee.deleteMany({ where: { email: { in: emails } } });
  });

  it("re-import overwrite=true updates profile fields", async () => {
    const updatedCsv = [
      "first_name,last_name,email,company",
      "Eve,Updated,eve@example.com,New Co",
      "Frank,Updated,frank@example.com,New Ltd",
    ].join("\n");

    const { status, result } = await postCommitAndDrain(
      EVENT_A,
      csvFormData(updatedCsv, "update.csv", true),
      adminCookie,
    );
    expect(status).toBe(202);
    expect(result!.updated).toBe(2);

    const eve = await prisma.attendee.findFirst({
      where: { event_id: EVENT_A, email: "eve@example.com" },
    });
    expect(eve?.name).toBe("Eve Updated");
    expect(eve?.company).toBe("New Co");
  });

  it("overwrite=true updates profile when required attributes exist only in DB", async () => {
    await prisma.attendee.update({
      where: { id: EXISTING_ATT },
      data: { custom_data: { cap_size: "M" } },
    });
    await prisma.eventCustomField.update({
      where: { event_id_source_field: { event_id: EVENT_A, source_field: "cap_size" } },
      data: { required: true },
    });

    const csv = [
      "first_name,last_name,email,company",
      "Existing,Person,existing@example.com,Updated Co",
    ].join("\n");
    const { status, result } = await postCommitAndDrain(
      EVENT_A,
      csvFormData(csv, "existing-overwrite.csv", true),
      adminCookie,
    );
    expect(status).toBe(202);
    expect(result!.updated).toBe(1);

    const row = await prisma.attendee.findUniqueOrThrow({ where: { id: EXISTING_ATT } });
    expect(row.company).toBe("Updated Co");
    expect(row.custom_data).toEqual({ cap_size: "M" });

    await prisma.eventCustomField.update({
      where: { event_id_source_field: { event_id: EVENT_A, source_field: "cap_size" } },
      data: { required: false },
    });
    await prisma.attendee.update({
      where: { id: EXISTING_ATT },
      data: { custom_data: {} },
    });
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

  it("caps invalid-row detail in the response, reporting the true total separately (CodeRabbit review)", async () => {
    const count = 25;
    const csv = [
      "first_name,last_name,email",
      ...Array.from({ length: count }, (_, i) => `Missing,Email ${i},`),
    ].join("\n");

    const res = await postImport(
      `/api/admin/events/${EVENT_A}/import/preview`,
      csvFormData(csv),
      adminCookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      parse: { invalidCount: number; invalidRows: unknown[] };
    };
    expect(body.parse.invalidCount).toBe(count);
    expect(body.parse.invalidRows).toHaveLength(20);
  });

  // TOCTOU regression: a row valid at preview time can become invalid by commit time if the
  // catalog changes in between (e.g. someone deletes the ticket type it references). The commit
  // handler re-parses with the current catalog and must surface that row as invalid rather than
  // silently dropping it from created/updated/skipped with no trace.
  it("reports rows invalidated by a ticket-type catalog change between preview and commit", async () => {
    const raceType = await prisma.ticketType.create({
      data: { event_id: EVENT_A, key: "race-vip", label: "Race VIP", sort_order: 99 },
    });
    try {
      const csv = [
        "first_name,last_name,email,ticket_type",
        "Race,Condition,race-vip@example.com,race-vip",
      ].join("\n");

      // Preview sees the row as valid while the catalog still has the type.
      const previewRes = await postImport(
        `/api/admin/events/${EVENT_A}/import/preview`,
        csvFormData(csv),
        adminCookie,
      );
      expect(previewRes.status).toBe(200);
      const previewBody = (await previewRes.json()) as { parse: { validCount: number } };
      expect(previewBody.parse.validCount).toBe(1);

      // Simulate the race: someone deletes the ticket type before the admin clicks Commit.
      await prisma.ticketType.delete({ where: { id: raceType.id } });

      const { status, result } = await postCommitAndDrain(
        EVENT_A,
        csvFormData(csv, "race.csv"),
        adminCookie,
      );
      expect(status).toBe(202);
      const body = result!;

      expect(body.created).toBe(0);
      expect(body.updated).toBe(0);
      expect(body.skipped).toHaveLength(0);
      expect(body.invalidRows).toHaveLength(1);
      expect(body.invalidRows![0]!.rowIndex).toBe(1);
      expect(body.invalidRows![0]!.reason).toBe('Unknown ticket type: "race-vip"');

      const attendee = await prisma.attendee.findFirst({
        where: { event_id: EVENT_A, email: "race-vip@example.com" },
      });
      expect(attendee).toBeNull();
    } finally {
      await prisma.attendee.deleteMany({
        where: { event_id: EVENT_A, email: "race-vip@example.com" },
      });
    }
  });

  // Closes a narrower window than the test above: here the type still exists when commit loads
  // its pre-transaction catalog snapshot, and is deleted by a genuinely concurrent request while
  // commit's own transaction is already in flight - the transaction's lock-protected recheck
  // (not the outer re-parse, which never sees this delete at all) must be what excludes the row
  // (Codex review).
  it("never orphans an attendee when a ticket type is deleted concurrently with an import commit", async () => {
    const raceType = await prisma.ticketType.create({
      data: { event_id: EVENT_A, key: "concurrent-vip", label: "Concurrent VIP", sort_order: 98 },
    });
    const csv = [
      "first_name,last_name,email,ticket_type",
      "Concurrent,Race,concurrent-vip@example.com,concurrent-vip",
    ].join("\n");

    try {
      const enqueueRes = await postImport(
        `/api/admin/events/${EVENT_A}/import/commit`,
        csvFormData(csv, "concurrent.csv"),
        adminCookie,
      );
      expect(enqueueRes.status).toBe(202);
      const queued = (await enqueueRes.json()) as { jobId: string };

      // Race the worker execute path against a concurrent ticket-type delete.
      const [drained, deleteRes] = await Promise.all([
        drainImportJobs(prisma, getDefaultStorage(), { limit: 1 }),
        app.request(`/api/admin/events/${EVENT_A}/ticket-types/${raceType.id}`, {
          method: "DELETE",
          headers: { Cookie: adminCookie, ...sameOrigin },
        }),
      ]);
      expect(drained.claimed).toBe(1);

      const statusRes = await app.request(
        `/api/admin/events/${EVENT_A}/import/jobs/${queued.jobId}`,
        { headers: { Cookie: adminCookie } },
      );
      expect(statusRes.status).toBe(200);
      const statusBody = (await statusRes.json()) as {
        status: string;
        result: {
          created: number;
          invalidRows: { rowIndex: number; reason: string }[];
        } | null;
      };
      expect(statusBody.status).toBe("succeeded");
      const body = statusBody.result!;

      const attendee = await prisma.attendee.findFirst({
        where: { event_id: EVENT_A, email: "concurrent-vip@example.com" },
      });

      // Whichever side of the race won the advisory lock first, the outcome must be consistent:
      // either the delete lost (409, blocked by the newly-created attendee) and the import
      // created it normally, or the delete won and the import excluded the row - never both an
      // attendee referencing the now-gone type AND a successful delete.
      if (deleteRes.status === 200) {
        expect(body.created).toBe(0);
        expect(body.invalidRows).toHaveLength(1);
        expect(body.invalidRows[0]!.reason).toBe('Unknown ticket type: "concurrent-vip"');
        expect(attendee).toBeNull();
      } else {
        expect(deleteRes.status).toBe(409);
        expect(body.created).toBe(1);
        expect(attendee?.ticket_type).toBe("concurrent-vip");
      }
    } finally {
      await prisma.attendee.deleteMany({
        where: { event_id: EVENT_A, email: "concurrent-vip@example.com" },
      });
      await prisma.ticketType.deleteMany({ where: { id: raceType.id } });
    }
  });

  it("returns 409 event_full when import would exceed capacity", async () => {
    const current = await prisma.attendee.count({
      where: { event_id: EVENT_A, status: { notIn: [...CAPACITY_EXCLUDED_STATUSES] } },
    });
    const csv = [
      "first_name,last_name,email",
      "New,One,cap-one@example.com",
      "New,Two,cap-two@example.com",
    ].join("\n");
    await withSavedEventCapacity(current, async () => {
      const res = await postImport(
        `/api/admin/events/${EVENT_A}/import/commit`,
        csvFormData(csv),
        adminCookie,
      );
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code: string; projected: number };
      expect(body.code).toBe("event_full");
      expect(body.projected).toBeGreaterThan(current);
    });
    await prisma.attendee.deleteMany({
      where: { event_id: EVENT_A, email: { in: ["cap-one@example.com", "cap-two@example.com"] } },
    });
  });

  it("allows overwrite-only import when event is already over capacity", async () => {
    const current = await prisma.attendee.count({
      where: { event_id: EVENT_A, status: { notIn: [...CAPACITY_EXCLUDED_STATUSES] } },
    });
    expect(current).toBeGreaterThan(0);
    const csv = ["first_name,last_name,email", "Updated,Name,existing@example.com"].join("\n");
    await withSavedEventCapacity(current - 1, async () => {
      const { status } = await postCommitAndDrain(
        EVENT_A,
        csvFormData(csv, "overwrite.csv", true),
        adminCookie,
      );
      expect(status).toBe(202);
    });
  });

  it("allows import within capacity when one slot remains", async () => {
    const current = await prisma.attendee.count({
      where: { event_id: EVENT_A, status: { notIn: [...CAPACITY_EXCLUDED_STATUSES] } },
    });
    const csv = ["first_name,last_name,email", "Slot,Left,slot-left@example.com"].join("\n");
    await withSavedEventCapacity(current + 1, async () => {
      const { status } = await postCommitAndDrain(
        EVENT_A,
        csvFormData(csv),
        adminCookie,
      );
      expect(status).toBe(202);
    });
    await prisma.attendee.deleteMany({
      where: { event_id: EVENT_A, email: "slot-left@example.com" },
    });
  });

  it("allows superadmin force=1 when import would exceed capacity", async () => {
    const password_hash = await hashPassword(PASSWORD);
    const superEmail = "admin-import-super@example.com";
    await prisma.session.deleteMany({ where: { user: { email: superEmail } } });
    await prisma.userMfaMethod.deleteMany({ where: { user: { email: superEmail } } });
    await prisma.roleAssignment.deleteMany({ where: { user: { email: superEmail } } });
    await prisma.user.deleteMany({ where: { email: superEmail } });
    const priorSuper = await prisma.roleAssignment.findFirst({
      where: { role: "superadmin", scope_type: "instance" },
      select: { id: true, user_id: true },
    });
    const superUser = await prisma.user.create({ data: { email: superEmail, password_hash } });
    try {
      if (priorSuper) {
        await prisma.roleAssignment.update({
          where: { id: priorSuper.id },
          data: { user_id: superUser.id },
        });
      } else {
        await prisma.roleAssignment.create({
          data: {
            user_id: superUser.id,
            role: "superadmin",
            scope_type: "instance",
            scope_id: null,
          },
        });
      }
      await prisma.userMfaMethod.create({
        data: {
          user_id: superUser.id,
          type: "totp",
          secret_enc: encryptTotpSecret(generateTotpSecret()),
          confirmed_at: new Date(),
        },
      });
      const superCookie = await sessionCookieFor(superUser.id);
      const current = await prisma.attendee.count({
        where: { event_id: EVENT_A, status: { notIn: [...CAPACITY_EXCLUDED_STATUSES] } },
      });
      const csv = [
        "first_name,last_name,email",
        "Forced,One,force-import-one@example.com",
        "Forced,Two,force-import-two@example.com",
      ].join("\n");
      await withSavedEventCapacity(current, async () => {
        const { status, body } = await postCommitAndDrain(
          EVENT_A,
          csvFormData(csv, "force.csv"),
          superCookie,
          true,
        );
        expect(status).toBe(202);
        const job = await prisma.adminJob.findUniqueOrThrow({
          where: { id: String(body.jobId) },
        });
        expect(job.force_capacity).toBe(true);
        expect(job.client_timezone).toBeNull();
      });
    } finally {
      await prisma.attendee.deleteMany({
        where: {
          event_id: EVENT_A,
          email: { in: ["force-import-one@example.com", "force-import-two@example.com"] },
        },
      });
      if (priorSuper) {
        await prisma.roleAssignment.update({
          where: { id: priorSuper.id },
          data: { user_id: priorSuper.user_id },
        });
      } else {
        await prisma.roleAssignment.deleteMany({
          where: { user_id: superUser.id, role: "superadmin", scope_type: "instance" },
        });
      }
      await prisma.session.deleteMany({ where: { user_id: superUser.id } });
      await prisma.userMfaMethod.deleteMany({ where: { user_id: superUser.id } });
      await prisma.roleAssignment.deleteMany({ where: { user_id: superUser.id } });
      await prisma.user.delete({ where: { id: superUser.id } });
    }
  });

  it("stores client timezone on the queued job when the header is valid", async () => {
    const csv = ["first_name,last_name,email", "Tz,Guest,tz-guest@example.com"].join("\n");
    const res = await app.request(`/api/admin/events/${EVENT_A}/import/commit`, {
      method: "POST",
      headers: {
        Cookie: adminCookie,
        ...sameOrigin,
        "x-client-timezone": "Europe/Warsaw",
      },
      body: csvFormData(csv, "tz.csv"),
    });
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: string };
    const job = await prisma.adminJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.client_timezone).toBe("Europe/Warsaw");
    expect(job.force_capacity).toBe(false);
    await drainImportJobs(prisma, getDefaultStorage(), { limit: 5 });
    await prisma.attendee.deleteMany({
      where: { event_id: EVENT_A, email: "tz-guest@example.com" },
    });
  });
});

describe("GET /api/admin/events/:eventId/import/jobs/:jobId", () => {
  it("returns 400/404 for blank and unknown job ids", async () => {
    const blank = await app.request(`/api/admin/events/${EVENT_A}/import/jobs/%20`, {
      headers: { Cookie: adminCookie },
    });
    expect(blank.status).toBe(400);
    expect(await blank.json()).toEqual({ error: "jobId required" });

    const missing = await app.request(`/api/admin/events/${EVENT_A}/import/jobs/does-not-exist`, {
      headers: { Cookie: adminCookie },
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not_found" });
  });

  it("returns 403 for operators and null result while pending or failed", async () => {
    const csv = ["first_name,last_name,email", "Pending,Job,pending-job@example.com"].join("\n");
    const queued = await postImport(
      `/api/admin/events/${EVENT_A}/import/commit`,
      csvFormData(csv, "pending.csv"),
      adminCookie,
    );
    expect(queued.status).toBe(202);
    const { jobId } = (await queued.json()) as { jobId: string };

    const forbidden = await app.request(`/api/admin/events/${EVENT_A}/import/jobs/${jobId}`, {
      headers: { Cookie: opCookie },
    });
    expect(forbidden.status).toBe(403);

    const pending = await app.request(`/api/admin/events/${EVENT_A}/import/jobs/${jobId}`, {
      headers: { Cookie: adminCookie },
    });
    expect(pending.status).toBe(200);
    expect(await pending.json()).toMatchObject({
      jobId,
      status: "pending",
      result: null,
    });
    expect(pending.headers.get("Cache-Control")).toBe("no-store");

    await prisma.adminJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        error: "boom",
        result_json: Prisma.DbNull,
        finished_at: new Date(),
      },
    });
    const failed = await app.request(`/api/admin/events/${EVENT_A}/import/jobs/${jobId}`, {
      headers: { Cookie: adminCookie },
    });
    expect(await failed.json()).toMatchObject({
      status: "failed",
      error: "boom",
      result: null,
    });

    await prisma.adminJob.update({
      where: { id: jobId },
      data: { status: "succeeded", error: null, result_json: "oops" },
    });
    const badJson = await app.request(`/api/admin/events/${EVENT_A}/import/jobs/${jobId}`, {
      headers: { Cookie: adminCookie },
    });
    expect(((await badJson.json()) as { result: unknown }).result).toBeNull();

    await prisma.adminJob.update({
      where: { id: jobId },
      data: { status: "succeeded", error: null, result_json: ["not-an-object"] },
    });
    const arrayJson = await app.request(`/api/admin/events/${EVENT_A}/import/jobs/${jobId}`, {
      headers: { Cookie: adminCookie },
    });
    expect(((await arrayJson.json()) as { result: unknown }).result).toBeNull();
  });
});

describe("GET /api/admin/events/:eventId/import/template", () => {
  it("returns CSV header row with base columns and event attribute slugs", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/import/template`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    expect(res.headers.get("content-disposition")).toMatch(/admitto-import-template\.csv/);
    const body = await res.text();
    expect(body).toBe(
      "first_name,last_name,email,ticket_type,company,department,external_uuid,qr_payload,sock_size,cap_size\n",
    );
  });

  it("rejects operator", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_A}/import/template`,
      { headers: { Cookie: opCookie } },
    );
    expect(res.status).toBe(403);
  });

  it("ignores reserved source_field slugs when building attribute columns", async () => {
    await prisma.eventCustomField.create({
      data: { event_id: EVENT_A, source_field: "email", label: "Email copy" },
    });

    const res = await app.request(
      `/api/admin/events/${EVENT_A}/import/template`,
      { headers: { Cookie: adminCookie } },
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe(
      "first_name,last_name,email,ticket_type,company,department,external_uuid,qr_payload,sock_size,cap_size\n",
    );
    expect(body.match(/email/g)?.length).toBe(1);

    await prisma.eventCustomField.delete({
      where: { event_id_source_field: { event_id: EVENT_A, source_field: "email" } },
    });
  });
});

describe("GET /api/admin/events/:eventId/import/history", () => {
  afterAll(async () => {
    await prisma.adminJob.deleteMany({
      where: { event_id: { in: [EVENT_A, EVENT_B] }, type: "import_commit" },
    });
  });

  it("returns terminal import jobs newest-first including failed/reclaimed", async () => {
    await prisma.adminJob.deleteMany({
      where: { event_id: EVENT_A, type: "import_commit" },
    });
    await prisma.adminJob.createMany({
      data: [
        {
          type: "import_commit",
          status: "succeeded",
          organization_id: ORG_A,
          event_id: EVENT_A,
          filename: "first.csv",
          created_count: 10,
          updated_count: 2,
          skipped_count: 1,
          created_at: new Date("2026-06-01T10:00:00Z"),
          finished_at: new Date("2026-06-01T10:01:00Z"),
        },
        {
          type: "import_commit",
          status: "failed",
          organization_id: ORG_A,
          event_id: EVENT_A,
          filename: "broken.csv",
          error: "Import job abandoned (worker stopped while running). Upload the file again.",
          // Older created_at than second.xlsx, but later finished_at (reclaim) → first in list.
          created_at: new Date("2026-06-02T09:00:00Z"),
          finished_at: new Date("2026-06-03T12:00:00Z"),
        },
        {
          type: "import_commit",
          status: "succeeded",
          organization_id: ORG_A,
          event_id: EVENT_A,
          filename: "second.xlsx",
          created_count: 5,
          updated_count: 0,
          skipped_count: 0,
          created_at: new Date("2026-06-03T10:00:00Z"),
          finished_at: new Date("2026-06-03T10:01:00Z"),
        },
        // Pending / other events never leak into the history.
        {
          type: "import_commit",
          status: "pending",
          organization_id: ORG_A,
          event_id: EVENT_A,
          filename: "still-pending.csv",
        },
        {
          type: "import_commit",
          status: "succeeded",
          organization_id: ORG_B,
          event_id: EVENT_B,
          filename: "other-event.csv",
          created_count: 99,
        },
      ],
    });

    const res = await app.request(`/api/admin/events/${EVENT_A}/import/history`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(3);
    expect(body.items[0]).toMatchObject({
      filename: "broken.csv",
      status: "failed",
      error: expect.stringMatching(/abandoned/i),
    });
    expect(body.items[1]).toMatchObject({
      filename: "second.xlsx",
      created: 5,
      updated: 0,
      skipped: 0,
      status: "succeeded",
      error: null,
    });
    expect(body.items[2]).toMatchObject({ filename: "first.csv", created: 10, updated: 2, skipped: 1 });
    expect(typeof body.items[0]!.created_at).toBe("string");
  });

  it("tolerates succeeded jobs with missing count columns", async () => {
    await prisma.adminJob.deleteMany({
      where: { event_id: EVENT_A, type: "import_commit" },
    });
    await prisma.adminJob.create({
      data: {
        type: "import_commit",
        status: "succeeded",
        organization_id: ORG_A,
        event_id: EVENT_A,
        result_json: { created: 3 },
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT_A}/import/history`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(body.items[0]).toMatchObject({
      filename: null,
      created: 3,
      updated: 0,
      skipped: 0,
      status: "succeeded",
    });
  });

  it("returns 403 for an operator and for an admin outside the event's organization", async () => {
    const opRes = await app.request(`/api/admin/events/${EVENT_A}/import/history`, {
      headers: { Cookie: opCookie },
    });
    expect(opRes.status).toBe(403);

    const crossRes = await app.request(`/api/admin/events/${EVENT_B}/import/history`, {
      headers: { Cookie: adminCookie },
    });
    expect(crossRes.status).toBe(403);
  });
});
