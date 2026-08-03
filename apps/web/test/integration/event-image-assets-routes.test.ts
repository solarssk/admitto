import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
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
const EVENT_IA_LOCK_RACE = "evt-img-assets-lock-race";

const EMAIL_SUPER = "img-assets-super@example.com";
const EMAIL_ADMIN = "img-assets-admin@example.com";
const EMAIL_ADMIN_OTHER = "img-assets-admin-other@example.com";
const EMAIL_OP = "img-assets-op@example.com";
const PASSWORD = "img-assets-pass-123";

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0xfc, 0xcf, 0xc0, 0x50,
  0x0f, 0x00, 0x04, 0x85, 0x01, 0x80, 0x84, 0xa9, 0x8c, 0x21, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
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

  prisma = createTestPrismaClient();
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
      event_id: { in: [EVENT_IA, EVENT_IA_OTHER_ORG, EVENT_IA_ARCHIVED, EVENT_IA_LIMIT, EVENT_IA_LOCK_RACE] },
    },
  });
  // MailTemplate has no FK to Event, so event deleteMany below does not cascade these rows.
  await prisma.mailTemplate.deleteMany({
    where: {
      scope_type: "event",
      scope_id: { in: [EVENT_IA, EVENT_IA_OTHER_ORG, EVENT_IA_ARCHIVED, EVENT_IA_LIMIT, EVENT_IA_LOCK_RACE] },
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
    where: { id: { in: [EVENT_IA, EVENT_IA_OTHER_ORG, EVENT_IA_ARCHIVED, EVENT_IA_LIMIT, EVENT_IA_LOCK_RACE] } },
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
      {
        id: EVENT_IA_LOCK_RACE,
        title: "Img Assets Lock Race Event",
        slug: "img-assets-lock-race-event",
        date: new Date("2026-10-05T12:00:00.000Z"),
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
      headers: { Cookie: superCookie, ...sameOrigin },
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

  it("rejects a same-org admin (non-superadmin) with 403 — image assets are superadmin-only since this data flows into attendee-facing email content", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      headers: { Cookie: adminCookie, ...sameOrigin },
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
      headers: { Cookie: superCookie, ...sameOrigin },
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
      headers: { Cookie: superCookie, ...sameOrigin },
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
      headers: { Cookie: superCookie, ...sameOrigin },
      body: uploadForm("Not-Valid!"),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_token");
  });

  it("rejects a token beginning with a digit", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
      body: uploadForm("1sponsor"),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a token colliding with a reserved static placeholder", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
      body: uploadForm("logo_url"),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("reserved_token");
  });

  it("rejects a duplicate token within the same event with 409 and leaves no orphaned file", async () => {
    const first = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
      body: uploadForm("dup_token"),
    });
    expect(first.status).toBe(201);

    const eventUploadDir = join(uploadDir, "default", "events", EVENT_IA);
    const filesBefore = readdirSync(eventUploadDir).length;

    const second = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
      body: uploadForm("dup_token"),
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string };
    expect(body.error).toBe("token_conflict");
    expect(readdirSync(eventUploadDir)).toHaveLength(filesBefore);
  });

  it("rejects unsupported file type with 415", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
      body: uploadForm(
        "bad_file",
        new Blob(["MZ"], { type: "application/octet-stream" }),
      ),
    });
    expect(res.status).toBe(415);
  });

  it("rejects a same-org admin (non-superadmin) with 403 — image assets are superadmin-only since this data flows into attendee-facing email content", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      method: "POST",
      headers: { Cookie: adminCookie, ...sameOrigin },
      body: uploadForm("same_org_admin_denied"),
    });
    expect(res.status).toBe(403);
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
      headers: { Cookie: superCookie, ...sameOrigin },
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
      headers: { Cookie: superCookie, ...sameOrigin },
      body: uploadForm("one_too_many"),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; limit: number };
    expect(body.error).toBe("asset_limit_reached");
    expect(body.limit).toBe(20);
  });

  it("returns 422 from the transaction-scoped recheck when the cap is only reached after the fast-path count passed (concurrent-upload race)", async () => {
    await prisma.eventImageAsset.createMany({
      data: Array.from({ length: 19 }, (_, i) => ({
        event_id: EVENT_IA_LIMIT,
        token: `race_token_${i}`,
        filename: "seed.png",
        url: `/uploads/default/events/${EVENT_IA_LIMIT}/race-seed-${i}.png`,
        size_bytes: 12,
        mime_type: "image/png",
      })),
    });

    // Simulate a concurrent upload landing its own 20th row right after this request's
    // fast-path count() read a stale, still-under-the-cap snapshot. `tx.eventImageAsset.count`
    // inside the transaction is a distinct method on the transaction-scoped client Prisma
    // creates internally, so mocking `prisma.eventImageAsset.count` only ever intercepts this
    // one fast-path call, never the transaction's own recount — the real row genuinely exists
    // in the DB by the time the transaction's unmocked recheck runs and must catch it for real.
    const countSpy = vi
      .spyOn(prisma.eventImageAsset, "count")
      .mockImplementationOnce((async () => {
        await prisma.eventImageAsset.create({
          data: {
            event_id: EVENT_IA_LIMIT,
            token: "race_winner",
            filename: "seed.png",
            url: `/uploads/default/events/${EVENT_IA_LIMIT}/race-winner.png`,
            size_bytes: 12,
            mime_type: "image/png",
          },
        });
        return 19;
      }) as never);

    try {
      const res = await app.request(`/api/admin/events/${EVENT_IA_LIMIT}/image-assets`, {
        method: "POST",
        headers: { Cookie: superCookie, ...sameOrigin },
        body: uploadForm("race_loser"),
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string; limit: number };
      expect(body.error).toBe("asset_limit_reached");

      const loser = await prisma.eventImageAsset.findFirst({
        where: { event_id: EVENT_IA_LIMIT, token: "race_loser" },
      });
      expect(loser).toBeNull();
    } finally {
      countSpy.mockRestore();
    }
  });

  // Genuinely concurrent requests (no mocking) at the cap boundary - the two transactions'
  // pg_advisory_xact_lock acquisitions serialize them, so exactly one of the pair must win
  // regardless of network/Node scheduling, unlike the mocked test above which only proves the
  // in-transaction recount catches an already-committed row.
  it("never exceeds the cap under two genuinely concurrent uploads at the boundary (advisory lock)", async () => {
    await prisma.eventImageAsset.createMany({
      data: Array.from({ length: 19 }, (_, i) => ({
        event_id: EVENT_IA_LOCK_RACE,
        token: `lockrace_seed_${i}`,
        filename: "seed.png",
        url: `/uploads/default/events/${EVENT_IA_LOCK_RACE}/lockrace-seed-${i}.png`,
        size_bytes: 12,
        mime_type: "image/png",
      })),
    });

    const [resA, resB] = await Promise.all([
      app.request(`/api/admin/events/${EVENT_IA_LOCK_RACE}/image-assets`, {
        method: "POST",
        headers: { Cookie: superCookie, ...sameOrigin },
        body: uploadForm("lockrace_a"),
      }),
      app.request(`/api/admin/events/${EVENT_IA_LOCK_RACE}/image-assets`, {
        method: "POST",
        headers: { Cookie: superCookie, ...sameOrigin },
        body: uploadForm("lockrace_b"),
      }),
    ]);

    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 422]);

    const finalCount = await prisma.eventImageAsset.count({
      where: { event_id: EVENT_IA_LOCK_RACE },
    });
    expect(finalCount).toBe(20);
  });
});

describe("DELETE /api/admin/events/:eventId/image-assets/:assetId", () => {
  it("deletes the asset and it no longer appears in the list", async () => {
    const createRes = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
      body: uploadForm("to_delete"),
    });
    const created = (await createRes.json()) as { id: string };

    const delRes = await app.request(
      `/api/admin/events/${EVENT_IA}/image-assets/${created.id}`,
      { method: "DELETE", headers: { Cookie: superCookie, ...sameOrigin } },
    );
    expect(delRes.status).toBe(200);
    const delBody = (await delRes.json()) as { ok: boolean };
    expect(delBody.ok).toBe(true);

    const listRes = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      headers: { Cookie: superCookie, ...sameOrigin },
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

  it("returns 409 asset_in_use while a saved event template references the token", async () => {
    const createRes = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
      body: uploadForm("in_use_logo"),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string };

    const template = await prisma.mailTemplate.create({
      data: {
        scope_type: "event",
        scope_id: EVENT_IA,
        name: "ticket",
        label: "Ticket email",
        subject_template: "Subject",
        body_template: '<p><img src="{{in_use_logo}}" alt="" /></p>',
        template_format: "html",
        compiled_html_template: '<p><img src="{{in_use_logo}}" alt="" /></p>',
      },
    });

    const blockedRes = await app.request(
      `/api/admin/events/${EVENT_IA}/image-assets/${created.id}`,
      { method: "DELETE", headers: { Cookie: superCookie, ...sameOrigin } },
    );
    expect(blockedRes.status).toBe(409);
    const blockedBody = (await blockedRes.json()) as { error: string };
    expect(blockedBody.error).toBe("asset_in_use");

    const stillThere = await prisma.eventImageAsset.findUnique({ where: { id: created.id } });
    expect(stillThere).not.toBeNull();

    // Once the template no longer references the token, deletion proceeds.
    await prisma.mailTemplate.delete({ where: { id: template.id } });
    const delRes = await app.request(
      `/api/admin/events/${EVENT_IA}/image-assets/${created.id}`,
      { method: "DELETE", headers: { Cookie: superCookie, ...sameOrigin } },
    );
    expect(delRes.status).toBe(200);
  });

  // Genuinely concurrent delete + template-save referencing the same token (no mocking) -
  // both handlers take the same per-event advisory lock before their respective check+commit,
  // so whichever acquires it first fully commits before the other's check runs. The invariant
  // that must hold regardless of which one wins the race: never end up with the asset deleted
  // AND a saved template still pointing at its token (the dangling-reference bug this closes).
  it("never leaves a template referencing a deleted image asset when delete and save race (advisory lock)", async () => {
    // Reset EVENT_IA_LOCK_RACE's library - the preceding cap-boundary test leaves it at 20/20.
    await prisma.eventImageAsset.deleteMany({ where: { event_id: EVENT_IA_LOCK_RACE } });

    const createRes = await app.request(`/api/admin/events/${EVENT_IA_LOCK_RACE}/image-assets`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
      body: uploadForm("race_ref_logo"),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string };

    const [deleteRes, saveRes] = await Promise.all([
      app.request(`/api/admin/events/${EVENT_IA_LOCK_RACE}/image-assets/${created.id}`, {
        method: "DELETE",
        headers: { Cookie: superCookie, ...sameOrigin },
      }),
      app.request(`/api/admin/events/${EVENT_IA_LOCK_RACE}/template`, {
        method: "PUT",
        headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({
          subject_template: "Subject",
          // Required placeholders (REQUIRED_URL_PLACEHOLDERS) must be present or
          // collectTemplateSourceErrors rejects the request before it ever reaches the
          // locked transaction, and the test would pass without exercising the race at all.
          body_template:
            '<p><a href="{{ticket_url}}">Ticket</a><img src="{{qr_image_url}}" alt="" />' +
            '<img src="{{race_ref_logo}}" alt="" /></p>',
          template_format: "html",
        }),
      }),
    ]);

    // Require exactly one winner and one loser - both-succeeded is the invariant this test
    // guards, but both-failed (e.g. both 500) would trivially satisfy that same check without
    // proving the race was actually serialized.
    const statuses = [deleteRes.status, saveRes.status];
    expect(statuses.filter((status) => status >= 200 && status < 300)).toHaveLength(1);
    expect(statuses.filter((status) => status >= 400 && status < 500)).toHaveLength(1);

    const assetStillExists = await prisma.eventImageAsset.findUnique({ where: { id: created.id } });
    const referencingTemplate = await prisma.mailTemplate.findFirst({
      where: {
        scope_type: "event",
        scope_id: EVENT_IA_LOCK_RACE,
        OR: [
          { subject_template: { contains: "{{race_ref_logo}}" } },
          { body_template: { contains: "{{race_ref_logo}}" } },
        ],
      },
    });
    expect(assetStillExists === null && referencingTemplate !== null).toBe(false);
  });

  it("returns 403 for an asset belonging to a different event", async () => {
    const createRes = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
      body: uploadForm("cross_event_victim"),
    });
    const created = (await createRes.json()) as { id: string };

    const res = await app.request(
      `/api/admin/events/${EVENT_IA_LIMIT}/image-assets/${created.id}`,
      { method: "DELETE", headers: { Cookie: superCookie, ...sameOrigin } },
    );
    expect(res.status).toBe(403);
  });

  it("returns 403 for a non-existent asset id", async () => {
    const res = await app.request(
      `/api/admin/events/${EVENT_IA}/image-assets/does-not-exist`,
      { method: "DELETE", headers: { Cookie: superCookie, ...sameOrigin } },
    );
    expect(res.status).toBe(403);
  });

  it("rejects a same-org admin (non-superadmin) with 403 — image assets are superadmin-only since this data flows into attendee-facing email content", async () => {
    const createRes = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
      body: uploadForm("same_org_admin_delete_denied"),
    });
    const created = (await createRes.json()) as { id: string };

    const res = await app.request(
      `/api/admin/events/${EVENT_IA}/image-assets/${created.id}`,
      { method: "DELETE", headers: { Cookie: adminCookie, ...sameOrigin } },
    );
    expect(res.status).toBe(403);
  });

  it("returns 403 for an admin of a different organization", async () => {
    const createRes = await app.request(`/api/admin/events/${EVENT_IA}/image-assets`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin },
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
      { method: "DELETE", headers: { Cookie: superCookie, ...sameOrigin } },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("event_archived");
  });
});
