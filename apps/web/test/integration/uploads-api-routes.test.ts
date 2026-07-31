import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { createApp } from "../../src/app.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/index.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const EMAIL_SUPER = "uploads-super@example.com";
const EMAIL_ADMIN = "uploads-admin@example.com";
const EMAIL_ADMIN_OTHER = "uploads-admin-other@example.com";
const PASSWORD = "uploads-pass-123";

const ORG_OTHER = "org-uploads-other";
const EVENT_OWN = "evt-uploads-own";
const EVENT_OTHER_ORG = "evt-uploads-other-org";
const EVENT_ARCHIVED = "evt-uploads-archived";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let uploadDir: string;
let superCookie = "";
let adminCookie = "";
let adminOtherCookie = "";

beforeAll(async () => {
  uploadDir = mkdtempSync(join(tmpdir(), "admitto-uploads-"));
  process.env.UPLOAD_DIR = uploadDir;

  prisma = createTestPrismaClient();
  const rateLimitStore = new InMemoryRateLimitStore();
  app = createApp({ prisma, rateLimitStore, adminDistRoot });

  const password_hash = await hashPassword(PASSWORD);
  await prisma.session.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_ADMIN_OTHER] } } },
  });
  await prisma.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_ADMIN_OTHER] } } },
  });
  await prisma.roleAssignment.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_ADMIN_OTHER] } } },
  });
  await prisma.user.deleteMany({
    where: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_ADMIN_OTHER] } },
  });
  await prisma.event.deleteMany({ where: { id: { in: [EVENT_OWN, EVENT_OTHER_ORG, EVENT_ARCHIVED] } } });
  await prisma.organization.deleteMany({ where: { id: ORG_OTHER } });

  const superUser = await prisma.user.create({ data: { email: EMAIL_SUPER, password_hash } });
  const adminUser = await prisma.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  const adminOtherUser = await prisma.user.create({
    data: { email: EMAIL_ADMIN_OTHER, password_hash },
  });
  const existingInstanceSuper = await prisma.roleAssignment.findFirst({
    where: { role: "superadmin", scope_type: "instance" },
    select: { id: true },
  });
  if (existingInstanceSuper) {
    await prisma.roleAssignment.update({
      where: { id: existingInstanceSuper.id },
      data: { user_id: superUser.id },
    });
  } else {
    await prisma.roleAssignment.create({
      data: { user_id: superUser.id, role: "superadmin", scope_type: "instance", scope_id: null },
    });
  }
  await prisma.roleAssignment.create({
    data: { user_id: adminUser.id, role: "admin", scope_type: "organization", scope_id: "org-uploads" },
  });
  await prisma.roleAssignment.create({
    data: { user_id: adminOtherUser.id, role: "admin", scope_type: "organization", scope_id: ORG_OTHER },
  });
  await prisma.organization.upsert({
    where: { id: "org-uploads" },
    create: { id: "org-uploads", name: "Uploads Org", slug: "uploads-org" },
    update: {},
  });
  await prisma.organization.upsert({
    where: { id: ORG_OTHER },
    create: { id: ORG_OTHER, name: "Uploads Org Other", slug: "uploads-org-other" },
    update: {},
  });
  await prisma.event.createMany({
    data: [
      {
        id: EVENT_OWN,
        title: "Uploads Own Event",
        slug: "uploads-own-event",
        date: new Date("2026-10-01T12:00:00.000Z"),
        organization_id: "org-uploads",
      },
      {
        id: EVENT_OTHER_ORG,
        title: "Uploads Other Org Event",
        slug: "uploads-other-org-event",
        date: new Date("2026-10-02T12:00:00.000Z"),
        organization_id: ORG_OTHER,
      },
      {
        id: EVENT_ARCHIVED,
        title: "Uploads Archived Event",
        slug: "uploads-archived-event",
        date: new Date("2026-10-03T12:00:00.000Z"),
        organization_id: "org-uploads",
        archived_at: new Date(),
      },
    ],
  });
  for (const userId of [superUser.id, adminUser.id, adminOtherUser.id]) {
    await prisma.userMfaMethod.create({
      data: {
        user_id: userId,
        type: "totp",
        secret_enc: encryptTotpSecret(generateTotpSecret()),
        confirmed_at: new Date(),
      },
    });
  }

  const superSession = await createSession(prisma, {
    userId: superUser.id,
    stage: SESSION_STAGE.FULL,
  });
  const adminSession = await createSession(prisma, {
    userId: adminUser.id,
    stage: SESSION_STAGE.FULL,
  });
  const adminOtherSession = await createSession(prisma, {
    userId: adminOtherUser.id,
    stage: SESSION_STAGE.FULL,
  });
  superCookie = `admitto_session=${superSession.rawToken}`;
  adminCookie = `admitto_session=${adminSession.rawToken}`;
  adminOtherCookie = `admitto_session=${adminOtherSession.rawToken}`;
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(uploadDir, { recursive: true, force: true });
  delete process.env.UPLOAD_DIR;
});

function uploadForm(file: Blob, filename: string): FormData {
  const fd = new FormData();
  fd.append("file", file, filename);
  return fd;
}

describe("POST /api/admin/uploads", () => {
  it("accepts PNG and returns public URL", async () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    const res = await app.request("/api/admin/uploads", {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
      body: uploadForm(new Blob([png], { type: "image/png" }), "logo.png"),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { url: string };
    expect(body.url).toMatch(/^\/uploads\/default\/[0-9a-f-]+\.png$/);

    const getRes = await app.request(body.url);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("content-type")).toBe("image/png");

    const superUser = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL_SUPER } });
    expect(
      await prisma.adminAuditLog.findFirst({
        where: { action_type: "org_branding_logo_uploaded", actor_user_id: superUser.id },
        orderBy: { created_at: "desc" },
      }),
    ).not.toBeNull();
  });

  it("returns 500 server error when an unexpected (non-validation) error occurs after a successful upload", async () => {
    const saved = process.env.INSTANCE_ORG_ID;
    process.env.INSTANCE_ORG_ID = "org-that-does-not-exist";
    try {
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
      const res = await app.request("/api/admin/uploads", {
        method: "POST",
        headers: { Cookie: superCookie, ...sameOrigin },
        body: uploadForm(new Blob([png], { type: "image/png" }), "logo.png"),
      });
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("server error");
    } finally {
      if (saved === undefined) delete process.env.INSTANCE_ORG_ID;
      else process.env.INSTANCE_ORG_ID = saved;
    }
  });

  it("rejects unsupported file type with 415", async () => {
    const res = await app.request("/api/admin/uploads", {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
      body: uploadForm(new Blob(["MZ"], { type: "application/octet-stream" }), "bad.exe"),
    });
    expect(res.status).toBe(415);
  });

  it("returns 403 for non-superadmin", async () => {
    const res = await app.request("/api/admin/uploads", {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin },
      body: uploadForm(new Blob([new Uint8Array(8)], { type: "image/png" }), "logo.png"),
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 file_required when the multipart body has no file field", async () => {
    const fd = new FormData();
    fd.append("not_a_file", "hello");
    const res = await app.request("/api/admin/uploads", {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
      body: fd,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("file_required");
  });

  it("returns 400 invalid_form_data for a body that fails to parse as multipart", async () => {
    const res = await app.request("/api/admin/uploads", {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "multipart/form-data" },
      body: "not actually multipart",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_form_data");
  });
});

describe("POST /api/admin/theme-font-upload", () => {
  it("returns 400 file_required when the multipart body has no file field", async () => {
    const fd = new FormData();
    fd.append("not_a_file", "hello");
    const res = await app.request("/api/admin/theme-font-upload", {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
      body: fd,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("file_required");
  });

  it("accepts WOFF2 and returns public URL, served back with the correct font MIME type", async () => {
    const woff2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0x00, 0x00, 0x00, 0x00]);
    const res = await app.request("/api/admin/theme-font-upload", {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
      body: uploadForm(new Blob([woff2], { type: "font/woff2" }), "Brand-Sans.woff2"),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { url: string };
    expect(body.url).toMatch(/^\/uploads\/default\/theme\/[0-9a-f-]+\.woff2$/);

    const getRes = await app.request(body.url);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("content-type")).toBe("font/woff2");

    const superUser = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL_SUPER } });
    expect(
      await prisma.adminAuditLog.findFirst({
        where: { action_type: "branding_font_uploaded", actor_user_id: superUser.id },
        orderBy: { created_at: "desc" },
      }),
    ).not.toBeNull();
  });

  it("rejects a file whose bytes don't match a font signature with 415", async () => {
    const res = await app.request("/api/admin/theme-font-upload", {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
      body: uploadForm(new Blob(["MZ"], { type: "font/woff2" }), "bad.woff2"),
    });
    expect(res.status).toBe(415);
  });

  it("returns 403 for non-superadmin", async () => {
    const woff2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0x00, 0x00, 0x00, 0x00]);
    const res = await app.request("/api/admin/theme-font-upload", {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin },
      body: uploadForm(new Blob([woff2], { type: "font/woff2" }), "Brand-Sans.woff2"),
    });
    expect(res.status).toBe(403);
  });

  it("returns 413 when the raw request body exceeds the font upload size limit", async () => {
    const oversized = new Uint8Array(6 * 1024 * 1024);
    const res = await app.request("/api/admin/theme-font-upload", {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
      body: uploadForm(new Blob([oversized], { type: "font/woff2" }), "big.woff2"),
    });
    expect(res.status).toBe(413);
  });
});

describe("POST /api/admin/events/:eventId/branding-upload", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

  it("returns 400 file_required when the multipart body has no file field", async () => {
    const fd = new FormData();
    fd.append("not_a_file", "hello");
    const res = await app.request(`/api/admin/events/${EVENT_OWN}/branding-upload`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
      body: fd,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("file_required");
  });

  it("accepts PNG for superadmin and scopes the URL under the event", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_OWN}/branding-upload`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
      body: uploadForm(new Blob([png], { type: "image/png" }), "logo.png"),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { url: string };
    expect(body.url).toMatch(
      new RegExp(`^/uploads/default/events/${EVENT_OWN}/[0-9a-f-]+\\.png$`),
    );

    const getRes = await app.request(body.url);
    expect(getRes.status).toBe(200);

    const superUser = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL_SUPER } });
    expect(
      await prisma.adminAuditLog.findFirst({
        where: { action_type: "event_branding_uploaded", actor_user_id: superUser.id },
        orderBy: { created_at: "desc" },
      }),
    ).toMatchObject({ metadata: { eventId: EVENT_OWN } });
  });

  it("accepts PNG for the org admin who manages the event (not superadmin-only)", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_OWN}/branding-upload`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin },
      body: uploadForm(new Blob([png], { type: "image/png" }), "logo.png"),
    });
    expect(res.status).toBe(201);
  });

  it("returns 403 for an admin of a different organization", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_OWN}/branding-upload`, {
      method: "POST",
      headers: { Cookie: adminOtherCookie, ...sameOrigin },
      body: uploadForm(new Blob([png], { type: "image/png" }), "logo.png"),
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 event_archived for an archived event", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_ARCHIVED}/branding-upload`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin },
      body: uploadForm(new Blob([png], { type: "image/png" }), "logo.png"),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("event_archived");
  });

  it("rejects unsupported file type with 415", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_OWN}/branding-upload`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin },
      body: uploadForm(new Blob(["MZ"], { type: "application/octet-stream" }), "bad.exe"),
    });
    expect(res.status).toBe(415);
  });

  it("returns 404 for a non-existent event", async () => {
    const res = await app.request("/api/admin/events/evt-uploads-missing/branding-upload", {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
      body: uploadForm(new Blob([png], { type: "image/png" }), "logo.png"),
    });
    expect(res.status).toBe(404);
  });
});
