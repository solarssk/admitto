import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "hono";
import {
  handleGetEventBounceIngestSettings,
  handlePutEventBounceIngestSettings,
} from "../../src/admin/event-bounce-ingest-settings-routes.js";

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

describe("event bounce ingest settings routes", () => {
  // Same escape-hatch env var as @admitto/mailer's SSRF guard - clear it so a dev's local
  // ALLOW_PRIVATE_MAIL_DESTINATIONS=true (used for lab SMTP) can't silently bypass the
  // "rejects a private imap_host" case below.
  const envKey = "ALLOW_PRIVATE_MAIL_DESTINATIONS";
  let previousPrivateMailOverride: string | undefined;

  beforeEach(() => {
    previousPrivateMailOverride = process.env[envKey];
    delete process.env[envKey];
  });

  afterEach(() => {
    if (previousPrivateMailOverride === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = previousPrivateMailOverride;
    }
  });

  it("GET returns masked password presence and never a secret value", async () => {
    const db = {
      event: {
        findUnique: vi.fn().mockResolvedValue({ organization_id: "org_1" }),
      },
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
    };

    const res = await handleGetEventBounceIngestSettings(
      mockContext({ eventId: "evt_1" }),
      db as never,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.imap_password).toEqual({
      set: true,
      masked: "••••",
      from_smtp: false,
    });
    expect(JSON.stringify(json)).not.toContain("encrypted-blob");
  });

  it("PUT rejects SMTP reuse when effective provider is not SMTP", async () => {
    const { describeMailConfig } = await import("@admitto/mailer-config");
    vi.mocked(describeMailConfig).mockResolvedValueOnce({
      provider: { value: "graph", source: "organization", locked: false },
      smtpPassword: { value: null, source: "default", locked: false },
    } as never);

    const db = {
      event: {
        findUnique: vi.fn().mockResolvedValue({ organization_id: "org_1" }),
      },
      bounceIngestSettings: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

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
    const db = {
      event: {
        findUnique: vi.fn().mockResolvedValue({ organization_id: "org_1" }),
      },
      bounceIngestSettings: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

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
});
