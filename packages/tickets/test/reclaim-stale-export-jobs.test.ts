import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import {
  DEFAULT_EXPORT_JOB_STALE_RUNNING_MS,
  parseExportJobStaleRunningMs,
  reclaimStaleExportJobs,
  STALE_EXPORT_JOB_ERROR,
} from "../src/reclaim-stale-export-jobs.js";

describe("parseExportJobStaleRunningMs", () => {
  it("returns default when unset or invalid", () => {
    expect(parseExportJobStaleRunningMs({})).toBe(DEFAULT_EXPORT_JOB_STALE_RUNNING_MS);
    expect(parseExportJobStaleRunningMs({ EXPORT_JOB_STALE_RUNNING_MS: "0" })).toBe(
      DEFAULT_EXPORT_JOB_STALE_RUNNING_MS,
    );
  });

  it("parses a positive integer", () => {
    expect(parseExportJobStaleRunningMs({ EXPORT_JOB_STALE_RUNNING_MS: "120000" })).toBe(120_000);
  });
});

describe("reclaimStaleExportJobs", () => {
  it("fails stale running export jobs", async () => {
    const now = new Date("2026-08-07T12:00:00.000Z");
    const findMany = vi.fn().mockResolvedValue([{ id: "job-1" }, { id: "job-2" }]);
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const db = { adminJob: { findMany, updateMany } } as unknown as PrismaClient;

    await expect(reclaimStaleExportJobs(db, { olderThanMs: 60_000, now })).resolves.toEqual({
      reclaimed: 1,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "running" },
      data: {
        status: "failed",
        error: STALE_EXPORT_JOB_ERROR,
        finished_at: now,
      },
    });
  });
});
