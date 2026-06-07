import nodemailer from "nodemailer";
import { describe, expect, it } from "vitest";
import { SmtpAdapter } from "../src/adapters/smtp.js";
import type { SmtpConfig } from "../src/config.js";

const config: SmtpConfig = {
  provider: "smtp",
  host: "smtp.example.com",
  port: 587,
  secure: false,
  user: "u",
  password: "p",
  from: "events@example.com",
};

describe("SmtpAdapter", () => {
  it("sends via injected transporter (jsonTransport) => sent + messageId", async () => {
    // jsonTransport does not send a real email — serialises the message and returns info.
    const transporter = nodemailer.createTransport({ jsonTransport: true });
    const adapter = new SmtpAdapter(config, transporter);

    const res = await adapter.send({
      to: "jan@example.com",
      subject: "Ticket",
      html: "<p>hello</p>",
      idempotencyKey: "att-9",
    });

    expect(res.status).toBe("sent");
    expect(res.provider).toBe("smtp");
    expect(res.providerMessageId).toBeTruthy();
    expect(res.idempotencyKey).toBe("att-9");
  });

  it("returns failed (no throw) when the transport throws", async () => {
    const failing = {
      sendMail: async () => {
        throw new Error("535 auth disabled");
      },
    } as unknown as nodemailer.Transporter;
    const adapter = new SmtpAdapter(config, failing);
    const res = await adapter.send({ to: "x@example.com", subject: "S", html: "<p>h</p>" });
    expect(res.status).toBe("failed");
    expect(res.error).toContain("535");
  });
});
