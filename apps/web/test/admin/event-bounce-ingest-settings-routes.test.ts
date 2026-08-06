import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "hono";
import {
  handleGetEventBounceIngestSettings,
  handlePostEventBounceIngestSettingsRun,
  handlePostEventBounceIngestSettingsTest,
  handlePutEventBounceIngestSettings,
} from "../../src/admin/event-bounce-ingest-settings-routes.js";
import { requireSuperadmin } from "../../src/admin/admin-helpers.js";
import { writeAdminAuditLog } from "@admitto/tickets";
import { describeMailConfig } from "@admitto/mailer-config";
import { encryptToString } from "@admitto/crypto";
import {
  imapTestErrorForAdmin,
  ingestBounces,
  testBounceImapConnection,
} from "@admitto/mail-delivery";

vi.mock("../../src/admin/admin-helpers.js", () => ({
  requireEventId: (c: Context) => c.req.param("eventId") ?? new Response("bad", { status: 400 }),
  requireSuperadmin: vi.fn(async () => null),
  adminAuditFromContext: () => ({
    operator: "user_1",
    sessionId: "sess_1",
    ip: "127.0.0.1",
    timezone: "UTC",
  }),
}));

vi.mock("@admitto/mailer-config", () => ({
  describeMailConfig: vi.fn(async () => ({
    provider: { value: "smtp", source: "organization", locked: false },
    smtpPassword: { value: "••••", source: "organization", locked: false },
    user: { value: "smtp-user", source: "organization", locked: false },
  })),
}));

vi.mock("@admitto/tickets", () => ({
  writeAdminAuditLog: vi.fn(async () => undefined),
}));

vi.mock("@admitto/mail-delivery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/mail-delivery")>();
  return {
    ...actual,
    testBounceImapConnection: vi.fn(),
    ingestBounces: vi.fn(),
    imapTestErrorForAdmin: vi.fn((m) => m ?? "Could not connect."),
  };
});

vi.mock("@admitto/crypto", () => ({
  encryptToString: vi.fn((s: string) => `enc:${s}`),
}));

function mockContext(opts: {
  eventId: string;
  json?: unknown;
  method?: string;
}): Context {
  const body = opts.json;
  return {
    req: {
      param: (name: string) => (name === "eventId" ? opts.eventId : undefined),
      json: async () => body,
    },
    json: (data: unknown, status?: number) =>
      new Response(JSON.stringify(data), {
        status: status ?? 200,
        headers: { "content-type": "application/json" },
      }),
    get: () => ({ userId: "user_1", sessionId: "sess_1" }),
  } as unknown as Context;
}

function baseDb(overrides: {
  event?: { findUnique: ReturnType<typeof vi.fn> };
  bounceIngestSettings?: {
    findUnique?: ReturnType<typeof vi.fn>;
    upsert?: ReturnType<typeof vi.fn>;
  };
} = {}) {
  return {
    event: {
      findUnique:
        overrides.event?.findUnique ??
        vi.fn().mockResolvedValue({ organization_id: "org_1" }),
    },
    bounceIngestSettings: {
      findUnique:
        overrides.bounceIngestSettings?.findUnique ?? vi.fn().mockResolvedValue(null),
      upsert:
        overrides.bounceIngestSettings?.upsert ??
        vi.fn().mockImplementation(async ({ create, update }) => ({
          id: "bis_1",
          event_id: "evt_1",
          ...(create ?? update),
        })),
    },
  };
}

describe("event bounce ingest settings routes", () => {
  const envKey = "ALLOW_PRIVATE_MAIL_DESTINATIONS";
  let previousPrivateMailOverride: string | undefined;

  beforeEach(() => {
    previousPrivateMailOverride = process.env[envKey];
    delete process.env[envKey];
    vi.mocked(requireSuperadmin).mockResolvedValue(null);
    vi.mocked(describeMailConfig).mockClear();
    vi.mocked(describeMailConfig).mockResolvedValue({
      provider: { value: "smtp", source: "organization", locked: false },
      smtpPassword: { value: "••••", source: "organization", locked: false },
      user: { value: "smtp-user", source: "organization", locked: false },
    } as never);
    vi.mocked(writeAdminAuditLog).mockClear();
    vi.mocked(encryptToString).mockClear();
    vi.mocked(testBounceImapConnection).mockReset();
    vi.mocked(ingestBounces).mockReset();
    vi.mocked(imapTestErrorForAdmin).mockImplementation((m) => m ?? "Could not connect.");
  });

  afterEach(() => {
    if (previousPrivateMailOverride === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = previousPrivateMailOverride;
    }
  });

  it("GET returns masked password presence and never a secret value", async () => {
    const db = baseDb({
      bounceIngestSettings: {
        findUnique: vi.fn().mockResolvedValue({
          id: "bis_1",
          event_id: "evt_1",
          imap_host: "imap.example.com",
          imap_port: 993,
          imap_username: "bounce@example.com",
          imap_password_enc: "encrypted-blob",
          reuse_smtp_credentials: false,
          folders: ["INBOX"],
          poll_interval_minutes: 5,
          enabled: true,
        }),
      },
    });

    const res = await handleGetEventBounceIngestSettings(
      mockContext({ eventId: "evt_1" }),
      db as never,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.imap_password).toEqual({
      set: true,
      masked: "••••",
      source: "db",
      locked: false,
      from_smtp: false,
    });
    expect(JSON.stringify(json)).not.toContain("encrypted-blob");
    expect(describeMailConfig).toHaveBeenCalledTimes(1);
    expect(json.lastRun).toBeNull();
  });

  it("GET serializes lastRun from stored last_run_* columns", async () => {
    const ranAt = new Date("2026-08-06T09:30:00.000Z");
    const db = baseDb({
      bounceIngestSettings: {
        findUnique: vi.fn().mockResolvedValue({
          id: "bis_1",
          event_id: "evt_1",
          imap_host: "imap.example.com",
          imap_port: 993,
          imap_username: "bounce@example.com",
          imap_password_enc: "encrypted-blob",
          reuse_smtp_credentials: false,
          folders: ["INBOX"],
          poll_interval_minutes: 5,
          enabled: true,
          last_run_at: ranAt,
          last_run_ok: true,
          last_run_summary: {
            messagesSeen: 2,
            bouncesApplied: 1,
            softBouncesLogged: 0,
            unparsed: 0,
            noMatchingDelivery: 0,
            errors: 0,
            connectFailed: false,
          },
        }),
      },
    });

    const res = await handleGetEventBounceIngestSettings(
      mockContext({ eventId: "evt_1" }),
      db as never,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { lastRun: Record<string, unknown> };
    expect(json.lastRun).toEqual({
      at: "2026-08-06T09:30:00.000Z",
      ok: true,
      messagesSeen: 2,
      bouncesApplied: 1,
      softBouncesLogged: 0,
      unparsed: 0,
      noMatchingDelivery: 0,
      errors: 0,
      connectFailed: false,
    });
  });

  it("GET returns 404 when the event is missing", async () => {
    const db = baseDb({
      event: { findUnique: vi.fn().mockResolvedValue(null) },
    });

    const res = await handleGetEventBounceIngestSettings(
      mockContext({ eventId: "evt_missing" }),
      db as never,
    );
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("event_not_found");
  });

  it("GET with reuse_smtp_credentials true masks username and marks password from SMTP", async () => {
    const db = baseDb({
      bounceIngestSettings: {
        findUnique: vi.fn().mockResolvedValue({
          id: "bis_1",
          event_id: "evt_1",
          imap_host: "imap.example.com",
          imap_port: 993,
          imap_username: "stored-user@example.com",
          imap_password_enc: null,
          reuse_smtp_credentials: true,
          folders: ["INBOX"],
          poll_interval_minutes: 5,
          enabled: true,
        }),
      },
    });

    const res = await handleGetEventBounceIngestSettings(
      mockContext({ eventId: "evt_1" }),
      db as never,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      imap_username: string | null;
      imap_password: Record<string, unknown>;
    };
    expect(json.imap_username).toBeNull();
    expect(json.imap_password).toEqual({
      set: true,
      masked: "••••",
      source: "db",
      locked: false,
      from_smtp: true,
    });
  });

  it("GET when describeMailConfig throws reports smtp_reuse_available false", async () => {
    vi.mocked(describeMailConfig).mockRejectedValueOnce(new Error("config unavailable"));
    const db = baseDb();

    const res = await handleGetEventBounceIngestSettings(
      mockContext({ eventId: "evt_1" }),
      db as never,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { smtp_reuse_available: boolean };
    expect(json.smtp_reuse_available).toBe(false);
  });

  it("GET with no settings row returns defaults", async () => {
    const db = baseDb();

    const res = await handleGetEventBounceIngestSettings(
      mockContext({ eventId: "evt_1" }),
      db as never,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      configured: boolean;
      imap_port: number;
      folders: string[];
      enabled: boolean;
    };
    expect(json.configured).toBe(false);
    expect(json.imap_port).toBe(993);
    expect(json.folders).toEqual(["INBOX", "Junk Email"]);
    expect(json.enabled).toBe(false);
  });

  it("PUT rejects SMTP reuse when effective provider is not SMTP", async () => {
    vi.mocked(describeMailConfig).mockResolvedValueOnce({
      provider: { value: "graph", source: "organization", locked: false },
      smtpPassword: { value: null, source: "default", locked: false },
    } as never);

    const db = baseDb();

    const res = await handlePutEventBounceIngestSettings(
      mockContext({
        eventId: "evt_1",
        json: { reuse_smtp_credentials: true, imap_host: "imap.example.com" },
      }),
      db as never,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("reuse_smtp_unavailable");
  });

  it("PUT rejects a private/loopback imap_host (SSRF guard, same as SMTP host)", async () => {
    const db = baseDb();

    const res = await handlePutEventBounceIngestSettings(
      mockContext({
        eventId: "evt_1",
        json: { imap_host: "127.0.0.1" },
      }),
      db as never,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("validation_failed");
  });

  it("PUT rejects an unknown field in the body", async () => {
    const db = baseDb();

    const res = await handlePutEventBounceIngestSettings(
      mockContext({
        eventId: "evt_1",
        json: { imap_host: "imap.example.com", extra_field: true },
      }),
      db as never,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("validation_failed");
  });

  it("PUT rejects a body with an invalid field type", async () => {
    const db = baseDb();

    const res = await handlePutEventBounceIngestSettings(
      mockContext({
        eventId: "evt_1",
        json: { imap_port: "not-a-number" },
      }),
      db as never,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("validation_failed");
  });

  it("PUT upserts dedicated credentials with imap_password and audits secrets_rotated", async () => {
    const upsert = vi.fn().mockResolvedValue({
      id: "bis_1",
      event_id: "evt_1",
      imap_host: "imap.example.com",
      imap_port: 993,
      imap_username: "bounce@example.com",
      imap_password_enc: "enc:imap-secret",
      reuse_smtp_credentials: false,
      folders: ["INBOX", "Junk Email"],
      poll_interval_minutes: 5,
      enabled: false,
    });
    const db = baseDb({ bounceIngestSettings: { upsert } });

    const res = await handlePutEventBounceIngestSettings(
      mockContext({
        eventId: "evt_1",
        json: {
          imap_host: "imap.example.com",
          imap_username: "bounce@example.com",
          imap_password: "imap-secret",
        },
      }),
      db as never,
    );
    expect(res.status).toBe(200);
    expect(encryptToString).toHaveBeenCalledWith("imap-secret");
    expect(writeAdminAuditLog).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        actionType: "bounce_ingest_settings_updated",
        metadata: expect.objectContaining({ secrets_rotated: true }),
      }),
    );
    expect(describeMailConfig).toHaveBeenCalledTimes(1);
  });

  it("PUT clear_imap_password clears the stored secret and audits secrets_cleared", async () => {
    const upsert = vi.fn().mockResolvedValue({
      id: "bis_1",
      event_id: "evt_1",
      imap_host: "imap.example.com",
      imap_port: 993,
      imap_username: "bounce@example.com",
      imap_password_enc: null,
      reuse_smtp_credentials: false,
      folders: ["INBOX", "Junk Email"],
      poll_interval_minutes: 5,
      enabled: false,
    });
    const db = baseDb({
      bounceIngestSettings: {
        findUnique: vi.fn().mockResolvedValue({
          id: "bis_1",
          event_id: "evt_1",
          imap_host: "imap.example.com",
          imap_port: 993,
          imap_username: "bounce@example.com",
          imap_password_enc: "enc:old",
          reuse_smtp_credentials: false,
          folders: ["INBOX"],
          poll_interval_minutes: 5,
          enabled: false,
        }),
        upsert,
      },
    });

    const res = await handlePutEventBounceIngestSettings(
      mockContext({
        eventId: "evt_1",
        json: { clear_imap_password: true },
      }),
      db as never,
    );
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ imap_password_enc: null }),
      }),
    );
    expect(writeAdminAuditLog).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        metadata: expect.objectContaining({ secrets_cleared: true }),
      }),
    );
  });

  it("PUT enable=true without host returns validation_failed", async () => {
    const db = baseDb();

    const res = await handlePutEventBounceIngestSettings(
      mockContext({
        eventId: "evt_1",
        json: { enabled: true },
      }),
      db as never,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; detail?: string };
    expect(json.error).toBe("validation_failed");
    expect(json.detail).toMatch(/host is required/i);
  });

  it("PUT enable=true without username and password when not reusing SMTP returns validation_failed", async () => {
    const db = baseDb({
      bounceIngestSettings: {
        findUnique: vi.fn().mockResolvedValue({
          id: "bis_1",
          event_id: "evt_1",
          imap_host: "imap.example.com",
          imap_port: 993,
          imap_username: null,
          imap_password_enc: null,
          reuse_smtp_credentials: false,
          folders: ["INBOX"],
          poll_interval_minutes: 5,
          enabled: false,
        }),
      },
    });

    const res = await handlePutEventBounceIngestSettings(
      mockContext({
        eventId: "evt_1",
        json: { enabled: true },
      }),
      db as never,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; detail?: string };
    expect(json.error).toBe("validation_failed");
    expect(json.detail).toMatch(/username and password are required/i);
  });

  it("PUT accepts folders as a CSV string", async () => {
    const upsert = vi.fn().mockResolvedValue({
      id: "bis_1",
      event_id: "evt_1",
      imap_host: "imap.example.com",
      imap_port: 993,
      imap_username: "bounce@example.com",
      imap_password_enc: "enc:pw",
      reuse_smtp_credentials: false,
      folders: ["INBOX", "Junk"],
      poll_interval_minutes: 5,
      enabled: false,
    });
    const db = baseDb({ bounceIngestSettings: { upsert } });

    const res = await handlePutEventBounceIngestSettings(
      mockContext({
        eventId: "evt_1",
        json: { folders: "INBOX, Junk" },
      }),
      db as never,
    );
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ folders: ["INBOX", "Junk"] }),
      }),
    );
  });

  it('PUT clears imap_host when an empty string is sent', async () => {
    const upsert = vi.fn().mockResolvedValue({
      id: "bis_1",
      event_id: "evt_1",
      imap_host: null,
      imap_port: 993,
      imap_username: "bounce@example.com",
      imap_password_enc: "enc:pw",
      reuse_smtp_credentials: false,
      folders: ["INBOX", "Junk Email"],
      poll_interval_minutes: 5,
      enabled: false,
    });
    const db = baseDb({ bounceIngestSettings: { upsert } });

    const res = await handlePutEventBounceIngestSettings(
      mockContext({
        eventId: "evt_1",
        json: { imap_host: "" },
      }),
      db as never,
    );
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ imap_host: null }),
      }),
    );
  });

  it("POST test without imap_host returns 400", async () => {
    const db = baseDb({
      bounceIngestSettings: {
        findUnique: vi.fn().mockResolvedValue({
          id: "bis_1",
          event_id: "evt_1",
          imap_host: null,
          imap_port: 993,
          imap_username: null,
          imap_password_enc: null,
          reuse_smtp_credentials: false,
          folders: ["INBOX"],
          poll_interval_minutes: 5,
          enabled: false,
        }),
      },
    });

    const res = await handlePostEventBounceIngestSettingsTest(
      mockContext({ eventId: "evt_1" }),
      db as never,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/save your bounce detection settings first/i);
    expect(testBounceImapConnection).not.toHaveBeenCalled();
  });

  it("POST test ok returns a Connected message", async () => {
    const row = {
      id: "bis_1",
      event_id: "evt_1",
      imap_host: "imap.example.com",
      imap_port: 993,
      imap_username: "bounce@example.com",
      imap_password_enc: "enc:pw",
      reuse_smtp_credentials: false,
      folders: ["INBOX"],
      poll_interval_minutes: 5,
      enabled: true,
    };
    const db = baseDb({
      bounceIngestSettings: { findUnique: vi.fn().mockResolvedValue(row) },
    });
    vi.mocked(testBounceImapConnection).mockResolvedValueOnce({
      ok: true,
      foldersChecked: 1,
    });

    const res = await handlePostEventBounceIngestSettingsTest(
      mockContext({ eventId: "evt_1" }),
      db as never,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; message?: string };
    expect(json.ok).toBe(true);
    expect(json.message).toMatch(/Connected/);
    expect(writeAdminAuditLog).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        actionType: "bounce_ingest_settings_tested",
        metadata: expect.objectContaining({ ok: true }),
      }),
    );
  });

  it("POST test fail returns ok:false with a sanitized error", async () => {
    const row = {
      id: "bis_1",
      event_id: "evt_1",
      imap_host: "imap.example.com",
      imap_port: 993,
      imap_username: "bounce@example.com",
      imap_password_enc: "enc:pw",
      reuse_smtp_credentials: false,
      folders: ["INBOX"],
      poll_interval_minutes: 5,
      enabled: true,
    };
    const db = baseDb({
      bounceIngestSettings: { findUnique: vi.fn().mockResolvedValue(row) },
    });
    vi.mocked(testBounceImapConnection).mockResolvedValueOnce({
      ok: false,
      error: "AUTH failed: secret-internal-detail",
    });
    vi.mocked(imapTestErrorForAdmin).mockReturnValueOnce("Authentication failed.");

    const res = await handlePostEventBounceIngestSettingsTest(
      mockContext({ eventId: "evt_1" }),
      db as never,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; error?: string };
    expect(json.ok).toBe(false);
    expect(json.error).toBe("Authentication failed.");
    expect(imapTestErrorForAdmin).toHaveBeenCalledWith("AUTH failed: secret-internal-detail");
    expect(JSON.stringify(json)).not.toContain("secret-internal-detail");
  });

  it("POST run returns 400 when settings are not saved", async () => {
    const db = baseDb({
      bounceIngestSettings: {
        findUnique: vi.fn().mockResolvedValue({
          id: "bis_1",
          event_id: "evt_1",
          imap_host: null,
          enabled: false,
        }),
      },
    });

    const res = await handlePostEventBounceIngestSettingsRun(
      mockContext({ eventId: "evt_1" }),
      db as never,
    );
    expect(res.status).toBe(400);
    expect(ingestBounces).not.toHaveBeenCalled();
  });

  it("POST run returns 400 when bounce detection is disabled", async () => {
    const db = baseDb({
      bounceIngestSettings: {
        findUnique: vi.fn().mockResolvedValue({
          id: "bis_1",
          event_id: "evt_1",
          imap_host: "imap.example.com",
          enabled: false,
        }),
      },
    });

    const res = await handlePostEventBounceIngestSettingsRun(
      mockContext({ eventId: "evt_1" }),
      db as never,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json.error).toMatch(/turn bounce detection on/i);
    expect(ingestBounces).not.toHaveBeenCalled();
  });

  it("POST run ingests bounces and returns lastRun", async () => {
    const row = {
      id: "bis_1",
      event_id: "evt_1",
      imap_host: "imap.example.com",
      imap_port: 993,
      imap_username: "bounce@example.com",
      imap_password_enc: "enc:pw",
      reuse_smtp_credentials: false,
      folders: ["INBOX"],
      poll_interval_minutes: 5,
      enabled: true,
      last_run_at: new Date("2026-08-06T10:00:00.000Z"),
      last_run_ok: true,
      last_run_summary: {
        messagesSeen: 2,
        bouncesApplied: 1,
        softBouncesLogged: 0,
        unparsed: 0,
        noMatchingDelivery: 0,
        errors: 0,
        connectFailed: false,
      },
    };
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(row);
    const db = baseDb({
      bounceIngestSettings: { findUnique },
    });
    vi.mocked(ingestBounces).mockResolvedValueOnce({
      eventsProcessed: 1,
      messagesSeen: 2,
      bouncesApplied: 1,
      softBouncesLogged: 0,
      unparsed: 0,
      noMatchingDelivery: 0,
      errors: 0,
      connectFailed: false,
    });

    const res = await handlePostEventBounceIngestSettingsRun(
      mockContext({ eventId: "evt_1" }),
      db as never,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      message: string;
      lastRun: { ok: boolean; messagesSeen: number } | null;
    };
    expect(json.ok).toBe(true);
    expect(json.message).toMatch(/check finished/i);
    expect(json.lastRun?.ok).toBe(true);
    expect(json.lastRun?.messagesSeen).toBe(2);
    expect(ingestBounces).toHaveBeenCalledWith(db, { eventId: "evt_1" });
    expect(writeAdminAuditLog).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        actionType: "bounce_ingest_manual_run",
        metadata: expect.objectContaining({ ok: true, eventId: "evt_1" }),
      }),
    );
  });

  it("POST run returns ok:false when connect fails", async () => {
    const row = {
      id: "bis_1",
      event_id: "evt_1",
      imap_host: "imap.example.com",
      imap_port: 993,
      imap_username: "bounce@example.com",
      imap_password_enc: "enc:pw",
      reuse_smtp_credentials: false,
      folders: ["INBOX"],
      poll_interval_minutes: 5,
      enabled: true,
      last_run_at: new Date("2026-08-06T10:00:00.000Z"),
      last_run_ok: false,
      last_run_summary: {
        messagesSeen: 0,
        bouncesApplied: 0,
        softBouncesLogged: 0,
        unparsed: 0,
        noMatchingDelivery: 0,
        errors: 1,
        connectFailed: true,
      },
    };
    const findUnique = vi.fn().mockResolvedValueOnce(row).mockResolvedValueOnce(row);
    const db = baseDb({ bounceIngestSettings: { findUnique } });
    vi.mocked(ingestBounces).mockResolvedValueOnce({
      eventsProcessed: 1,
      messagesSeen: 0,
      bouncesApplied: 0,
      softBouncesLogged: 0,
      unparsed: 0,
      noMatchingDelivery: 0,
      errors: 1,
      connectFailed: true,
    });

    const res = await handlePostEventBounceIngestSettingsRun(
      mockContext({ eventId: "evt_1" }),
      db as never,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; message: string };
    expect(json.ok).toBe(false);
    expect(json.message).toMatch(/could not connect/i);
  });

  it("POST run message mentions errors when connect works but ingest errors", async () => {
    const row = {
      id: "bis_1",
      event_id: "evt_1",
      imap_host: "imap.example.com",
      imap_port: 993,
      imap_username: "bounce@example.com",
      imap_password_enc: "enc:pw",
      reuse_smtp_credentials: false,
      folders: ["INBOX"],
      poll_interval_minutes: 5,
      enabled: true,
      last_run_at: new Date("2026-08-06T10:00:00.000Z"),
      last_run_ok: false,
      last_run_summary: {
        messagesSeen: 3,
        bouncesApplied: 0,
        softBouncesLogged: 0,
        unparsed: 0,
        noMatchingDelivery: 0,
        errors: 2,
        connectFailed: false,
      },
    };
    const findUnique = vi.fn().mockResolvedValueOnce(row).mockResolvedValueOnce(row);
    const db = baseDb({ bounceIngestSettings: { findUnique } });
    vi.mocked(ingestBounces).mockResolvedValueOnce({
      eventsProcessed: 1,
      messagesSeen: 3,
      bouncesApplied: 0,
      softBouncesLogged: 0,
      unparsed: 0,
      noMatchingDelivery: 0,
      errors: 2,
      connectFailed: false,
    });

    const res = await handlePostEventBounceIngestSettingsRun(
      mockContext({ eventId: "evt_1" }),
      db as never,
    );
    const json = (await res.json()) as { ok: boolean; message: string };
    expect(json.ok).toBe(false);
    expect(json.message).toMatch(/finished with errors/i);
  });

  it("POST run still returns lastRun when audit logging fails", async () => {
    const row = {
      id: "bis_1",
      event_id: "evt_1",
      imap_host: "imap.example.com",
      imap_port: 993,
      imap_username: "bounce@example.com",
      imap_password_enc: "enc:pw",
      reuse_smtp_credentials: false,
      folders: ["INBOX"],
      poll_interval_minutes: 5,
      enabled: true,
      last_run_at: new Date("2026-08-06T10:00:00.000Z"),
      last_run_ok: true,
      last_run_summary: {
        messagesSeen: 1,
        bouncesApplied: 0,
        softBouncesLogged: 0,
        unparsed: 0,
        noMatchingDelivery: 0,
        errors: 0,
        connectFailed: false,
      },
    };
    const findUnique = vi.fn().mockResolvedValueOnce(row).mockResolvedValueOnce(row);
    const db = baseDb({ bounceIngestSettings: { findUnique } });
    vi.mocked(ingestBounces).mockResolvedValueOnce({
      eventsProcessed: 1,
      messagesSeen: 1,
      bouncesApplied: 0,
      softBouncesLogged: 0,
      unparsed: 0,
      noMatchingDelivery: 0,
      errors: 0,
      connectFailed: false,
    });
    vi.mocked(writeAdminAuditLog).mockRejectedValueOnce(new Error("audit down"));

    const res = await handlePostEventBounceIngestSettingsRun(
      mockContext({ eventId: "evt_1" }),
      db as never,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; lastRun: { ok: boolean } | null };
    expect(json.ok).toBe(true);
    expect(json.lastRun?.ok).toBe(true);
  });

  it("PUT returns 404 when the event is missing", async () => {
    const db = baseDb({
      event: { findUnique: vi.fn().mockResolvedValue(null) },
    });

    const res = await handlePutEventBounceIngestSettings(
      mockContext({
        eventId: "evt_missing",
        json: { imap_host: "imap.example.com" },
      }),
      db as never,
    );
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("event_not_found");
  });

  it("PUT switches to SMTP reuse and clears dedicated IMAP credentials", async () => {
    const upsert = vi.fn().mockResolvedValue({
      id: "bis_1",
      event_id: "evt_1",
      imap_host: "imap.example.com",
      imap_port: 993,
      imap_username: null,
      imap_password_enc: null,
      reuse_smtp_credentials: true,
      folders: ["INBOX"],
      poll_interval_minutes: 5,
      enabled: false,
    });
    const db = baseDb({
      bounceIngestSettings: {
        findUnique: vi.fn().mockResolvedValue({
          id: "bis_1",
          event_id: "evt_1",
          imap_host: "imap.example.com",
          imap_port: 993,
          imap_username: "bounce@example.com",
          imap_password_enc: "enc:old",
          reuse_smtp_credentials: false,
          folders: ["INBOX"],
          poll_interval_minutes: 5,
          enabled: false,
        }),
        upsert,
      },
    });

    const res = await handlePutEventBounceIngestSettings(
      mockContext({
        eventId: "evt_1",
        json: { reuse_smtp_credentials: true },
      }),
      db as never,
    );
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          reuse_smtp_credentials: true,
          imap_password_enc: null,
          imap_username: null,
        }),
      }),
    );
    expect(writeAdminAuditLog).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        metadata: expect.objectContaining({ secrets_cleared: true }),
      }),
    );
  });

  it("PUT enable=true with SMTP reuse does not require dedicated IMAP credentials", async () => {
    const upsert = vi.fn().mockResolvedValue({
      id: "bis_1",
      event_id: "evt_1",
      imap_host: "imap.example.com",
      imap_port: 993,
      imap_username: null,
      imap_password_enc: null,
      reuse_smtp_credentials: true,
      folders: ["INBOX"],
      poll_interval_minutes: 5,
      enabled: true,
    });
    const db = baseDb({
      bounceIngestSettings: {
        findUnique: vi.fn().mockResolvedValue({
          id: "bis_1",
          event_id: "evt_1",
          imap_host: "imap.example.com",
          imap_port: 993,
          imap_username: null,
          imap_password_enc: null,
          reuse_smtp_credentials: true,
          folders: ["INBOX"],
          poll_interval_minutes: 5,
          enabled: false,
        }),
        upsert,
      },
    });

    const res = await handlePutEventBounceIngestSettings(
      mockContext({
        eventId: "evt_1",
        json: { enabled: true },
      }),
      db as never,
    );
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalled();
  });

  it("PUT clears imap_username when an empty string is sent", async () => {
    const upsert = vi.fn().mockResolvedValue({
      id: "bis_1",
      event_id: "evt_1",
      imap_host: "imap.example.com",
      imap_port: 993,
      imap_username: null,
      imap_password_enc: "enc:pw",
      reuse_smtp_credentials: false,
      folders: ["INBOX"],
      poll_interval_minutes: 5,
      enabled: false,
    });
    const db = baseDb({ bounceIngestSettings: { upsert } });

    const res = await handlePutEventBounceIngestSettings(
      mockContext({
        eventId: "evt_1",
        json: { imap_username: "" },
      }),
      db as never,
    );
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ imap_username: null }),
      }),
    );
  });

  it("PUT accepts poll_interval_minutes and enabled updates", async () => {
    const upsert = vi.fn().mockResolvedValue({
      id: "bis_1",
      event_id: "evt_1",
      imap_host: "imap.example.com",
      imap_port: 993,
      imap_username: "bounce@example.com",
      imap_password_enc: "enc:pw",
      reuse_smtp_credentials: false,
      folders: ["INBOX"],
      poll_interval_minutes: 30,
      enabled: true,
    });
    const db = baseDb({
      bounceIngestSettings: {
        findUnique: vi.fn().mockResolvedValue({
          id: "bis_1",
          event_id: "evt_1",
          imap_host: "imap.example.com",
          imap_port: 993,
          imap_username: "bounce@example.com",
          imap_password_enc: "enc:pw",
          reuse_smtp_credentials: false,
          folders: ["INBOX"],
          poll_interval_minutes: 5,
          enabled: false,
        }),
        upsert,
      },
    });

    const res = await handlePutEventBounceIngestSettings(
      mockContext({
        eventId: "evt_1",
        json: { poll_interval_minutes: 30, enabled: true },
      }),
      db as never,
    );
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ poll_interval_minutes: 30, enabled: true }),
      }),
    );
  });

  it("GET reports imap_password unset when SMTP reuse is on but SMTP password is missing", async () => {
    vi.mocked(describeMailConfig).mockResolvedValue({
      provider: { value: "smtp", source: "organization", locked: false },
      smtpPassword: { value: null, source: "default", locked: false },
      user: { value: "smtp-user", source: "organization", locked: false },
    } as never);
    const db = baseDb({
      bounceIngestSettings: {
        findUnique: vi.fn().mockResolvedValue({
          id: "bis_1",
          event_id: "evt_1",
          imap_host: "imap.example.com",
          imap_port: 993,
          imap_username: null,
          imap_password_enc: null,
          reuse_smtp_credentials: true,
          folders: ["INBOX"],
          poll_interval_minutes: 5,
          enabled: true,
        }),
      },
    });

    const res = await handleGetEventBounceIngestSettings(
      mockContext({ eventId: "evt_1" }),
      db as never,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { imap_password: Record<string, unknown> };
    expect(json.imap_password).toEqual({
      set: false,
      masked: null,
      source: "default",
      locked: false,
      from_smtp: true,
    });
  });

  it("POST test returns 404 when the event is missing", async () => {
    const db = baseDb({
      event: { findUnique: vi.fn().mockResolvedValue(null) },
    });

    const res = await handlePostEventBounceIngestSettingsTest(
      mockContext({ eventId: "evt_missing" }),
      db as never,
    );
    expect(res.status).toBe(404);
    expect(testBounceImapConnection).not.toHaveBeenCalled();
  });

  it("POST test ok pluralizes folder count in the message", async () => {
    const row = {
      id: "bis_1",
      event_id: "evt_1",
      imap_host: "imap.example.com",
      imap_port: 993,
      imap_username: "bounce@example.com",
      imap_password_enc: "enc:pw",
      reuse_smtp_credentials: false,
      folders: ["INBOX", "Junk Email"],
      poll_interval_minutes: 5,
      enabled: true,
    };
    const db = baseDb({
      bounceIngestSettings: { findUnique: vi.fn().mockResolvedValue(row) },
    });
    vi.mocked(testBounceImapConnection).mockResolvedValueOnce({
      ok: true,
      foldersChecked: 2,
    });

    const res = await handlePostEventBounceIngestSettingsTest(
      mockContext({ eventId: "evt_1" }),
      db as never,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; message?: string };
    expect(json.message).toMatch(/2 folders/);
  });

  it("returns the requireSuperadmin response when access is denied", async () => {
    const forbidden = new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
    vi.mocked(requireSuperadmin).mockResolvedValueOnce(forbidden);
    const db = baseDb();

    const res = await handleGetEventBounceIngestSettings(
      mockContext({ eventId: "evt_1" }),
      db as never,
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("forbidden");
    expect(db.event.findUnique).not.toHaveBeenCalled();
  });

  it("PUT ignores empty imap_password string without rotating secrets", async () => {
    const upsert = vi.fn().mockResolvedValue({
      id: "bis_1",
      event_id: "evt_1",
      imap_host: "imap.example.com",
      imap_port: 993,
      imap_username: "bounce@example.com",
      imap_password_enc: "enc:existing",
      reuse_smtp_credentials: false,
      folders: ["INBOX"],
      poll_interval_minutes: 5,
      enabled: false,
    });
    const db = baseDb({ bounceIngestSettings: { upsert } });

    const res = await handlePutEventBounceIngestSettings(
      mockContext({
        eventId: "evt_1",
        json: { imap_password: "" },
      }),
      db as never,
    );
    expect(res.status).toBe(200);
    expect(encryptToString).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.not.objectContaining({ imap_password_enc: expect.anything() }),
      }),
    );
  });

  it("PUT accepts folders as an array", async () => {
    const upsert = vi.fn().mockResolvedValue({
      id: "bis_1",
      event_id: "evt_1",
      imap_host: "imap.example.com",
      imap_port: 993,
      imap_username: "bounce@example.com",
      imap_password_enc: "enc:pw",
      reuse_smtp_credentials: false,
      folders: ["INBOX", "Spam"],
      poll_interval_minutes: 5,
      enabled: false,
    });
    const db = baseDb({ bounceIngestSettings: { upsert } });

    const res = await handlePutEventBounceIngestSettings(
      mockContext({
        eventId: "evt_1",
        json: { folders: ["INBOX", "Spam"] },
      }),
      db as never,
    );
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ folders: ["INBOX", "Spam"] }),
      }),
    );
  });
});
