import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { countFilteredAttendees } from "../src/attendees-list-filters.js";

describe("latest mail-status attendee filters", () => {
  it.each(["not_sent", "sent", "pending", "failed"] as const)(
    "builds the query for the %s bucket",
    async (mail_status) => {
      const $queryRaw = vi.fn().mockResolvedValue([{ count: 0n }]);
      const db = { $queryRaw } as unknown as PrismaClient;

      await expect(
        countFilteredAttendees(db, "event-1", { status: "all", mail_status }),
      ).resolves.toBe(0);
      expect($queryRaw).toHaveBeenCalledOnce();
    },
  );
});
