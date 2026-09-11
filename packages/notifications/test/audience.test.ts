import type { PrismaClient } from "@admitto/db";
import { describe, expect, it } from "vitest";
import { NotImplementedError, resolveAudienceCandidates } from "../src/audience.js";
import { createStubDb } from "./stubDb.js";

const ORG_ID = "org-1";

describe("resolveAudienceCandidates", () => {
  it('throws NotImplementedError for "event-staff" (reserved for a future prompt)', async () => {
    const db = createStubDb();
    await expect(
      resolveAudienceCandidates(db as unknown as PrismaClient, "event-staff", {
        organizationId: ORG_ID,
      }),
    ).rejects.toThrow(NotImplementedError);
  });

  it("throws on an unrecognized strategy (defensive - unreachable through the real type system)", async () => {
    const db = createStubDb();
    await expect(
      resolveAudienceCandidates(
        db as unknown as PrismaClient,
        // @ts-expect-error - deliberately invalid, exercising the exhaustive-switch guard
        "not-a-real-strategy",
        { organizationId: ORG_ID },
      ),
    ).rejects.toThrow("Unknown notification audience strategy");
  });

  describe('"org-staff"', () => {
    it("returns active superadmins and active org-admins, deduplicated", async () => {
      const db = createStubDb();
      db.roleAssignment.findMany.mockResolvedValue([
        { user_id: "u-super", user: { is_active: true } },
        { user_id: "u-admin", user: { is_active: true } },
        { user_id: "u-super", user: { is_active: true } }, // duplicate assignment row
      ]);

      const candidates = await resolveAudienceCandidates(db as unknown as PrismaClient, "org-staff", {
        organizationId: ORG_ID,
      });

      expect(candidates.toSorted((a, b) => a.localeCompare(b))).toEqual(["u-admin", "u-super"]);
      expect(db.roleAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { role: "superadmin", scope_type: "instance" },
              { role: "admin", scope_type: "organization", scope_id: ORG_ID },
            ],
          },
        }),
      );
    });

    it("excludes inactive users", async () => {
      const db = createStubDb();
      db.roleAssignment.findMany.mockResolvedValue([
        { user_id: "u-active", user: { is_active: true } },
        { user_id: "u-inactive", user: { is_active: false } },
      ]);

      const candidates = await resolveAudienceCandidates(db as unknown as PrismaClient, "org-staff", {
        organizationId: ORG_ID,
      });

      expect(candidates).toEqual(["u-active"]);
    });
  });

  describe('"self"', () => {
    it("returns [] when targetUserId is missing", async () => {
      const db = createStubDb();
      const candidates = await resolveAudienceCandidates(db as unknown as PrismaClient, "self", {
        organizationId: ORG_ID,
      });
      expect(candidates).toEqual([]);
      expect(db.user.findUnique).not.toHaveBeenCalled();
    });

    it("returns [] when the target user does not exist", async () => {
      const db = createStubDb();
      db.user.findUnique.mockResolvedValue(null);

      const candidates = await resolveAudienceCandidates(db as unknown as PrismaClient, "self", {
        organizationId: ORG_ID,
        targetUserId: "ghost",
      });

      expect(candidates).toEqual([]);
    });

    // Deliberately does NOT exclude a disabled account - see resolveSelf's own doc comment (bot
    // review finding, PR #1308): the admin UI exposes MFA/password reset and SSO unlink for a
    // disabled account, so excluding is_active: false here would silently and permanently drop
    // this mandatory notification for exactly that real, reachable case.
    it("returns [targetUserId] for a disabled (is_active: false) user - the account still exists", async () => {
      const db = createStubDb();
      db.user.findUnique.mockResolvedValue({ id: "u-1", is_active: false });

      const candidates = await resolveAudienceCandidates(db as unknown as PrismaClient, "self", {
        organizationId: ORG_ID,
        targetUserId: "u-1",
      });

      expect(candidates).toEqual(["u-1"]);
    });

    // No role-assignment or organization-membership check (a prior version of resolveSelf had
    // one, first instance-/organization-scoped only, then also event-scoped) - every real call
    // site already independently proves targetUserId's identity before reaching notify(), so
    // that check only ever rejected legitimate recipients: an active user whose org membership
    // doesn't match event.organizationId (which for a self-audience type is just the instance's
    // resolved default org, not necessarily the recipient's own), and an active user with zero
    // role assignments at all (reachable today - see resolveSelf's own doc comment). Found by
    // Codex bot review on PR #1304.
    it("returns [targetUserId] for an active user regardless of organization membership or role assignments", async () => {
      const db = createStubDb();
      db.user.findUnique.mockResolvedValue({ id: "u-1", is_active: true });

      const candidates = await resolveAudienceCandidates(db as unknown as PrismaClient, "self", {
        organizationId: ORG_ID,
        targetUserId: "u-1",
      });

      expect(candidates).toEqual(["u-1"]);
      expect(db.roleAssignment.findMany).not.toHaveBeenCalled();
      expect(db.roleAssignment.count).not.toHaveBeenCalled();
    });
  });
});
