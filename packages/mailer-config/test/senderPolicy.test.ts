import { describe, expect, it } from "vitest";
import {
  effectiveFromAddressForPolicy,
  emailDomain,
  enforceAllowedFromDomain,
  normalizeAllowedFromDomain,
} from "../src/senderPolicy.js";

describe("senderPolicy", () => {
  it("normalizes allowed domain", () => {
    expect(normalizeAllowedFromDomain("@Example.COM")).toBe("example.com");
  });

  it("allows matching smtp from domain", () => {
    expect(() =>
      enforceAllowedFromDomain("example.com", {
        provider: "smtp",
        host: "smtp.example.com",
        port: 587,
        secure: false,
        user: "u",
        password: "p",
        fromAddress: "from@example.com",
        requireTLS: true,
        tlsRejectUnauthorized: true,
        pool: true,
        maxConnections: 3,
        maxMessages: 100,
        rateLimitPerMinute: 30,
        connectionTimeout: 30_000,
        greetingTimeout: 30_000,
        socketTimeout: 60_000,
      }),
    ).not.toThrow();
  });

  it("rejects mismatched from domain", () => {
    expect(() =>
      enforceAllowedFromDomain("example.com", {
        provider: "smtp",
        host: "smtp.example.com",
        port: 587,
        secure: false,
        user: "u",
        password: "p",
        fromAddress: "from@other.com",
        requireTLS: true,
        tlsRejectUnauthorized: true,
        pool: true,
        maxConnections: 3,
        maxMessages: 100,
        rateLimitPerMinute: 30,
        connectionTimeout: 30_000,
        greetingTimeout: 30_000,
        socketTimeout: 60_000,
      }),
    ).toThrow(/allowed from domain/i);
  });

  it("uses graph mailbox when from address is absent", () => {
    expect(
      effectiveFromAddressForPolicy({
        provider: "graph",
        mailbox: "shared@example.com",
        tenantId: "t",
        clientId: "c",
        clientSecret: "s",
        saveToSentItems: true,
      }),
    ).toBe("shared@example.com");
  });

  it("extracts email domain", () => {
    expect(emailDomain("User@Example.COM")).toBe("example.com");
  });
});
