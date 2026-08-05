import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "hono";
import { handlePostEventMailSettingsTest } from "../../src/admin/event-mail-settings-routes.js";
import { requireSuperadmin } from "../../src/admin/admin-helpers.js";
import { writeAdminAuditLog } from "@admitto/tickets";
import { runEventBounceProbe, BounceProbeSetupError } from "@admitto/mail-delivery";

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

vi.mock("@admitto/tickets", () => ({
  writeAdminAuditLog: vi.fn(async () => undefined),
}));

vi.mock("@admitto/mail-delivery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/mail-delivery")>();
  return {
    ...actual,
    sendEventTransportTestEmail: vi.fn(),
    runEventBounceProbe: vi.fn(),
  };
});

function mockContext(opts: { eventId: string; json?: unknown }): Context {
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

function baseDb(overrides: { event?: { findUnique: ReturnType<typeof vi.fn> } } = {}) {
  return {
    event: {
      findUnique:
        overrides.event?.findUnique ??
        vi.fn().mockResolvedValue({ organization_id: "org_1" }),
    },
  };
}

describe("handlePostEventMailSettingsTest verifyBounce path", () => {
  beforeEach(() => {
    vi.mocked(requireSuperadmin).mockResolvedValue(null);
    vi.mocked(writeAdminAuditLog).mockClear();
    vi.mocked(runEventBounceProbe).mockReset();
  });

  it("runs runEventBounceProbe and returns sent with bounceProbe metadata", async () => {
    vi.mocked(runEventBounceProbe).mockResolvedValueOnce({
      status: "ok",
      message: "Bounce received. Delivery marked bounced.",
      smtpCode: "550",
      sendResult: {
        status: "sent",
        provider: "smtp",
        providerMessageId: "<mid@example.com>",
      },
    });
    const db = baseDb();

    const res = await handlePostEventMailSettingsTest(
      mockContext({
        eventId: "evt_1",
        json: { to: "nobody@example.com", verifyBounce: true },
      }),
      db as never,
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      status: string;
      provider: string;
      providerMessageId?: string;
      bounceProbe?: { status: string; message: string; smtpCode?: string };
    };
    expect(json.status).toBe("sent");
    expect(json.provider).toBe("smtp");
    expect(json.bounceProbe).toMatchObject({
      status: "ok",
      message: "Bounce received. Delivery marked bounced.",
      smtpCode: "550",
    });
    expect(runEventBounceProbe).toHaveBeenCalledWith(
      { eventId: "evt_1", toAddress: "nobody@example.com" },
      db,
      process.env,
      {},
    );
    expect(writeAdminAuditLog).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        actionType: "event_mail_bounce_probed",
        metadata: expect.objectContaining({
          eventId: "evt_1",
          result: "ok",
          send: "sent",
        }),
      }),
    );
  });

  it("returns failed when the probe send is not successful", async () => {
    vi.mocked(runEventBounceProbe).mockResolvedValueOnce({
      status: "failed",
      message: "Bounce check failed.",
      sendResult: {
        status: "failed",
        provider: "smtp",
        // Raw provider text must be remapped via transportTestErrorForAdmin, not echoed.
        error: "AADSTS700016: Application with identifier 'secret-client' was not found",
      },
    });
    const db = baseDb();

    const res = await handlePostEventMailSettingsTest(
      mockContext({
        eventId: "evt_1",
        json: { to: "nobody@example.com", verifyBounce: true },
      }),
      db as never,
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string; error?: string; bounceProbe?: { status: string } };
    expect(json.status).toBe("failed");
    expect(json.error).toMatch(/Microsoft Graph authentication failed/i);
    expect(json.error).not.toMatch(/AADSTS|secret-client/i);
    expect(json.bounceProbe?.status).toBe("failed");
  });

  it("returns 400 validation_failed for malformed JSON", async () => {
    const ctx = {
      req: {
        param: (name: string) => (name === "eventId" ? "evt_1" : undefined),
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      },
      json: (data: unknown, status?: number) =>
        new Response(JSON.stringify(data), {
          status: status ?? 200,
          headers: { "content-type": "application/json" },
        }),
      get: () => ({ userId: "user_1", sessionId: "sess_1" }),
    } as unknown as Context;

    const res = await handlePostEventMailSettingsTest(ctx, baseDb() as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("validation_failed");
  });

  it("returns 400 bounce_probe_unavailable when setup fails", async () => {
    vi.mocked(runEventBounceProbe).mockRejectedValueOnce(
      new BounceProbeSetupError("Turn bounce detection On and save before verifying bounce."),
    );
    const db = baseDb();

    const res = await handlePostEventMailSettingsTest(
      mockContext({
        eventId: "evt_1",
        json: { to: "nobody@example.com", verifyBounce: true },
      }),
      db as never,
    );

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; detail?: string };
    expect(json.error).toBe("bounce_probe_unavailable");
    expect(json.detail).toMatch(/Turn bounce detection On/);
  });

  it("returns timeout bounceProbe metadata when the probe times out", async () => {
    vi.mocked(runEventBounceProbe).mockResolvedValueOnce({
      status: "timeout",
      message:
        "Mail was accepted by the transport, but no matching bounce appeared in IMAP within 90 seconds.",
      sendResult: {
        status: "sent",
        provider: "smtp",
        providerMessageId: "<mid@example.com>",
      },
    });
    const db = baseDb();

    const res = await handlePostEventMailSettingsTest(
      mockContext({
        eventId: "evt_1",
        json: { to: "nobody@example.com", verifyBounce: true },
      }),
      db as never,
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      status: string;
      bounceProbe?: { status: string; message: string };
    };
    expect(json.status).toBe("sent");
    expect(json.bounceProbe).toMatchObject({
      status: "timeout",
      message: expect.stringMatching(/no matching bounce appeared/i),
    });
    expect(writeAdminAuditLog).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        actionType: "event_mail_bounce_probed",
        metadata: expect.objectContaining({ result: "timeout", send: "sent" }),
      }),
    );
  });

  it("returns 404 when the event is missing", async () => {
    const db = baseDb({
      event: { findUnique: vi.fn().mockResolvedValue(null) },
    });

    const res = await handlePostEventMailSettingsTest(
      mockContext({
        eventId: "evt_missing",
        json: { to: "nobody@example.com", verifyBounce: true },
      }),
      db as never,
    );

    expect(res.status).toBe(404);
    expect(runEventBounceProbe).not.toHaveBeenCalled();
  });
});
