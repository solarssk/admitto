import { describe, expect, it } from "vitest";
import { parseMailerConfig, safeParseMailerConfig } from "../src/config.js";

describe("config", () => {
  it("validates powerautomate config and requires a URL + fromAddress", () => {
    const ok = parseMailerConfig({
      provider: "powerautomate",
      url: "https://example.com/flow",
      fromAddress: "events@example.com",
    });
    expect(ok.provider).toBe("powerautomate");

    const bad = safeParseMailerConfig({ provider: "powerautomate", url: "not-a-url", fromAddress: "a@example.com" });
    expect(bad.success).toBe(false);
  });

  it("validates smtp with sender fields and sets default port/secure/TLS/throughput", () => {
    const cfg = parseMailerConfig({
      provider: "smtp",
      host: "smtp.example.com",
      user: "u",
      password: "p",
      fromAddress: "from@example.com",
    });
    if (cfg.provider !== "smtp") throw new Error("unexpected provider");
    expect(cfg.port).toBe(587);
    expect(cfg.secure).toBe(false);
    expect(cfg.requireTLS).toBe(true);
    expect(cfg.pool).toBe(true);
    expect(cfg.maxConnections).toBe(3);
    expect(cfg.rateLimitPerMinute).toBe(30);
  });

  it("validates graph with mailbox and optional display sender", () => {
    const cfg = parseMailerConfig({
      provider: "graph",
      mailbox: "events@example.com",
      tenantId: "t",
      clientId: "c",
      clientSecret: "s",
      fromName: "Admitto",
    });
    if (cfg.provider !== "graph") throw new Error("unexpected provider");
    expect(cfg.mailbox).toBe("events@example.com");
    expect(cfg.fromName).toBe("Admitto");
  });

  it("graph rejects invalid mailbox email", () => {
    const bad = safeParseMailerConfig({
      provider: "graph",
      mailbox: "not-an-email",
      tenantId: "t",
      clientId: "c",
      clientSecret: "s",
    });
    expect(bad.success).toBe(false);
  });

  it("validates export_only with sender fields", () => {
    const cfg = parseMailerConfig({
      provider: "export_only",
      fromAddress: "export@example.com",
    });
    expect(cfg.provider).toBe("export_only");
  });

  it("rejects fromName with control characters", () => {
    const bad = safeParseMailerConfig({
      provider: "smtp",
      host: "h",
      user: "u",
      password: "p",
      fromAddress: "a@example.com",
      fromName: "Bad\nName",
    });
    expect(bad.success).toBe(false);
  });

  it("rejects powerautomate URL without HTTPS", () => {
    const bad = safeParseMailerConfig({
      provider: "powerautomate",
      url: "http://example.com/flow",
      fromAddress: "a@example.com",
    });
    expect(bad.success).toBe(false);
  });

  it("rejects unknown provider (discriminated union)", () => {
    const bad = safeParseMailerConfig({ provider: "carrier-pigeon" });
    expect(bad.success).toBe(false);
  });

  it.each(["127.0.0.1", "localhost", "10.0.0.1", "169.254.169.254", "192.168.1.1"])(
    "rejects powerautomate URL targeting private/loopback/metadata host %s (SSRF)",
    (host) => {
      const bad = safeParseMailerConfig({
        provider: "powerautomate",
        url: `https://${host}/flow`,
        fromAddress: "a@example.com",
      });
      expect(bad.success).toBe(false);
    },
  );

  it.each(["127.0.0.1", "localhost", "10.0.0.1", "169.254.169.254", "192.168.1.1"])(
    "rejects smtp host targeting private/loopback/metadata address %s (SSRF)",
    (host) => {
      const bad = safeParseMailerConfig({
        provider: "smtp",
        host,
        user: "u",
        password: "p",
        fromAddress: "a@example.com",
      });
      expect(bad.success).toBe(false);
    },
  );

  it("still accepts a public powerautomate URL and smtp host", () => {
    const okUrl = safeParseMailerConfig({
      provider: "powerautomate",
      url: "https://prod-1.westeurope.logic.azure.com/workflows/x",
      fromAddress: "a@example.com",
    });
    expect(okUrl.success).toBe(true);

    const okHost = safeParseMailerConfig({
      provider: "smtp",
      host: "smtp.example.com",
      user: "u",
      password: "p",
      fromAddress: "a@example.com",
    });
    expect(okHost.success).toBe(true);
  });
});
