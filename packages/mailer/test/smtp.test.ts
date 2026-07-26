import nodemailer from "nodemailer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import { SmtpAdapter } from "../src/adapters/smtp.js";
import type { SmtpConfig } from "../src/config.js";
import * as ssrfGuard from "../src/ssrfGuard.js";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

const mockedLookup = vi.mocked(lookup);

beforeEach(() => {
  mockedLookup.mockClear();
  mockedLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as Awaited<
    ReturnType<typeof lookup>
  >);
  resetSystemLogBufferForTest();
});

const config: SmtpConfig = {
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

describe("SmtpAdapter", () => {
  it("sends via injected transporter (jsonTransport) => accepted + messageId", async () => {
    const transporter = nodemailer.createTransport({ jsonTransport: true });
    const adapter = new SmtpAdapter(config, transporter);

    const res = await adapter.send({
      to: "jan@example.com",
      subject: "Ticket",
      html: "<p>hello</p>",
      idempotencyKey: "att-9",
    });

    expect(res.status).toBe("accepted");
    expect(res.provider).toBe("smtp");
    expect(res.providerMessageId).toBeTruthy();
    expect(res.idempotencyKey).toBe("att-9");
    expect(adapter.capabilities.supportsEnvelopeFrom).toBe(true);

    const mailLogs = querySystemLogs({ source: "mail" });
    expect(mailLogs).toContainEqual(
      expect.objectContaining({
        message: "mail_sent",
        fields: expect.objectContaining({ to: "j***@example.com" }),
      }),
    );

    for (const entry of querySystemLogs()) {
      expect(JSON.stringify(entry)).not.toContain("jan@example.com");
    }
  });

  it("formats From header and envelope.from from sender config", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "<id@test>" }));
    const adapter = new SmtpAdapter(config, { sendMail } as unknown as nodemailer.Transporter);

    await adapter.send({ to: "jan@example.com", subject: "S", html: "<p>h</p>", replyTo: "reply@example.com" });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '"Admitto Events" <events@example.com>',
        replyTo: "reply@example.com",
        envelope: { from: "bounce@example.com", to: ["jan@example.com"] },
      }),
    );
  });

  it("includes CC recipients in envelope.to when envelopeFrom is set", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "<id@test>" }));
    const adapter = new SmtpAdapter(config, { sendMail } as unknown as nodemailer.Transporter);

    await adapter.send({
      to: "jan@example.com",
      cc: "cc1@example.com, cc2@example.com",
      subject: "S",
      html: "<p>h</p>",
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: {
          from: "bounce@example.com",
          to: ["jan@example.com", "cc1@example.com", "cc2@example.com"],
        },
      }),
    );
  });

  it("omits envelope when envelopeFrom is not configured", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "<id@test>" }));
    const { envelopeFrom: _drop, ...noEnvelope } = config;
    const adapter = new SmtpAdapter(noEnvelope, { sendMail } as unknown as nodemailer.Transporter);

    await adapter.send({ to: "jan@example.com", subject: "S", html: "<p>h</p>" });

    const args = sendMail.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.envelope).toBeUndefined();
  });

  it("creates transporter with pooling and rate limit from config", () => {
    const createSpy = vi.spyOn(nodemailer, "createTransport");
    SmtpAdapter.createTransporter(config);
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        pool: true,
        maxConnections: 3,
        rateLimit: 30,
        rateDelta: 60_000,
        requireTLS: true,
        tls: expect.objectContaining({
          servername: "smtp.example.com",
          minVersion: "TLSv1.2",
        }),
      }),
    );
    createSpy.mockRestore();
  });

  it("returns rejected when message fails validation", async () => {
    const transporter = nodemailer.createTransport({ jsonTransport: true });
    const adapter = new SmtpAdapter(config, transporter);
    const res = await adapter.send({
      to: "not-an-email",
      subject: "S",
      html: "<p>h</p>",
    });
    expect(res.status).toBe("rejected");
    expect(res.retryable).toBe(false);
  });

  it("returns rejected (no throw) when the transport throws 535 auth error", async () => {
    const failing = {
      sendMail: async () => {
        throw new Error("535 auth disabled");
      },
    } as unknown as nodemailer.Transporter;
    const adapter = new SmtpAdapter(config, failing);
    const res = await adapter.send({ to: "x@example.com", subject: "S", html: "<p>h</p>" });
    expect(res.status).toBe("rejected");
    expect(res.retryable).toBe(false);
    expect(res.error).toContain("535");

    expect(querySystemLogs({ source: "mail" })).toContainEqual(
      expect.objectContaining({
        message: "mail_send_failed",
        fields: expect.objectContaining({ error: expect.stringContaining("535") }),
      }),
    );
  });

  it("rejects a private/loopback host without ever calling sendMail (SSRF guard)", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "<id@test>" }));
    const adapter = new SmtpAdapter(
      { ...config, host: "127.0.0.1" },
      { sendMail } as unknown as nodemailer.Transporter,
    );
    const res = await adapter.send({ to: "x@example.com", subject: "S", html: "<p>h</p>" });
    expect(res.status).toBe("rejected");
    expect(res.retryable).toBe(false);
    expect(res.error).toMatch(/private, loopback, or link-local/);
    expect(sendMail).not.toHaveBeenCalled();

    // The logged reason is a fixed category, not the raw guard message - a DNS-lookup
    // failure (a different throw site than this one) could otherwise surface the
    // configured hostname in System logs/stdout.
    const logs = querySystemLogs({ source: "security" });
    expect(
      logs.some(
        (entry) =>
          entry.message === "mail_destination_blocked" &&
          entry.level === "warn" &&
          entry.fields?.error === "destination blocked or unresolvable",
      ),
    ).toBe(true);
  });

  it("falls back to a generic message when the destination guard throws a non-Error", async () => {
    const spy = vi
      .spyOn(ssrfGuard, "assertSafeMailDestination")
      .mockRejectedValueOnce("not-an-error");
    const sendMail = vi.fn(async () => ({ messageId: "<id@test>" }));
    const adapter = new SmtpAdapter(config, { sendMail } as unknown as nodemailer.Transporter);
    const res = await adapter.send({ to: "x@example.com", subject: "S", html: "<p>h</p>" });
    expect(res.status).toBe("rejected");
    expect(res.error).toBe("mail transport destination is not permitted");
    expect(sendMail).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("rejects a host that resolves to a private address at send-time (DNS rebinding)", async () => {
    mockedLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }] as Awaited<
      ReturnType<typeof lookup>
    >);
    const sendMail = vi.fn(async () => ({ messageId: "<id@test>" }));
    const adapter = new SmtpAdapter(config, { sendMail } as unknown as nodemailer.Transporter);
    const res = await adapter.send({ to: "x@example.com", subject: "S", html: "<p>h</p>" });
    expect(res.status).toBe("rejected");
    expect(sendMail).not.toHaveBeenCalled();
  });

  describe("SmtpAdapter.create() — DNS pinning (production path)", () => {
    it("pins the transporter's connect target to the resolved address, keeping the real hostname for SNI", async () => {
      const createSpy = vi.spyOn(nodemailer, "createTransport");
      const adapter = await SmtpAdapter.create(config);

      expect(mockedLookup).toHaveBeenCalledTimes(1);
      expect(mockedLookup).toHaveBeenCalledWith("smtp.example.com", expect.anything());
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          host: "93.184.216.34",
          tls: expect.objectContaining({ servername: "smtp.example.com" }),
        }),
      );
      expect(adapter.provider).toBe("smtp");
      createSpy.mockRestore();
    });

    it("rejects when the host resolves to a private address, without building a transporter (DNS rebinding closed)", async () => {
      mockedLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }] as Awaited<
        ReturnType<typeof lookup>
      >);
      const createSpy = vi.spyOn(nodemailer, "createTransport");

      await expect(SmtpAdapter.create(config)).rejects.toThrow(/private or link-local/);
      expect(createSpy).not.toHaveBeenCalled();
      createSpy.mockRestore();
    });

    it("pins to the first resolved record when DNS returns multiple addresses", async () => {
      mockedLookup.mockResolvedValue([
        { address: "93.184.216.34", family: 4 },
        { address: "203.0.113.9", family: 4 },
      ] as Awaited<ReturnType<typeof lookup>>);
      const createSpy = vi.spyOn(nodemailer, "createTransport");

      await SmtpAdapter.create(config);

      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ host: "93.184.216.34" }));
      createSpy.mockRestore();
    });
  });
});
