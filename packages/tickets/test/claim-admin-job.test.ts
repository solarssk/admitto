import { describe, expect, it, vi } from "vitest";
import { claimNextAdminJob } from "../src/claim-admin-job.js";

describe("claimNextAdminJob", () => {
  it("returns null when no pending job exists", async () => {
    const db = {
      adminJob: {
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
    };

    await expect(claimNextAdminJob(db as never, "export")).resolves.toBeNull();
    expect(db.adminJob.updateMany).not.toHaveBeenCalled();
  });

  it("returns null when a concurrent claim already took the row", async () => {
    const db = {
      adminJob: {
        findFirst: vi.fn().mockResolvedValue({ id: "job-1", status: "pending" }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow: vi.fn(),
      },
    };

    await expect(claimNextAdminJob(db as never, "export")).resolves.toBeNull();
    expect(db.adminJob.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("marks pending as running and returns the claimed row", async () => {
    const claimed = { id: "job-2", status: "running", type: "export" };
    const db = {
      adminJob: {
        findFirst: vi.fn().mockResolvedValue({ id: "job-2", status: "pending" }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(claimed),
      },
    };

    await expect(claimNextAdminJob(db as never, "export")).resolves.toEqual(claimed);
    expect(db.adminJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-2", status: "pending" },
      data: { status: "running", started_at: expect.any(Date) },
    });
  });
});
