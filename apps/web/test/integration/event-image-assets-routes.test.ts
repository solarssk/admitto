import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_IA = "org-img-assets";
const ORG_IA_OTHER = "org-img-assets-other";
const EVENT_IA = "evt-img-assets";
const EVENT_IA_OTHER_ORG = "evt-img-assets-other-org";
const EVENT_IA_ARCHIVED = "evt-img-assets-archived";
const EVENT_IA_LIMIT = "evt-img-assets-limit";

const EMAIL_SUPER = "img-assets-super@example.com";
const EMAIL_ADMIN = "img-assets-admin@example.com";
const EMAIL_ADMIN_OTHER = "img-assets-admin-other@example.com";
const EMAIL_OP = "img-assets-op@example.com";
const PASSWORD = "img-assets-pass-123";

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let uploadDir: string;
let superCookie = "";
let adminCookie = "";
let adminOtherCookie = "";
let opCookie = "";

function uploadForm(token: string, file: Blob = new Blob([PNG_BYTES], { type: "image/png" })): FormData {
  const fd = new FormData();
  fd.append("file", file, "asset.png");
  fd.append("token", token);
  return fd;
}

beforeAll(async () => {
  uploadDir = mkdtempSync(join(tmpdir(), "admitto-img-assets-"));
  process.env.UPLOAD_DIR = uploadDir;

  prisma = new PrismaClient();
  app = createApp({
    prisma,
    checkinToken: "img-assets-checkin-token-32-chars!",
    allowCheckinBearer: true,
    baseUrl: "https://tickets.example.com",
    rateLimitStore: createRateLimitStore(),
    skipCheckinBootValidation: true,
    adminDistRoot,
  });

  const password_hash = await hashPassword(PASSWORD);
  await prisma.eventImageAsset.deleteMany({
    where: {
      event_id: { in: [EVENT_IA, EVENT_IA_OTHER_ORG, EVENT_IA_ARCHIVED, EVENT_IA_LIMIT] },
    },
  });
  await prisma.roleAssignment.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_ADMIN_OTHER, EMAIL_OP] } } },
  });
  await prisma.session.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_ADMIN_OTHER, EMAIL_OP] } } },
  });
  await prisma.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_ADMIN_OTHER, EMAIL_OP] } } },
  });
  await prisma.user.deleteMany({
    where: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_ADMIN_OTHER, EMAIL_OP] } },
  });
  await prisma.event.deleteMany({
    where: { id: { in: [EVENT_IA, EVENT_IA_OTHER_ORG, EVENT_IA_ARCHIVED, EVENT_IA_LIMIT] } },
  });
  await prisma.organization.deleteMany({ where: { id: { in: [ORG_IA, ORG_IA_OTHER] } } });

  await prisma.organization.createMany({
    data: [
      { id: ORG_IA, name: "Img Assets Org", slug: "img-assets-org" },
      { id: ORG_IA_OTHER, name: "Img Assets Org Other", slug: "img-assets-org-other" },
    ],
  });
  await prisma.event.createMany({
    data: [
      {
        id: EVENT_IA,
        title: "Img Assets Event",
        slug: "img-assets-event",
        date: new Date("2026-10-01T12:00:00.000Z"),
        organization_id: ORG_IA,
      },
      {
        id: EVENT_IA_OTHER_ORG,
        title: "Img Assets Other Org Event",
        slug: "img-assets-other-org-event",
        date: new Date("2026-10-02T12:00:00.000Z"),
        organization_id: ORG_IA_OTHER,
      },
      {
        id: EVENT_IA_ARCHIVED,
        title: "Img Assets Archived Event",
        slug: "img-assets-archived-event",
        date: new Date("2026-10-03T12:00:00.000Z"),
        organization_id: ORG_IA,
        archived_at: new Date(),
      },
      {
        id: EVENT_IA_LIMIT,
        title: "Img Assets Limit Event",
        slug: "img-assets-limit-event",
        date: new Date("2026-10-04T12:00:00.000Z"),
        organization_id: ORG_IA,
      },
    ],
  });

  const adminUser = await prisma.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  const adminOtherUser = await prisma.user.create({
    data: { email: EMAIL_ADMIN_OTHER, password_hash },
  });
  const opUser = await prisma.user.create({ data: { email: EMAIL_OP, password_hash } });
  const superUser = await prisma.user.create({ data: { email: EMAIL_SUPER, password_hash } });

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

  await prisma.roleAssignment.createMany({
    data: [
      { user_id: adminUser.id, role: "admin", scope_type: "organization", scope_id: ORG_IA },
      {
        user_id: adminOtherUser.id,
        role: "admin",
        scope_type: "organization",
        scope_id: ORG_IA_OTHER,
      },
      { user_id: opUser.id, role: "operator", scope_type: "event", scope_id: EVENT_IA },
    ],
  });

  for (const userId of [adminUser.id, adminOtherUser.id, superUser.id]) {
    await prisma.userMfaMethod.create({
      data: {
        user_id: userId,
        type: "totp",
        secret_enc: encryptTotpSecret(generateTotpSecret()),
        confirmed_at: new Date(),
      },
    });
  }

  const adminSession = await createSession(prisma, { userId: adminUser.id, stage: SESSION_STAGE.FULL });
  const adminOtherSession = await createSession(prisma, {
    userId: adminOtherUser.id,
    stage: SESSION_STAGE.FULL,
  });
  const opSession = await createSession(prisma, { userId: opUser.id, stage: SESSION_STAGE.FULL });
  const superSession = await createSession(prisma, { userId: superUser.id, stage: SESSION_STAGE.FULL });
  adminCookie = `admitto_session=${adminSession.rawToken}`;
  adminOtherCookie = `admitto_session=${adminOtherSession.rawToken}`;
  opCookie = `admitto_session=${opSession.rawToken}`;
  superCookie = `admitto_session=${superSession.rawToken}`;
});

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(uploadDir, { recursive: true, force: true });
  delete process.env.UPLOAD_DIR;
});

describe("GET /api/admin/events/:eventId/image-assets", () => {
  it("returns an empty list for a fresh event", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });

  it("returns 403 for a non-managing operator", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      headers: { Cookie: opCookie, ...sameOrigin },
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 for an admin of a different organization", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      headers: { Cookie: adminOtherCookie, ...sameOrigin },
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/events/:eventId/image-assets", () => {
  it("creates an asset and it appears in the list", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin },
      body: uploadForm("sponsor_logo"),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      token: string;
      filename: string;
      url: string;
      size_bytes: number;
      mime_type: string;
      created_at: string;
    };
    expect(body.token).toBe("sponsor_logo");
    expect(body.filename).toBe("asset.png");
    expect(body.mime_type).toBe("image/png");
    expect(body.size_bytes).toBe(PNG_BYTES.length);
    expect(body.url).toMatch(new RegExp(`^/uploads/default/events/${EVENT_IA}/[0-9a-f-]+\\.png$`));

    const listRes = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    const listBody = (await listRes.json()) as { items: Array<{ id: string }> };
    expect(listBody.items.some((item) => item.id === body.id)).toBe(true);

    const log = await prisma.attendeeActionLog.findFirst({
      where: { event_id: EVENT_IA, action_type: "event_image_asset_created" },
      orderBy: { created_at: "desc" },
    });
    expect(log?.attendee_id).toBeNull();
    expect(log?.metadata).toEqual({ token: "sponsor_logo" });
  });

  it("rejects an invalid token format with 400", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin },
      body: uploadForm("Not-Valid!"),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_token");
  });

  it("rejects a token beginning with a digit", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin },
      body: uploadForm("1sponsor"),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a token colliding with a reserved static placeholder", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin },
      body: uploadForm("logo_url"),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("reserved_token");
  });

  it("rejects a duplicate token within the same event with 409", async () => {
    const first = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin },
      body: uploadForm("dup_token"),
    });
    expect(first.status).toBe(201);

    const second = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin },
      body: uploadForm("dup_token"),
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string };
    expect(body.error).toBe("token_conflict");
  });

  it("rejects unsupported file type with 415", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin },
      body: uploadForm(
        "bad_file",
        new Blob(["MZ"], { type: "application/octet-stream" }),
      ),
    });
    expect(res.status).toBe(415);
  });

  it("returns 403 for an admin of a different organization", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      method: "POST",
      headers: { Cookie: adminOtherCookie, ...sameOrigin },
      body: uploadForm("cross_org"),
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 event_archived for an archived event", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_IA_ARCHIVED}/image-assets`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin },
      body: uploadForm("archived_token"),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("event_archived");
  });

  it("returns 404 for a non-existent event", async () => {
    const res = await app.request("/api/admin/events/evt-img-assets-missing/image-assets", {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
      body: uploadForm("missing_event"),
    });
    expect(res.status).toBe(404);
  });

  it("returns 422 once the per-event asset limit is reached", async () => {
    await prisma.eventImageAsset.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        event_id: EVENT_IA_LIMIT,
        token: `limit_token_${i}`,
        filename: "seed.png",
        url: `/uploads/default/events/${EVENT_IA_LIMIT}/seed-${i}.png`,
        size_bytes: 12,
        mime_type: "image/png",
      })),
    });

    const res = await app.request(`/api/admin/events/${EVENT_IA_LIMIT}/image-assets`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin },
      body: uploadForm("one_too_many"),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; limit: number };
    expect(body.error).toBe("asset_limit_reached");
    expect(body.limit).toBe(20);
  });
});

describe("DELETE /api/admin/events/:eventId/image-assets/:assetId", () => {
  it("deletes the asset and it no longer appears in the list", async () => {
    const createRes = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin },
      body: uploadForm("to_delete"),
    });
    const created = (await createRes.json()) as { id: string };

    const delRes = await app.request(
      `/api/admin/events/${EVENT_IA}/image-assets/${created.id}`,
      { method: "DELETE", headers: { Cookie: adminCookie, ...sameOrigin } },
    );
    expect(delRes.status).toBe(200);
    const delBody = (await delRes.json()) as { ok: boolean };
    expect(delBody.ok).toBe(true);

    const listRes = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    const listBody = (await listRes.json()) as { items: Array<{ id: string }> };
    expect(listBody.items.some((item) => item.id === created.id)).toBe(false);

    const log = await prisma.attendeeActionLog.findFirst({
      where: { event_id: EVENT_IA, action_type: "event_image_asset_deleted" },
      orderBy: { created_at: "desc" },
    });
    expect(log?.attendee_id).toBeNull();
    expect(log?.metadata).toEqual({ token: "to_delete" });
  });

  it("returns 403 for an asset belonging to a different event", async () => {
    const createRes = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin },
      body: uploadForm("cross_event_victim"),
    });
    const created = (await createRes.json()) as { id: string };

    const res = await app.request(
      `/api/admin/events/${EVENT_IA_LIMIT}/image-assets/${created.id}`,
      { method: "DELETE", headers: { Cookie: adminCookie, ...sameOrigin } },
    );
    expect(res.status).toBe(403);
  });

  it("returns 403 for a non-existent asset id", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_IA}/image-assets/does-not-exist`,
      { method: "DELETE", headers: { Cookie: adminCookie, ...sameOrigin } },
    );
    expect(res.status).toBe(403);
  });

  it("returns 403 for an admin of a different organization", async () => {
    const createRes = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin },
      body: uploadForm("cross_org_delete"),
    });
    const created = (await createRes.json()) as { id: string };

    const res = await app.request(
      `/api/admin/events/${EVENT_IA}/image-assets/${created.id}`,
      { method: "DELETE", headers: { Cookie: adminOtherCookie, ...sameOrigin } },
    );
    expect(res.status).toBe(403);
  });

  it("returns 403 event_archived for an archived event", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_IA_ARCHIVED}/image-assets/does-not-exist`,
      { method: "DELETE", headers: { Cookie: adminCookie, ...sameOrigin } },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("event_archived");
  });
});
