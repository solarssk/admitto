import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import { probeMailTransport } from "../src/probe.js";
import type { FetchFn, MailerAdapter } from "../src/types.js";
import { SmtpAdapter } from "../src/adapters/smtp.js";
import type { SmtpConfig } from "../src/config.js";
import * as factory from "../src/factory.js";
import * as errorMapping from "../src/errorMapping.js";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

const mockedLookup = vi.mocked(lookup);

beforeEach(() => {
  mockedLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as Awaited<
    ReturnType<typeof lookup>
  >);
  vi.restoreAllMocks();
});

const smtpConfig: SmtpConfig = {
  provider: "smtp",
  host: "smtp.example.com",
  port: 587,
  secure: false,
  user: "u",
  password: "p",
  requireTLS: true,
  tlsRejectUnauthorized: true,
  pool: true,
  maxConnections: 3,
  maxMessages: 100,
  rateLimitPerMinute: 30,
  connectionTimeout: 30_000,
  greetingTimeout: 30_000,
  socketTimeout: 60_000,
  fromAddress: "events@example.com",
  fromName: "Admitto Events",
  envelopeFrom: "bounce@example.com",
};

describe("probeMailTransport", () => {
  it("probes Graph by fetching a client-credentials token", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({ access_token: "tok", expires_in: 3600 }),
    ) as unknown as FetchFn;

    const result = await probeMailTransport(
      {
        provider: "graph",
        mailbox: "mail@example.com",
        tenantId: "tenant",
        clientId: "client",
        clientSecret: "secret",
      },
      { fetchFn },
    );

    expect(result).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalled();
    const init = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns ok:false when Graph token fetch fails", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({ error: "invalid_client", error_description: "bad secret" }, { status: 401 }),
    ) as unknown as FetchFn;

    const result = await probeMailTransport(
      {
        provider: "graph",
        mailbox: "mail@example.com",
        tenantId: "tenant",
        clientId: "client",
        clientSecret: "secret",
      },
      { fetchFn },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Graph token error/i);
      expect(result.error).not.toContain("bad secret");
    }
  });

  it("skips live verify for Power Automate after create succeeds", async () => {
    const result = await probeMailTransport({
      provider: "powerautomate",
      url: "https://prod.example.com/workflows/hook",
      fromAddress: "from@example.com",
    });

    expect(result).toEqual({ ok: true, skipped: true });
  });

  it("skips live verify for export_only", async () => {
    const result = await probeMailTransport(
      { provider: "export_only", fromAddress: "from@example.com" },
      { exportSink: vi.fn() },
    );
    expect(result).toEqual({ ok: true, skipped: true });
  });

  it("probes SMTP via verifyConnection", async () => {
    const verify = vi.fn(async () => undefined);
    const close = vi.fn();
    const adapter = new SmtpAdapter(smtpConfig, {
      verify,
      close,
      sendMail: vi.fn(),
    } as never);
    vi.spyOn(factory, "createMailer").mockResolvedValueOnce(adapter);

    const result = await probeMailTransport({ provider: "smtp" });
    expect(result).toEqual({ ok: true });
    expect(verify).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("skips verify for non-SMTP/Graph adapters returned by the factory", async () => {
    const close = vi.fn(async () => undefined);
    const adapter = {
      provider: "smtp",
      capabilities: {},
      close,
      send: vi.fn(),
    } as unknown as MailerAdapter;
    vi.spyOn(factory, "createMailer").mockResolvedValueOnce(adapter);

    const result = await probeMailTransport({ provider: "smtp" });
    expect(result).toEqual({ ok: true, skipped: true });
    expect(close).toHaveBeenCalled();
  });

  it("returns ok:false when createMailer rejects (invalid config)", async () => {
    const result = await probeMailTransport({ provider: "smtp" });
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when probeTimeoutMs is already elapsed", async () => {
    const fetchFn = vi.fn(() => new Promise<Response>(() => {})) as unknown as FetchFn;
    const result = await probeMailTransport(
      {
        provider: "graph",
        mailbox: "mail@example.com",
        tenantId: "tenant",
        clientId: "client",
        clientSecret: "secret",
      },
      { fetchFn, probeTimeoutMs: 0 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/timed out/i);
    }
  });

  it("returns ok:false for non-Error create failures and empty sanitized messages", async () => {
    vi.spyOn(factory, "createMailer").mockRejectedValueOnce("raw-fail");
    const raw = await probeMailTransport({ provider: "smtp" });
    expect(raw.ok).toBe(false);

    vi.spyOn(factory, "createMailer").mockRejectedValueOnce(new Error("secret-token-xyz"));
    vi.spyOn(errorMapping, "sanitizeProviderErrorForLog").mockReturnValueOnce("");
    const empty = await probeMailTransport({ provider: "smtp" });
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.error).toBe("Connection probe failed");
    }
  });

  it("returns ok:false when the Graph token fetch never settles before probe timeout", async () => {
    const fetchFn = vi.fn(() => new Promise<Response>(() => {})) as unknown as FetchFn;
    const result = await probeMailTransport(
      {
        provider: "graph",
        mailbox: "mail@example.com",
        tenantId: "tenant",
        clientId: "client",
        clientSecret: "secret",
      },
      { fetchFn, probeTimeoutMs: 40 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/timed out/i);
    }
  });
});
