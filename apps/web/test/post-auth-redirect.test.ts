import { describe, expect, it } from "vitest";
import {
  isNextAllowedForAssignments,
  resolvePostLoginRedirect,
} from "../src/auth/safe-redirect.js";

const ORG_ADMIN = [{ role: "admin", scope_type: "organization", scope_id: "org-1" }];
const OPERATOR = [{ role: "operator", scope_type: "event", scope_id: "ev-1" }];

describe("resolvePostLoginRedirect", () => {
  it("uses role-based fallback when next is absent", () => {
    expect(resolvePostLoginRedirect(undefined, ORG_ADMIN)).toBe("/admin");
  });

  it("honors role-compatible next for operator", () => {
    expect(resolvePostLoginRedirect("/operator", OPERATOR)).toBe("/operator");
  });

  it("allows check-in next for org admin with event scope", () => {
    expect(resolvePostLoginRedirect("/operator/events/ev-1/checkin", ORG_ADMIN)).toBe(
      "/operator/events/ev-1/checkin",
    );
  });

  it("rejects admin next for operator-only assignments", () => {
    expect(resolvePostLoginRedirect("/admin", OPERATOR)).toBe("/operator");
  });

  it("honors role-compatible next for org admin", () => {
    expect(resolvePostLoginRedirect("/admin/events/ev-1/overview", ORG_ADMIN)).toBe(
      "/admin/events/ev-1/overview",
    );
  });
});

describe("isNextAllowedForAssignments", () => {
  it("allows operator paths for operator assignments", () => {
    expect(isNextAllowedForAssignments("/operator/events/ev-1/checkin", OPERATOR)).toBe(true);
  });

  it("denies admin paths for operator-only assignments", () => {
    expect(isNextAllowedForAssignments("/admin", OPERATOR)).toBe(false);
  });
});
