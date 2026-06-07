import { describe, expect, it } from "vitest";
import { parseMailerConfig, safeParseMailerConfig } from "../src/config.js";

describe("config", () => {
  it("validates powerautomate config and requires a URL", () => {
    const ok = parseMailerConfig({ provider: "powerautomate", url: "https://example.com/flow" });
    expect(ok.provider).toBe("powerautomate");

    const bad = safeParseMailerConfig({ provider: "powerautomate", url: "not-a-url" });
    expect(bad.success).toBe(false);
  });

  it("validates smtp and sets default port/secure", () => {
    const cfg = parseMailerConfig({
      provider: "smtp",
      host: "smtp.example.com",
      user: "u",
      password: "p",
      from: "from@example.com",
    });
    if (cfg.provider !== "smtp") throw new Error("unexpected provider");
    expect(cfg.port).toBe(587);
    expect(cfg.secure).toBe(false);
  });

  it("graph requires sender in email format", () => {
    const bad = safeParseMailerConfig({
      provider: "graph",
      tenantId: "t",
      clientId: "c",
      clientSecret: "s",
      sender: "not-an-email",
    });
    expect(bad.success).toBe(false);
  });

  it("rejects unknown provider (discriminated union)", () => {
    const bad = safeParseMailerConfig({ provider: "carrier-pigeon" });
    expect(bad.success).toBe(false);
  });
});
