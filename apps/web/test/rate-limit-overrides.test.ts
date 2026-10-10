import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyRateLimitOverrides } from "../src/rate-limit/overrides.js";

function tables() {
  return {
    policies: {
      "auth:login-ip": { checks: [{ windowMs: 60_000, max: 30 }] },
      "admin:resend": {
        checks: [
          { windowMs: 60_000, max: 5 },
          { windowMs: 3_600_000, max: 30 },
        ],
      },
      "checkin:stream": { checks: [{ windowMs: 60_000, max: 120 }] },
    },
    inline: { "mfa:verify-totp": { windowMs: 900_000, max: 10 } },
  };
}

function apply(raw: string | undefined) {
  const t = tables();
  applyRateLimitOverrides(t.policies, t.inline, { RATE_LIMIT_OVERRIDES: raw });
  return t;
}

describe("applyRateLimitOverrides", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("changes nothing when the variable is unset or blank", () => {
    for (const raw of [undefined, "", "  "]) {
      expect(apply(raw)).toEqual(tables());
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("overrides max and windowMs of a single-check policy", () => {
    const t = apply('{"auth:login-ip":{"max":90,"windowMs":120000}}');
    expect(t.policies["auth:login-ip"].checks[0]).toEqual({ windowMs: 120_000, max: 90 });
    expect(warn).not.toHaveBeenCalled();
  });

  it("overrides only the given field and leaves the rest as it was", () => {
    const t = apply('{"auth:login-ip":{"max":90}}');
    expect(t.policies["auth:login-ip"].checks[0]).toEqual({ windowMs: 60_000, max: 90 });
  });

  it("takes one array entry per check for a multi-check policy, null keeping a check", () => {
    const t = apply('{"admin:resend":[null,{"max":60}]}');
    expect(t.policies["admin:resend"].checks).toEqual([
      { windowMs: 60_000, max: 5 },
      { windowMs: 3_600_000, max: 60 },
    ]);
  });

  it("overrides an inline limit", () => {
    const t = apply('{"mfa:verify-totp":{"max":15}}');
    expect(t.inline["mfa:verify-totp"]).toEqual({ windowMs: 900_000, max: 15 });
  });

  it.each([
    ["not json", "not valid JSON"],
    ["[1]", "JSON object"],
    ["null", "JSON object"],
  ])("ignores everything for %s", (raw, message) => {
    expect(apply(raw)).toEqual(tables());
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(message));
  });

  it.each([0, -5, 1.5, "30", null, true])("rejects max %j and keeps the default", (bad) => {
    const t = apply(JSON.stringify({ "auth:login-ip": { max: bad } }));
    expect(t.policies["auth:login-ip"].checks[0]!.max).toBe(30);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("auth:login-ip"));
  });

  it("rejects a whole entry with an unknown field, so a typo cannot half-apply", () => {
    const t = apply('{"auth:login-ip":{"max":90,"windwMs":1}}');
    expect(t.policies["auth:login-ip"].checks[0]).toEqual({ windowMs: 60_000, max: 30 });
  });

  it("warns about an unknown policy and still applies the valid ones", () => {
    const t = apply('{"nope":{"max":1},"auth:login-ip":{"max":90}}');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown limit "nope"'));
    expect(t.policies["auth:login-ip"].checks[0]!.max).toBe(90);
  });

  it("does not resolve inherited object keys as policies", () => {
    apply('{"constructor":{"max":1},"__proto__":{"max":1}}');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("unknown limit"));
  });

  it("refuses the wrong shape for the check count", () => {
    expect(apply('{"admin:resend":{"max":9}}').policies["admin:resend"].checks[0]?.max).toBe(5);
    expect(apply('{"admin:resend":[{"max":9}]}').policies["admin:resend"].checks[0]?.max).toBe(5);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("leaves checkin:stream to its own variables", () => {
    const t = apply('{"checkin:stream":{"max":1}}');
    expect(t.policies["checkin:stream"].checks[0]?.max).toBe(120);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("CHECKIN_STREAM_*"));
  });
});
