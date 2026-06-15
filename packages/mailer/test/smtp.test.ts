import nodemailer from "nodemailer";
import { describe, expect, it, vi } from "vitest";
import { SmtpAdapter } from "../src/adapters/smtp.js";
import type { SmtpConfig } from "../src/config.js";

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
  });
});
