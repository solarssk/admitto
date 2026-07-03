import { describe, expect, it } from "vitest";
import { setupChecksAllOk, type SetupChecksPayload } from "../../src/admin/setup-checks-routes.js";

const okChecks: SetupChecksPayload["checks"] = {
  database: { ok: true, detail: "PostgreSQL connected · migrations current" },
  redis: { ok: true, detail: "Redis OK (1 ms)" },
  encryption: { ok: true, detail: "ENCRYPTION_KEY configured (32 bytes)" },
  base_url: { ok: true, detail: "https://tickets.example.com" },
};

describe("setupChecksAllOk", () => {
  it("returns true when every check passed", () => {
    expect(setupChecksAllOk(okChecks)).toBe(true);
  });

  it("returns true when base_url is ok with warn flag", () => {
    expect(
      setupChecksAllOk({
        ...okChecks,
        base_url: {
          ok: true,
          warn: true,
          detail: "Instance URL optional in development",
        },
      }),
    ).toBe(true);
  });

  it("returns false when any check failed", () => {
    expect(
      setupChecksAllOk({
        ...okChecks,
        database: { ok: false, detail: "PostgreSQL connected · migrations pending" },
      }),
    ).toBe(false);
  });
});
