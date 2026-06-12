import nodemailer from "nodemailer";
import { describe, expect, it, vi } from "vitest";
import { GraphAdapter } from "../src/adapters/graph.js";
import { SmtpAdapter } from "../src/adapters/smtp.js";
import { PowerAutomateAdapter } from "../src/adapters/powerAutomate.js";
import { ExportOnlyAdapter } from "../src/adapters/exportOnly.js";
import {
  EXPORT_ONLY_CAPABILITIES,
  GRAPH_CAPABILITIES,
  POWER_AUTOMATE_CAPABILITIES,
  SMTP_CAPABILITIES,
} from "../src/capabilities.js";

describe("adapter capabilities", () => {
  it("Graph exposes sent-items support", () => {
    const adapter = new GraphAdapter(
      {
        provider: "graph",
        mailbox: "a@example.com",
        tenantId: "t",
        clientId: "c",
        clientSecret: "s",
      },
      vi.fn() as unknown as typeof fetch,
    );
    expect(adapter.capabilities).toEqual(GRAPH_CAPABILITIES);
  });

  it("SMTP supports envelope-from but not sent items", () => {
    const adapter = new SmtpAdapter(
      {
        provider: "smtp",
        host: "h",
        user: "u",
        password: "p",
        fromAddress: "a@example.com",
      },
      nodemailer.createTransport({ jsonTransport: true }),
    );
    expect(adapter.capabilities).toEqual(SMTP_CAPABILITIES);
  });

  it("Power Automate is conservative", () => {
    const adapter = new PowerAutomateAdapter(
      { provider: "powerautomate", url: "https://example.com/f", fromAddress: "a@example.com" },
      vi.fn() as unknown as typeof fetch,
    );
    expect(adapter.capabilities).toEqual(POWER_AUTOMATE_CAPABILITIES);
  });

  it("export_only exposes test-connection only", () => {
    const adapter = new ExportOnlyAdapter({ provider: "export_only", fromAddress: "a@example.com" });
    expect(adapter.capabilities).toEqual(EXPORT_ONLY_CAPABILITIES);
  });
});
