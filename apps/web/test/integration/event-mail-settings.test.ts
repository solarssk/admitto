import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";
import type { ExportPayload } from "@admitto/mailer";
import { setMailSettings } from "@admitto/mailer-config";
import { createApp } from "../../src/app.js";
import { InMemoryRateLimitStore } from "../../src/rate-limit/in-memory.js";

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG_A = "org-event-mail-settings";
const ORG_B = "org-event-mail-settings-b";
const EVENT = "evt-event-mail-settings";
const EVENT_ARCHIVED = "evt-event-mail-settings-archived";
const EVENT_B = "evt-event-mail-settings-b";
const EVENT_MISSING = "evt-event-mail-settings-missing";

const EMAIL_SUPER = "event-mail-settings-super@example.com";
const EMAIL_ADMIN = "event-mail-settings-admin@example.com";
const EMAIL_OP = "event-mail-settings-op@example.com";
const PASSWORD = "event-mail-settings-pass-123";

const exported: ExportPayload[] = [];
let failExport = false;
let probeImpl: (config: unknown) => Promise<{ ok: true } | { ok: false; error: string }> = async () => ({
  ok: true,
});
const originalNodeEnv = process.env.NODE_ENV;

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let rateLimitStore: InMemoryRateLimitStore;
let superId: string;
let adminId: string;
let opId: string;
let superCookie = "";
let adminCookie = "";
let opCookie = "";

async function seed(client: PrismaClient) {
  await client.adminAuditLog.deleteMany({ where: { organization_id: { in: [ORG_A, ORG_B] } } });
  await client.bounceIngestSettings.deleteMany({
    where: { event_id: { in: [EVENT, EVENT_ARCHIVED, EVENT_B] } },
  });
  await client.mailSettings.deleteMany({
    where: { scope_id: { in: [ORG_A, ORG_B, EVENT, EVENT_ARCHIVED, EVENT_B] } },
  });
  await client.roleAssignment.deleteMany({
    where: { OR: [{ scope_id: { in: [ORG_A, ORG_B, EVENT, EVENT_ARCHIVED, EVENT_B] } }] },
  });
  await client.session.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_OP] } } },
  });
  await client.userMfaMethod.deleteMany({
    where: { user: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN] } } },
  });
  await client.user.deleteMany({ where: { email: { in: [EMAIL_SUPER, EMAIL_ADMIN, EMAIL_OP] } } });
  await client.event.deleteMany({ where: { id: { in: [EVENT, EVENT_ARCHIVED, EVENT_B] } } });
  await client.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });

  const password_hash = await hashPassword(PASSWORD);

  await client.organization.createMany({
    data: [
      { id: ORG_A, name: "Event Mail Settings Org", slug: "event-mail-settings-org" },
      { id: ORG_B, name: "Event Mail Settings Org B", slug: "event-mail-settings-org-b" },
    ],
  });

  await client.event.createMany({
    data: [
      {
        id: EVENT,
        title: "Event Mail Settings Event",
        slug: "event-mail-settings",
        date: new Date("2026-10-01T12:00:00.000Z"),
        organization_id: ORG_A,
      },
      {
        id: EVENT_ARCHIVED,
        title: "Event Mail Settings Archived Event",
        slug: "event-mail-settings-archived",
        date: new Date("2026-11-01T12:00:00.000Z"),
        organization_id: ORG_A,
        archived_at: new Date(),
      },
      {
        id: EVENT_B,
        title: "Event Mail Settings Event B",
        slug: "event-mail-settings-b",
        date: new Date("2026-12-01T12:00:00.000Z"),
        organization_id: ORG_B,
      },
    ],
  });

  const superUser = await client.user.create({ data: { email: EMAIL_SUPER, password_hash } });
  const adminUser = await client.user.create({ data: { email: EMAIL_ADMIN, password_hash } });
  const opUser = await client.user.create({ data: { email: EMAIL_OP, password_hash } });
  superId = superUser.id;
  adminId = adminUser.id;
  opId = opUser.id;

  await client.roleAssignment.createMany({
    data: [
      { user_id: superId, role: "superadmin", scope_type: "instance", scope_id: null },
      { user_id: adminId, role: "admin", scope_type: "organization", scope_id: ORG_A },
      { user_id: opId, role: "operator", scope_type: "event", scope_id: EVENT },
    ],
  });

  for (const userId of [superId, adminId]) {
    await client.userMfaMethod.create({
      data: {
        user_id: userId,
        type: "totp",
        secret_enc: encryptTotpSecret(generateTotpSecret()),
        confirmed_at: new Date(),
      },
    });
  }
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await seed(prisma);

  rateLimitStore = new InMemoryRateLimitStore();
  app = createApp({
    prisma,
    baseUrl: "https://tickets.example.com",
    rateLimitStore,
    skipCheckinBootValidation: true,
    adminDistRoot,
    mailDeliveryDeps: {
      exportSink: (payload) => {
        if (failExport) throw new Error("export sink failed");
        exported.push(payload);
      },
    },
    mailProbeDeps: {
      probeMail: (config) => probeImpl(config),
    },
  });

  const superSession = await createSession(prisma, { userId: superId, stage: SESSION_STAGE.FULL });
  const adminSession = await createSession(prisma, { userId: adminId, stage: SESSION_STAGE.FULL });
  const opSession = await createSession(prisma, { userId: opId, stage: SESSION_STAGE.FULL });
  superCookie = `admitto_session=${superSession.rawToken}`;
  adminCookie = `admitto_session=${adminSession.rawToken}`;
  opCookie = `admitto_session=${opSession.rawToken}`;
});

afterEach(async () => {
  await prisma.adminAuditLog.deleteMany({ where: { organization_id: { in: [ORG_A, ORG_B] } } });
  await prisma.bounceIngestSettings.deleteMany({ where: { event_id: EVENT } });
  await prisma.mailSettings.deleteMany({
    where: { scope_id: { in: [ORG_A, ORG_B, EVENT, EVENT_ARCHIVED, EVENT_B] } },
  });
  exported.length = 0;
  failExport = false;
  probeImpl = async () => ({ ok: true });
  rateLimitStore.reset();
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

afterAll(async () => {
  await prisma?.$disconnect();
});

type EventMailSettingsApi = {
  eventId: string;
  organizationId: string;
  isProduction: boolean;
  hasEventOverride: boolean;
  failedDeliveries: number;
  fields: Record<
    string,
    { value?: unknown; set?: boolean; masked?: string | null; source: string; locked?: boolean }
  >;
};

async function createOrgSmtp() {
  // Uses setMailSettings (real encryption) rather than a raw prisma.create with a fake
  // enc string — anything that goes through resolveMailConfig/tryParse*FromRow (PUT
  // validation, test-send) actually decrypts this column, which a fake string can't survive.
  await setMailSettings(
    { scopeType: "organization", scopeId: ORG_A },
    {
      provider: "smtp",
      host: "smtp.org.example.com",
      port: 587,
      user: "org-smtp@example.com",
      fromAddress: "org-smtp@example.com",
      smtpPassword: "org-smtp-secret",
    },
    prisma,
  );
}

describe("GET /api/admin/events/:eventId/mail-settings", () => {
  it("returns inherited org values with hasEventOverride:false when no event override exists", async () => {
    await createOrgSmtp();

    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings`, {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventMailSettingsApi;
    expect(body.eventId).toBe(EVENT);
    expect(body.organizationId).toBe(ORG_A);
    expect(body.hasEventOverride).toBe(false);
    expect(body.fields.host?.value).toBe("smtp.org.example.com");
    expect(body.failedDeliveries).toBe(0);
  });

  it("returns dedicated values with hasEventOverride:true once an event override exists", async () => {
    await createOrgSmtp();
    await prisma.mailSettings.create({
      data: {
        scope_type: "event",
        scope_id: EVENT,
        provider: "smtp",
        host: "smtp.dedicated.example.com",
        port: 587,
        user: "dedicated@example.com",
        from_address: "dedicated@example.com",
        smtp_password_enc: "not-real-enc",
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings`, {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventMailSettingsApi;
    expect(body.hasEventOverride).toBe(true);
    expect(body.fields.host?.value).toBe("smtp.dedicated.example.com");
  });

  describe("failedDeliveries", () => {
    const ATTENDEE = "att-event-mail-settings-failed";

    afterEach(async () => {
      await prisma.emailDelivery.deleteMany({ where: { attendee_id: ATTENDEE } });
      await prisma.attendee.deleteMany({ where: { id: ATTENDEE } });
    });

    it("counts only this event's failed+retryable deliveries, not other statuses/events/orgs", async () => {
      await createOrgSmtp();
      await prisma.attendee.create({
        data: { id: ATTENDEE, event_id: EVENT, email: "failed-delivery@example.com", name: "Failed Delivery" },
      });
      await prisma.emailDelivery.createMany({
        data: [
          // Counts: failed and still retryable.
          {
            organization_id: ORG_A,
            event_id: EVENT,
            attendee_id: ATTENDEE,
            purpose: "initial",
            provider: "smtp",
            status: "failed",
            retryable: true,
          },
          // Doesn't count: retries already exhausted (retryable flipped to false).
          {
            organization_id: ORG_A,
            event_id: EVENT,
            attendee_id: ATTENDEE,
            purpose: "resend",
            provider: "smtp",
            status: "failed",
            retryable: false,
          },
          // Doesn't count: delivered fine. Both this and the row above use purpose "resend",
          // not a second "initial" — EmailDelivery_initial_unique only allows one initial-
          // purpose row per (attendee_id, event_id), but doesn't restrict resends.
          {
            organization_id: ORG_A,
            event_id: EVENT,
            attendee_id: ATTENDEE,
            purpose: "resend",
            provider: "smtp",
            status: "sent",
          },
        ],
      });

      const res = await app.request(`/api/admin/events/${EVENT}/mail-settings`, {
        headers: { Cookie: superCookie },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as EventMailSettingsApi;
      expect(body.failedDeliveries).toBe(1);
    });
  });

  it("rejects org admin (not superadmin) — transport config is superadmin-only", async () => {
    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(403);
  });

  it("rejects operator", async () => {
    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings`, {
      headers: { Cookie: opCookie },
    });
    expect(res.status).toBe(403);
  });

  it("returns 401 without auth", async () => {
    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings`);
    expect(res.status).toBe(401);
  });

  it("returns 404 for non-existent event (superadmin)", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_MISSING}/mail-settings`, {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(404);
  });

  it("returns 403 for non-existent event (org admin, no existence leak)", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_MISSING}/mail-settings`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 for cross-org event", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_B}/mail-settings`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(403);
  });

  it("returns fields even when the event is archived (GET is not archive-guarded)", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_ARCHIVED}/mail-settings`, {
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(200);
  });
});

describe("PUT /api/admin/events/:eventId/mail-settings", () => {
  it("creates an event-scoped row and flips hasEventOverride to true", async () => {
    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings`, {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "smtp",
        host: "smtp.put.example.com",
        port: 587,
        user: "put@example.com",
        fromAddress: "put@example.com",
        smtpPassword: "put-secret",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventMailSettingsApi;
    expect(body.hasEventOverride).toBe(true);

    const row = await prisma.mailSettings.findUnique({
      where: { scope_type_scope_id: { scope_type: "event", scope_id: EVENT } },
    });
    expect(row?.host).toBe("smtp.put.example.com");
    expect(row?.from_address).toBe("put@example.com");
  });

  it("rejects org admin (not superadmin) — transport config is superadmin-only", async () => {
    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings`, {
      method: "PUT",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "smtp",
        host: "smtp.admin.example.com",
        port: 587,
        user: "admin-save@example.com",
        fromAddress: "admin-save@example.com",
        smtpPassword: "admin-secret",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects operator", async () => {
    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings`, {
      method: "PUT",
      headers: { Cookie: opCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "smtp", fromAddress: "x@example.com" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects cross-org event", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_B}/mail-settings`, {
      method: "PUT",
      headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "smtp", fromAddress: "x@example.com" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects missing CSRF origin", async () => {
    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings`, {
      method: "PUT",
      headers: { Cookie: superCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "smtp", fromAddress: "x@example.com" }),
    });
    expect(res.status).toBe(403);
  });

  it("resolves an incomplete event override against the org fallback for non-connection fields", async () => {
    await createOrgSmtp();

    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings`, {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "smtp", fromName: "Autumn Summit" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventMailSettingsApi;
    // Event overrides a cosmetic sender field, org fills in the connection (host/user/password)
    // — same precedence as send time. Connection-identity fields (host) are covered separately
    // below: an event can't redirect the connection while still inheriting the org's password.
    expect(body.fields.fromName?.value).toBe("Autumn Summit");
    expect(body.fields.host?.value).toBe("smtp.org.example.com");
    expect(body.fields.user?.value).toBe("org-smtp@example.com");
  });

  it("rejects an event override that sets host without its own password, even with an org fallback available", async () => {
    // Security: overriding the connection host must not silently authenticate with the
    // organization's real SMTP password against whatever server the event admin chose
    // (see the dedicated host-redirection test further down for the full exploit shape).
    await createOrgSmtp();

    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings`, {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "smtp", host: "smtp.event-only.example.com" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("incomplete_transport");
  });

  it("rejects incomplete transport when there is no org fallback", async () => {
    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings`, {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "smtp", host: "smtp.incomplete.example.com" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; detail?: string };
    expect(body.error).toBe("incomplete_transport");
    expect(body.detail).toMatch(/user/i);
  });

  it("rejects env-locked field", async () => {
    const prev = process.env.SMTP_HOST;
    process.env.SMTP_HOST = "smtp.env-locked.example.com";
    try {
      const res = await app.request(`/api/admin/events/${EVENT}/mail-settings`, {
        method: "PUT",
        headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ host: "smtp.override.example.com" }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toBe("managed by environment");
    } finally {
      if (prev === undefined) delete process.env.SMTP_HOST;
      else process.env.SMTP_HOST = prev;
    }
  });

  it("leaves secret unchanged when omitted", async () => {
    await app.request(`/api/admin/events/${EVENT}/mail-settings`, {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "smtp",
        host: "smtp.before.example.com",
        port: 587,
        user: "a@example.com",
        fromAddress: "a@example.com",
        smtpPassword: "keep-secret",
      }),
    });
    const before = await prisma.mailSettings.findUnique({
      where: { scope_type_scope_id: { scope_type: "event", scope_id: EVENT } },
    });

    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings`, {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ host: "smtp.still.example.com" }),
    });
    expect(res.status).toBe(200);
    const after = await prisma.mailSettings.findUnique({
      where: { scope_type_scope_id: { scope_type: "event", scope_id: EVENT } },
    });
    expect(after?.smtp_password_enc).toBe(before?.smtp_password_enc);
  });

  it("rotates secret when new value provided", async () => {
    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings`, {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "smtp",
        host: "smtp.rotate.example.com",
        port: 587,
        user: "rotate@example.com",
        fromAddress: "rotate@example.com",
        smtpPassword: "new-rotate-secret",
      }),
    });
    expect(res.status).toBe(200);
    const row = await prisma.mailSettings.findUnique({
      where: { scope_type_scope_id: { scope_type: "event", scope_id: EVENT } },
    });
    expect(row?.smtp_password_enc).toBeTruthy();
    expect(row?.smtp_password_enc).not.toBe("new-rotate-secret");
  });

  it("rejects clearing the only password on an active SMTP transport", async () => {
    await app.request(`/api/admin/events/${EVENT}/mail-settings`, {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "smtp",
        host: "smtp.clear.example.com",
        port: 587,
        user: "clear@example.com",
        fromAddress: "clear@example.com",
        smtpPassword: "clear-me",
      }),
    });

    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings`, {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ smtpPassword: "" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("incomplete_transport");
    const row = await prisma.mailSettings.findUnique({
      where: { scope_type_scope_id: { scope_type: "event", scope_id: EVENT } },
    });
    expect(row?.smtp_password_enc).toBeTruthy();
  });

  it("rejects an event override that redirects the SMTP host while inheriting the org's password", async () => {
    // Security: even a superadmin's partial PUT must not be able to silently point the
    // connection at a different host while the resolved config still authenticates with
    // the organization's real SMTP password (a plain data-integrity/incomplete-transport
    // guard — write access itself is already superadmin-only, see the 403 tests above).
    await createOrgSmtp();

    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings`, {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ host: "smtp.attacker.example.com" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("incomplete_transport");
    const row = await prisma.mailSettings.findUnique({
      where: { scope_type_scope_id: { scope_type: "event", scope_id: EVENT } },
    });
    expect(row).toBeNull();
  });

  it("rejects export_only in production", async () => {
    process.env.NODE_ENV = "production";
    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings`, {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "export_only", fromAddress: "dev@example.com" }),
    });
    expect(res.status).toBe(400);
  });

  it("writes audit metadata without secret values", async () => {
    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings`, {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "smtp",
        host: "smtp.audit.example.com",
        port: 587,
        user: "audit@example.com",
        fromAddress: "audit@example.com",
        smtpPassword: "audit-secret-value",
      }),
    });
    expect(res.status).toBe(200);

    const log = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_A, action_type: "event_mail_settings_updated" },
      orderBy: { created_at: "desc" },
    });
    expect(log).not.toBeNull();
    const meta = log!.metadata as { eventId?: string; secrets_rotated?: string[] };
    expect(meta.eventId).toBe(EVENT);
    expect(meta.secrets_rotated).toContain("smtpPassword");
    expect(JSON.stringify(meta)).not.toContain("audit-secret-value");
  });

  it("returns 403 event_archived when the event is archived", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_ARCHIVED}/mail-settings`, {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "smtp", fromAddress: "x@example.com" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("event_archived");
  });

  it("returns 404 for non-existent event", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_MISSING}/mail-settings`, {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "smtp", fromAddress: "x@example.com" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 validation_failed for malformed JSON", async () => {
    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings`, {
      method: "PUT",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("validation_failed");
  });

  it("returns 404 without writing a row when the event is deleted between validation and the write", async () => {
    const raceEventId = "evt-event-mail-settings-race";
    await prisma.event.create({
      data: {
        id: raceEventId,
        title: "Event Mail Settings Race Event",
        slug: "event-mail-settings-race",
        date: new Date("2026-10-05T12:00:00.000Z"),
        organization_id: ORG_A,
      },
    });

    // Simulates a concurrent permanent event-delete landing between this route's initial
    // validation (loadEventOrg, below) and its transaction's own advisory-lock re-check —
    // the lock in handlePutEventMailSettings/deleteEvent exists precisely to prevent this
    // write from recreating an orphaned MailSettings row (CodeRabbit review).
    const originalFindUnique = prisma.event.findUnique.bind(prisma.event);
    let alreadyDeleted = false;
    const spy = vi.spyOn(prisma.event, "findUnique").mockImplementation((async (args: { where?: { id?: string } }) => {
      const result = await originalFindUnique(args as Parameters<typeof originalFindUnique>[0]);
      if (args?.where?.id === raceEventId && !alreadyDeleted) {
        alreadyDeleted = true;
        await prisma.event.delete({ where: { id: raceEventId } });
      }
      return result;
    }) as never);

    try {
      const res = await app.request(`/api/admin/events/${raceEventId}/mail-settings`, {
        method: "PUT",
        headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "smtp",
          host: "smtp.race.example.com",
          port: 587,
          user: "race@example.com",
          fromAddress: "race@example.com",
          smtpPassword: "race-secret",
        }),
      });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toBe("not_found");

      const row = await prisma.mailSettings.findUnique({
        where: { scope_type_scope_id: { scope_type: "event", scope_id: raceEventId } },
      });
      expect(row).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("DELETE /api/admin/events/:eventId/mail-settings", () => {
  async function createEventOverride() {
    await prisma.mailSettings.create({
      data: {
        scope_type: "event",
        scope_id: EVENT,
        provider: "export_only",
        from_address: "dedicated@example.com",
      },
    });
  }

  it("reverts to inheritance, deleting the event row", async () => {
    await createEventOverride();

    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings`, {
      method: "DELETE",
      headers: { Cookie: superCookie, ...sameOrigin },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventMailSettingsApi;
    expect(body.hasEventOverride).toBe(false);

    const row = await prisma.mailSettings.findUnique({
      where: { scope_type_scope_id: { scope_type: "event", scope_id: EVENT } },
    });
    expect(row).toBeNull();
  });

  it("is idempotent when no override exists", async () => {
    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings`, {
      method: "DELETE",
      headers: { Cookie: superCookie, ...sameOrigin },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventMailSettingsApi;
    expect(body.hasEventOverride).toBe(false);
  });

  it("rejects org admin (not superadmin) — transport config is superadmin-only", async () => {
    await createEventOverride();
    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings`, {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    expect(res.status).toBe(403);
  });

  it("rejects operator", async () => {
    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings`, {
      method: "DELETE",
      headers: { Cookie: opCookie, ...sameOrigin },
    });
    expect(res.status).toBe(403);
  });

  it("rejects cross-org event", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_B}/mail-settings`, {
      method: "DELETE",
      headers: { Cookie: adminCookie, ...sameOrigin },
    });
    expect(res.status).toBe(403);
  });

  it("rejects missing CSRF origin", async () => {
    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings`, {
      method: "DELETE",
      headers: { Cookie: superCookie },
    });
    expect(res.status).toBe(403);
  });

  it("writes audit metadata", async () => {
    await createEventOverride();
    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings`, {
      method: "DELETE",
      headers: { Cookie: superCookie, ...sameOrigin },
    });
    expect(res.status).toBe(200);

    const log = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_A, action_type: "event_mail_settings_cleared" },
      orderBy: { created_at: "desc" },
    });
    expect(log).not.toBeNull();
    const meta = log!.metadata as { eventId?: string };
    expect(meta.eventId).toBe(EVENT);
  });

  it("returns 403 event_archived when the event is archived", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_ARCHIVED}/mail-settings`, {
      method: "DELETE",
      headers: { Cookie: superCookie, ...sameOrigin },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("event_archived");
  });

  it("returns 404 for non-existent event", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_MISSING}/mail-settings`, {
      method: "DELETE",
      headers: { Cookie: superCookie, ...sameOrigin },
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/admin/events/:eventId/mail-settings/test", () => {
  it("sends via the event's dedicated transport when an override exists", async () => {
    await createOrgSmtp();
    await prisma.mailSettings.create({
      data: {
        scope_type: "event",
        scope_id: EVENT,
        provider: "export_only",
        from_address: "dedicated@example.com",
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings/test`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ to: "tester@example.com" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; provider?: string };
    expect(body.status).toBe("sent");
    expect(body.provider).toBe("export_only");
    expect(exported).toHaveLength(1);
  });

  it("falls back to the organization's transport when the event has no override", async () => {
    await prisma.mailSettings.create({
      data: {
        scope_type: "organization",
        scope_id: ORG_A,
        provider: "export_only",
        from_address: "org-transport@example.com",
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings/test`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ to: "tester@example.com" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; provider?: string };
    expect(body.status).toBe("sent");
    expect(body.provider).toBe("export_only");
    expect(exported).toHaveLength(1);

    const row = await prisma.mailSettings.findUnique({
      where: { scope_type_scope_id: { scope_type: "event", scope_id: EVENT } },
    });
    expect(row).toBeNull();
  });

  it("returns friendly error when neither event nor org is configured", async () => {
    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings/test`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ to: "tester@example.com" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; error?: string };
    expect(body.status).toBe("failed");
    expect(body.error).toBe("mail transport not configured");
  });

  it("rejects invalid email", async () => {
    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings/test`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ to: "not-an-email" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects operator", async () => {
    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings/test`, {
      method: "POST",
      headers: { Cookie: opCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ to: "tester@example.com" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects missing CSRF origin", async () => {
    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings/test`, {
      method: "POST",
      headers: { Cookie: superCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ to: "tester@example.com" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 429 after 5 test sends per minute", async () => {
    await prisma.mailSettings.create({
      data: {
        scope_type: "event",
        scope_id: EVENT,
        provider: "export_only",
        from_address: "dedicated@example.com",
      },
    });
    rateLimitStore.reset();

    for (let i = 0; i < 5; i++) {
      const res = await app.request(`/api/admin/events/${EVENT}/mail-settings/test`, {
        method: "POST",
        headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ to: "tester@example.com" }),
      });
      expect(res.status).toBe(200);
    }

    const limited = await app.request(`/api/admin/events/${EVENT}/mail-settings/test`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ to: "tester@example.com" }),
    });
    expect(limited.status).toBe(429);
  });

  it("writes audit metadata without leaking the recipient address", async () => {
    await prisma.mailSettings.create({
      data: {
        scope_type: "event",
        scope_id: EVENT,
        provider: "export_only",
        from_address: "dedicated@example.com",
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings/test`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ to: "tester@example.com" }),
    });
    expect(res.status).toBe(200);

    const log = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_A, action_type: "event_mail_transport_tested" },
      orderBy: { created_at: "desc" },
    });
    expect(log).not.toBeNull();
    const meta = log!.metadata as { eventId?: string; result?: string };
    expect(meta.eventId).toBe(EVENT);
    expect(meta.result).toBe("sent");
    expect(JSON.stringify(meta)).not.toContain("tester@example.com");
  });

  it("returns 403 event_archived when the event is archived", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_ARCHIVED}/mail-settings/test`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ to: "tester@example.com" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("event_archived");
  });

  it("returns 404 for non-existent event", async () => {
    const res = await app.request(`/api/admin/events/${EVENT_MISSING}/mail-settings/test`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ to: "tester@example.com" }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects verifyBounce when bounce detection is not configured", async () => {
    await prisma.mailSettings.create({
      data: {
        scope_type: "event",
        scope_id: EVENT,
        provider: "export_only",
        from_address: "dedicated@example.com",
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings/test`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ to: "nobody@example.com", verifyBounce: true }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; detail?: string };
    expect(body.error).toBe("bounce_probe_unavailable");
    expect(body.detail).toMatch(/bounce detection/i);
  });

  it("rejects verifyBounce when bounce detection is configured but Off", async () => {
    await prisma.mailSettings.create({
      data: {
        scope_type: "event",
        scope_id: EVENT,
        provider: "export_only",
        from_address: "dedicated@example.com",
      },
    });
    await prisma.bounceIngestSettings.create({
      data: {
        event_id: EVENT,
        enabled: false,
        imap_host: "imap.example.com",
        imap_port: 993,
        folders: ["INBOX"],
        poll_interval_minutes: 5,
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings/test`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ to: "nobody@example.com", verifyBounce: true }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; detail?: string };
    expect(body.error).toBe("bounce_probe_unavailable");
    expect(body.detail).toMatch(/On/i);
  });
});

describe("POST /api/admin/events/:eventId/mail-settings/probe", () => {
  it("verifies dedicated SMTP without sending mail", async () => {
    await setMailSettings(
      { scopeType: "event", scopeId: EVENT },
      {
        provider: "smtp",
        host: "smtp.event-probe.example.com",
        port: 587,
        user: "event-probe@example.com",
        fromAddress: "event-probe@example.com",
        smtpPassword: "event-probe-secret",
      },
      prisma,
    );

    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings/probe`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; message?: string };
    expect(body).toEqual({ ok: true, message: "Connected. SMTP account verified." });
    expect(exported).toHaveLength(0);

    const log = await prisma.adminAuditLog.findFirst({
      where: { organization_id: ORG_A, action_type: "event_mail_smtp_probed" },
      orderBy: { created_at: "desc" },
    });
    expect(log).not.toBeNull();
    expect((log!.metadata as { result?: string; eventId?: string }).result).toBe("ok");
    expect((log!.metadata as { eventId?: string }).eventId).toBe(EVENT);
  });

  it("returns sanitized error on SMTP auth failure", async () => {
    await setMailSettings(
      { scopeType: "event", scopeId: EVENT },
      {
        provider: "smtp",
        host: "smtp.event-probe.example.com",
        port: 587,
        user: "event-probe@example.com",
        fromAddress: "event-probe@example.com",
        smtpPassword: "event-probe-secret",
      },
      prisma,
    );

    probeImpl = async () => ({
      ok: false,
      error: "Invalid login: 535 Authentication failed for event-probe@example.com",
    });

    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings/probe`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBeTruthy();
    expect(body.error).not.toContain("event-probe@example.com");
  });

  it("rejects when the event has no dedicated override", async () => {
    await createOrgSmtp();

    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings/probe`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/dedicated SMTP/i);
  });

  it("rejects dedicated non-SMTP with 400", async () => {
    await prisma.mailSettings.create({
      data: {
        scope_type: "event",
        scope_id: EVENT,
        provider: "export_only",
        from_address: "dedicated@example.com",
      },
    });

    const res = await app.request(`/api/admin/events/${EVENT}/mail-settings/probe`, {
      method: "POST",
      headers: { Cookie: superCookie, ...sameOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/SMTP/i);
  });
});
