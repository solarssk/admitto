import { describe, expect, it } from "vitest";
import { resolvePostLoginRedirect } from "../src/auth/safe-redirect.js";

describe("resolvePostLoginRedirect", () => {
  it("uses role-based fallback when next is absent", () => {
    expect(
      resolvePostLoginRedirect(undefined, [
        { role: "admin", scope_type: "organization", scope_id: "org-1" },
      ]),
    ).toBe("/admin");
  });

  it("respects explicit safe next path", () => {
    expect(
      resolvePostLoginRedirect("/operator", [
        { role: "admin", scope_type: "organization", scope_id: "org-1" },
      ]),
    ).toBe("/operator");
  });
});
