import { describe, expect, it, vi, afterEach } from "vitest";
import {
  emitAuditEvent,
  fingerprint,
  logLoginSuccess,
  logMfaSuccess,
  logRateLimitExceeded,
  redactEmail,
} from "../src/audit.js";

describe("audit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redacts email local part", () => {
    expect(redactEmail("alice@example.com")).toBe("a***@example.com");
  });

  it("fingerprints values consistently", () => {
    expect(fingerprint("user-123")).toHaveLength(12);
    expect(fingerprint("user-123")).toBe(fingerprint("user-123"));
  });

  it("emitAuditEvent includes ts and event fields", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    emitAuditEvent("test.event", { foo: "bar" });
    expect(spy).toHaveBeenCalledOnce();
    const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(payload.event).toBe("test.event");
    expect(payload.foo).toBe("bar");
    expect(payload.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("logLoginSuccess redacts email and includes ts", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logLoginSuccess({ email: "bob@example.com", ip: "1.2.3.4" });
    const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(payload.event).toBe("auth.login.success");
    expect(payload.email).toBe("b***@example.com");
    expect(payload.ip).toBe("1.2.3.4");
    expect(payload.ts).toBeDefined();
  });

  it("logMfaSuccess fingerprints user id without raw uuid", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const userId = "550e8400-e29b-41d4-a716-446655440000";
    logMfaSuccess({ userId, sessionId: "sess-1" }, "totp");
    const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(payload.event).toBe("auth.mfa.success");
    expect(payload.user_fingerprint).toBe(fingerprint(userId));
    expect(JSON.stringify(payload)).not.toContain(userId);
  });

  it("logRateLimitExceeded records scope and ip", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logRateLimitExceeded({ scope: "login_ip", ip: "10.0.0.1" });
    const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(payload.event).toBe("auth.rate_limit.exceeded");
    expect(payload.scope).toBe("login_ip");
    expect(payload.ip).toBe("10.0.0.1");
  });
});
