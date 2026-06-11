import { describe, expect, it } from "vitest";
import { configFromEnv } from "../src/configFromEnv.js";

describe("configFromEnv", () => {
  it("builds powerautomate config from new env names", () => {
    const cfg = configFromEnv({
      EMAIL_PROVIDER: "powerautomate",
      POWER_AUTOMATE_URL: "https://example.com/flow",
      MAIL_FROM_ADDRESS: "events@example.com",
    } as NodeJS.ProcessEnv);
    expect(cfg.provider).toBe("powerautomate");
    if (cfg.provider !== "powerautomate") throw new Error("unexpected");
    expect(cfg.fromAddress).toBe("events@example.com");
  });

  it("builds smtp config with TLS/throughput defaults", () => {
    const cfg = configFromEnv({
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "relay.example.com",
      SMTP_USER: "u",
      SMTP_PASSWORD: "p",
      MAIL_FROM_ADDRESS: "from@example.com",
    } as NodeJS.ProcessEnv);
    if (cfg.provider !== "smtp") throw new Error("unexpected");
    expect(cfg.host).toBe("relay.example.com");
    expect(cfg.pool).toBe(true);
    expect(cfg.rateLimitPerMinute).toBe(30);
  });

  it("builds graph config with GRAPH_MAILBOX fallback to MAIL_FROM_ADDRESS", () => {
    const cfg = configFromEnv({
      EMAIL_PROVIDER: "graph",
      GRAPH_TENANT_ID: "t",
      GRAPH_CLIENT_ID: "c",
      GRAPH_CLIENT_SECRET: "s",
      MAIL_FROM_ADDRESS: "events@example.com",
      MAIL_FROM_NAME: "Events",
    } as NodeJS.ProcessEnv);
    if (cfg.provider !== "graph") throw new Error("unexpected");
    expect(cfg.mailbox).toBe("events@example.com");
    expect(cfg.fromName).toBe("Events");
  });

  it("uses GRAPH_MAILBOX when set", () => {
    const cfg = configFromEnv({
      EMAIL_PROVIDER: "graph",
      GRAPH_TENANT_ID: "t",
      GRAPH_CLIENT_ID: "c",
      GRAPH_CLIENT_SECRET: "s",
      GRAPH_MAILBOX: "mailbox@example.com",
      MAIL_FROM_ADDRESS: "display@example.com",
    } as NodeJS.ProcessEnv);
    if (cfg.provider !== "graph") throw new Error("unexpected");
    expect(cfg.mailbox).toBe("mailbox@example.com");
    expect(cfg.fromAddress).toBe("display@example.com");
  });

  it("builds export_only config", () => {
    const cfg = configFromEnv({
      EMAIL_PROVIDER: "export_only",
      MAIL_FROM_ADDRESS: "export@example.com",
    } as NodeJS.ProcessEnv);
    expect(cfg.provider).toBe("export_only");
  });

  it("parses bool env vars", () => {
    const cfg = configFromEnv({
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "h",
      SMTP_USER: "u",
      SMTP_PASSWORD: "p",
      MAIL_FROM_ADDRESS: "a@example.com",
      SMTP_SECURE: "true",
      SMTP_REQUIRE_TLS: "false",
    } as NodeJS.ProcessEnv);
    if (cfg.provider !== "smtp") throw new Error("unexpected");
    expect(cfg.secure).toBe(true);
    expect(cfg.requireTLS).toBe(false);
  });

  it("throws when EMAIL_PROVIDER is missing", () => {
    expect(() => configFromEnv({} as NodeJS.ProcessEnv)).toThrow(/EMAIL_PROVIDER/);
  });

  it("throws on malformed boolean env values", () => {
    expect(() =>
      configFromEnv({
        EMAIL_PROVIDER: "smtp",
        SMTP_HOST: "h",
        SMTP_USER: "u",
        SMTP_PASSWORD: "p",
        MAIL_FROM_ADDRESS: "a@example.com",
        SMTP_REQUIRE_TLS: "treu",
      } as NodeJS.ProcessEnv),
    ).toThrow(/SMTP_REQUIRE_TLS/);
  });

  it("throws on malformed integer env values", () => {
    expect(() =>
      configFromEnv({
        EMAIL_PROVIDER: "smtp",
        SMTP_HOST: "h",
        SMTP_USER: "u",
        SMTP_PASSWORD: "p",
        MAIL_FROM_ADDRESS: "a@example.com",
        SMTP_PORT: "58x",
      } as NodeJS.ProcessEnv),
    ).toThrow(/SMTP_PORT/);
  });
});
