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

    it("returns [] when the target user is inactive", async () => {
      const db = createStubDb();
      db.user.findUnique.mockResolvedValue({ is_active: false });

      const candidates = await resolveAudienceCandidates(db as unknown as PrismaClient, "self", {
        organizationId: ORG_ID,
        targetUserId: "u-1",
      });

      expect(candidates).toEqual([]);
      expect(db.roleAssignment.findMany).not.toHaveBeenCalled();
    });

    it("returns [] when the active user has no role assignments at all", async () => {
      const db = createStubDb();
      db.user.findUnique.mockResolvedValue({ is_active: true });
      db.roleAssignment.findMany.mockResolvedValue([]);

      const candidates = await resolveAudienceCandidates(db as unknown as PrismaClient, "self", {
        organizationId: ORG_ID,
        targetUserId: "u-1",
      });

      expect(candidates).toEqual([]);
      expect(db.event.count).not.toHaveBeenCalled();
    });

    it("returns [] for an organization-scoped assignment in a DIFFERENT organization", async () => {
      const db = createStubDb();
      db.user.findUnique.mockResolvedValue({ is_active: true });
      db.roleAssignment.findMany.mockResolvedValue([{ scope_type: "organization", scope_id: "org-other" }]);

      const candidates = await resolveAudienceCandidates(db as unknown as PrismaClient, "self", {
        organizationId: ORG_ID,
        targetUserId: "u-1",
      });

      expect(candidates).toEqual([]);
    });

    it("returns [targetUserId] for an instance-scoped (superadmin) assignment", async () => {
      const db = createStubDb();
      db.user.findUnique.mockResolvedValue({ is_active: true });
      db.roleAssignment.findMany.mockResolvedValue([{ scope_type: "instance", scope_id: null }]);

      const candidates = await resolveAudienceCandidates(db as unknown as PrismaClient, "self", {
        organizationId: ORG_ID,
        targetUserId: "u-1",
      });

      expect(candidates).toEqual(["u-1"]);
      expect(db.event.count).not.toHaveBeenCalled();
    });

    it("returns [targetUserId] for an organization-scoped (admin) assignment in this organization", async () => {
      const db = createStubDb();
      db.user.findUnique.mockResolvedValue({ is_active: true });
      db.roleAssignment.findMany.mockResolvedValue([{ scope_type: "organization", scope_id: ORG_ID }]);

      const candidates = await resolveAudienceCandidates(db as unknown as PrismaClient, "self", {
        organizationId: ORG_ID,
        targetUserId: "u-1",
      });

      expect(candidates).toEqual(["u-1"]);
    });

    it("returns [targetUserId] for an event-scoped (operator) assignment whose event belongs to this organization", async () => {
      const db = createStubDb();
      db.user.findUnique.mockResolvedValue({ is_active: true });
      db.roleAssignment.findMany.mockResolvedValue([{ scope_type: "event", scope_id: "evt-1" }]);
      db.event.count.mockResolvedValue(1);

      const candidates = await resolveAudienceCandidates(db as unknown as PrismaClient, "self", {
        organizationId: ORG_ID,
        targetUserId: "u-1",
      });

      expect(candidates).toEqual(["u-1"]);
      expect(db.event.count).toHaveBeenCalledWith({
        where: { id: { in: ["evt-1"] }, organization_id: ORG_ID },
      });
    });

    it("returns [] for an event-scoped assignment whose event belongs to a DIFFERENT organization", async () => {
      const db = createStubDb();
      db.user.findUnique.mockResolvedValue({ is_active: true });
      db.roleAssignment.findMany.mockResolvedValue([{ scope_type: "event", scope_id: "evt-other-org" }]);
      db.event.count.mockResolvedValue(0);

      const candidates = await resolveAudienceCandidates(db as unknown as PrismaClient, "self", {
        organizationId: ORG_ID,
        targetUserId: "u-1",
      });

      expect(candidates).toEqual([]);
    });
  });
});
