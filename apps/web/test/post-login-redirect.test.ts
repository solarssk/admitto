import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";

vi.mock("../src/auth/safe-redirect.js", () => ({
  resolvePostLoginRedirect: vi.fn((_next: string | undefined, _assignments: unknown[]) => "/admin"),
}));

import { resolvePostLoginRedirect } from "../src/auth/safe-redirect.js";
import { resolvePostLoginRedirectForUser } from "../src/auth/post-login-redirect.js";

const resolveRedirect = vi.mocked(resolvePostLoginRedirect);

describe("resolvePostLoginRedirectForUser", () => {
  it("returns /change-password when the user must change password", async () => {
    const db = {
      user: {
        findUnique: vi.fn(async () => ({ must_change_password: true })),
      },
      roleAssignment: {
        findMany: vi.fn(),
      },
    } as unknown as PrismaClient;

    await expect(resolvePostLoginRedirectForUser(db, "u1", "/operator")).resolves.toBe(
      "/change-password",
    );
    expect(db.roleAssignment.findMany).not.toHaveBeenCalled();
  });

  it("delegates to resolvePostLoginRedirect with role assignments", async () => {
    resolveRedirect.mockReturnValue("/operator");
    const assignments = [{ role: "operator", scope_type: "event", scope_id: "e1" }];
    const db = {
      user: {
        findUnique: vi.fn(async () => ({ must_change_password: false })),
      },
      roleAssignment: {
        findMany: vi.fn(async () => assignments),
      },
    } as unknown as PrismaClient;

    await expect(resolvePostLoginRedirectForUser(db, "u1", "/operator")).resolves.toBe(
      "/operator",
    );
    expect(resolveRedirect).toHaveBeenCalledWith("/operator", assignments);
  });
});
