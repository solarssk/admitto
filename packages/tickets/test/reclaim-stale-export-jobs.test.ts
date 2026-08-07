import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import {
  DEFAULT_EXPORT_JOB_STALE_RUNNING_MS,
  parseExportJobStaleRunningMs,
  reclaimStaleExportJobs,
  STALE_EXPORT_JOB_ERROR,
  STALE_EXPORT_PENDING_ERROR,
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
  it("fails stale running export jobs and scrubs search text from result_json", async () => {
    const now = new Date("2026-08-07T12:00:00.000Z");
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "job-1",
        status: "running",
        result_json: {
          request: {
            kind: "attendees_filtered",
            format: "csv",
            filters: { q: "vip@example.com", status: "all" },
          },
        },
      },
      { id: "job-2", status: "running", result_json: null },
    ]);
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const db = { adminJob: { findMany, updateMany } } as unknown as PrismaClient;

    await expect(reclaimStaleExportJobs(db, { olderThanMs: 60_000, now })).resolves.toEqual({
      reclaimed: 1,
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        type: "export",
        OR: [
          { status: "running", started_at: { lt: new Date(now.getTime() - 60_000) } },
          { status: "pending", created_at: { lt: new Date(now.getTime() - 60_000) } },
        ],
      },
      select: { id: true, status: true, result_json: true },
      orderBy: { created_at: "asc" },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "running" },
      data: {
        status: "failed",
        error: STALE_EXPORT_JOB_ERROR,
        finished_at: now,
        result_json: {
          request: {
            kind: "attendees_filtered",
            format: "csv",
            filters: {
              status: "all",
              ticket_type: null,
              rsvp_status: undefined,
              mail_status: undefined,
              has_query: true,
            },
          },
        },
      },
    });
  });

  it("fails stale pending jobs and scrubs search text so q is not retained forever", async () => {
    const now = new Date("2026-08-07T12:00:00.000Z");
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "job-pending",
        status: "pending",
        result_json: {
          request: {
            kind: "attendees_filtered",
            format: "csv",
            filters: { q: "secret@example.com", status: "all" },
          },
        },
      },
    ]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { adminJob: { findMany, updateMany } } as unknown as PrismaClient;

    await expect(reclaimStaleExportJobs(db, { olderThanMs: 1, now })).resolves.toEqual({
      reclaimed: 1,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "job-pending", status: "pending" },
      data: expect.objectContaining({
        status: "failed",
        error: STALE_EXPORT_PENDING_ERROR,
        result_json: expect.objectContaining({
          request: expect.objectContaining({
            filters: expect.objectContaining({ has_query: true }),
          }),
        }),
      }),
    });
    const filters = updateMany.mock.calls[0]![0].data.result_json.request.filters;
    expect(filters).not.toHaveProperty("q");
  });

  it("uses the default stale window when olderThanMs is omitted or non-positive", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { adminJob: { findMany, updateMany: vi.fn() } } as unknown as PrismaClient;
    const before = Date.now();
    await reclaimStaleExportJobs(db);
    await reclaimStaleExportJobs(db, { olderThanMs: 0 });
    const after = Date.now();
    for (const call of findMany.mock.calls) {
      const cutoff = call[0]!.where.OR[0].started_at.lt as Date;
      expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - DEFAULT_EXPORT_JOB_STALE_RUNNING_MS);
      expect(cutoff.getTime()).toBeLessThanOrEqual(after - DEFAULT_EXPORT_JOB_STALE_RUNNING_MS);
    }
  });

  it("omits result_json when the abandoned job had nothing to scrub", async () => {
    const now = new Date("2026-08-07T12:00:00.000Z");
    const findMany = vi.fn().mockResolvedValue([{ id: "job-empty", status: "running", result_json: null }]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { adminJob: { findMany, updateMany } } as unknown as PrismaClient;

    await expect(reclaimStaleExportJobs(db, { olderThanMs: 1, now })).resolves.toEqual({
      reclaimed: 1,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "job-empty", status: "running" },
      data: {
        status: "failed",
        error: STALE_EXPORT_JOB_ERROR,
        finished_at: now,
      },
    });
  });
});
