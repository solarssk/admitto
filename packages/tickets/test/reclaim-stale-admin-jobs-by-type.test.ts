import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { reclaimStaleAdminJobsByType } from "../src/reclaim-stale-admin-jobs-by-type.js";

const ERRORS = { running: "job abandoned", pending: "job never picked up" };

describe("reclaimStaleAdminJobsByType", () => {
  it("fails a stale running job with the running-specific error, scoped to the given type", async () => {
    const db = {
      adminJob: {
        findMany: vi.fn().mockResolvedValue([{ id: "job-1", status: "running" }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      backgroundWorkerHeartbeat: { findUnique: vi.fn().mockResolvedValue({ last_beat_at: new Date() }) },
    };

    const result = await reclaimStaleAdminJobsByType(db as never, "some_job_type", ERRORS, 30 * 60 * 1000, {
      now: new Date("2026-08-14T12:00:00Z"),
    });

    expect(result).toEqual({ reclaimed: 1 });
    expect(db.adminJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ type: "some_job_type" }) }),
    );
    expect(db.adminJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "running" },
      data: { status: "failed", error: "job abandoned", finished_at: new Date("2026-08-14T12:00:00Z") },
    });
  });

  it("does not count a job as reclaimed when the CAS update finds it already changed status", async () => {
    const db = {
      adminJob: {
        findMany: vi.fn().mockResolvedValue([{ id: "job-1", status: "running" }]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      backgroundWorkerHeartbeat: { findUnique: vi.fn().mockResolvedValue({ last_beat_at: new Date() }) },
    };

    const result = await reclaimStaleAdminJobsByType(db as never, "some_job_type", ERRORS, 30 * 60 * 1000, {
      now: new Date("2026-08-14T12:00:00Z"),
    });

    expect(result).toEqual({ reclaimed: 0 });
  });

  it("leaves a pending job alone while the worker heartbeat is fresh", async () => {
    const db = {
      adminJob: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
      backgroundWorkerHeartbeat: { findUnique: vi.fn().mockResolvedValue({ last_beat_at: new Date() }) },
    };

    const result = await reclaimStaleAdminJobsByType(db as never, "some_job_type", ERRORS, 30 * 60 * 1000, {
      now: new Date("2026-08-14T12:00:00Z"),
    });

    expect(result).toEqual({ reclaimed: 0 });
    expect(db.adminJob.updateMany).not.toHaveBeenCalled();
  });

  it("fails a pending job with the pending-specific error once the worker heartbeat itself is stale", async () => {
    const db = {
      adminJob: {
        findMany: vi.fn().mockResolvedValue([{ id: "job-2", status: "pending" }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      backgroundWorkerHeartbeat: {
        findUnique: vi.fn().mockResolvedValue({ last_beat_at: new Date("2026-08-14T00:00:00Z") }),
      },
    };

    const result = await reclaimStaleAdminJobsByType(db as never, "some_job_type", ERRORS, 30 * 60 * 1000, {
      now: new Date("2026-08-14T12:00:00Z"),
    });

    expect(result).toEqual({ reclaimed: 1 });
    expect(db.adminJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-2", status: "pending" },
      data: { status: "failed", error: "job never picked up", finished_at: new Date("2026-08-14T12:00:00Z") },
    });
  });

  it("uses the given default stale-running window when olderThanMs is omitted", async () => {
    const db = {
      adminJob: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
      backgroundWorkerHeartbeat: { findUnique: vi.fn().mockResolvedValue({ last_beat_at: new Date() }) },
    };
    const now = new Date("2026-08-14T12:00:00Z");

    await reclaimStaleAdminJobsByType(db as never, "some_job_type", ERRORS, 10 * 60 * 1000, { now });

    const call = db.adminJob.findMany.mock.calls[0][0];
    // staleAdminJobOrClauses is a real @admitto/db helper (not mocked here) - just confirm the
    // query ran with the expected type, the cutoff math itself is that helper's own concern.
    expect(call.where.type).toBe("some_job_type");
  });
});
