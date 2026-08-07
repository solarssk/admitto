// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isAbortError,
  sleepWithAbort,
  waitForImportJobResult,
} from "../../src/import/waitForImportJobResult.js";

const fetchImportJobStatus = vi.fn();

vi.mock("../../src/api/client.js", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  fetchImportJobStatus: (...args: unknown[]) => fetchImportJobStatus(...args),
}));

function pendingStatus(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "job-1",
    status: "pending",
    importId: "imp-1",
    error: null,
    result: null,
    created_at: "2026-08-07T12:00:00.000Z",
    started_at: null,
    ...overrides,
  };
}

describe("sleepWithAbort", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves after the delay", async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const done = sleepWithAbort(1000, ac.signal);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(done).resolves.toBeUndefined();
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(sleepWithAbort(1000, ac.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("rejects when aborted during the wait", async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const done = sleepWithAbort(5000, ac.signal);
    await Promise.resolve();
    ac.abort();
    await expect(done).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("waitForImportJobResult", () => {
  beforeEach(() => {
    fetchImportJobStatus.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the succeeded result on the first poll", async () => {
    const result = {
      importId: "imp-1",
      toCreate: 1,
      toUpdate: 0,
      toSkip: 0,
      created: 1,
      updated: 0,
      skipped: [],
      invalidRows: [],
      invalidCount: 0,
    };
    fetchImportJobStatus.mockResolvedValueOnce({
      jobId: "job-1",
      status: "succeeded",
      importId: "imp-1",
      error: null,
      result,
      created_at: "2026-08-07T12:00:00.000Z",
      started_at: "2026-08-07T12:00:01.000Z",
    });
    const ac = new AbortController();
    await expect(waitForImportJobResult("evt-1", "job-1", ac.signal, { sleep: async () => {} })).resolves.toEqual(
      result,
    );
  });

  it("polls pending then succeeded with the default sleep", async () => {
    vi.useFakeTimers();
    fetchImportJobStatus
      .mockResolvedValueOnce(pendingStatus())
      .mockResolvedValueOnce({
        jobId: "job-1",
        status: "succeeded",
        importId: "imp-1",
        error: null,
        result: {
          importId: "imp-1",
          toCreate: 1,
          toUpdate: 0,
          toSkip: 0,
          created: 1,
          updated: 0,
          skipped: [],
          invalidRows: [],
          invalidCount: 0,
        },
        created_at: "2026-08-07T12:00:00.000Z",
        started_at: "2026-08-07T12:00:05.000Z",
      });
    const ac = new AbortController();
    const done = waitForImportJobResult("evt-1", "job-1", ac.signal, {
      maxAttempts: 5,
      intervalMs: 1000,
      now: () => Date.parse("2026-08-07T12:00:10.000Z"),
    });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(done).resolves.toMatchObject({ created: 1 });
    expect(fetchImportJobStatus).toHaveBeenCalledTimes(2);
  });

  it("throws ApiError when the job fails, using the server message", async () => {
    fetchImportJobStatus.mockResolvedValueOnce({
      ...pendingStatus({ status: "failed", error: "disk full" }),
    });
    const ac = new AbortController();
    await expect(
      waitForImportJobResult("evt-1", "job-1", ac.signal, { sleep: async () => {} }),
    ).rejects.toMatchObject({ status: 422, message: "disk full" });
  });

  it("treats succeeded with a null result as a terminal error", async () => {
    fetchImportJobStatus.mockResolvedValue({
      jobId: "job-1",
      status: "succeeded",
      importId: "imp-1",
      error: null,
      result: null,
      created_at: "2026-08-07T12:00:00.000Z",
      started_at: "2026-08-07T12:00:01.000Z",
    });
    const ac = new AbortController();
    await expect(
      waitForImportJobResult("evt-1", "job-1", ac.signal, {
        maxAttempts: 3,
        sleep: async () => {},
      }),
    ).rejects.toMatchObject({ status: 500, message: "Import finished without a result." });
    expect(fetchImportJobStatus).toHaveBeenCalledTimes(1);
  });

  it("falls back to Import failed. when the failed job has no error text", async () => {
    fetchImportJobStatus.mockResolvedValueOnce({
      ...pendingStatus({ status: "failed", error: null }),
    });
    const ac = new AbortController();
    await expect(
      waitForImportJobResult("evt-1", "job-1", ac.signal, { sleep: async () => {} }),
    ).rejects.toMatchObject({ status: 422, message: "Import failed." });
  });

  it("keeps polling aged pending jobs (stale window applies only after claim)", async () => {
    fetchImportJobStatus
      .mockResolvedValueOnce(pendingStatus())
      .mockResolvedValueOnce({
        jobId: "job-1",
        status: "succeeded",
        importId: "imp-1",
        error: null,
        result: {
          importId: "imp-1",
          toCreate: 1,
          toUpdate: 0,
          toSkip: 0,
          created: 1,
          updated: 0,
          skipped: [],
          invalidRows: [],
          invalidCount: 0,
        },
        created_at: "2026-08-07T12:00:00.000Z",
        started_at: "2026-08-07T12:20:00.000Z",
      });
    const ac = new AbortController();
    // Far past created_at; without started_at the client must not 408 on pending alone.
    await expect(
      waitForImportJobResult("evt-1", "job-1", ac.signal, {
        maxAttempts: 5,
        sleep: async () => {},
        now: () => Date.parse("2026-08-07T12:30:00.000Z"),
      }),
    ).resolves.toMatchObject({ created: 1 });
    expect(fetchImportJobStatus).toHaveBeenCalledTimes(2);
  });

  it("throws 408 when started_at is past the stale window while still running", async () => {
    fetchImportJobStatus.mockResolvedValue(
      pendingStatus({
        status: "running",
        started_at: "2026-08-07T12:00:00.000Z",
      }),
    );
    const ac = new AbortController();
    await expect(
      waitForImportJobResult("evt-1", "job-1", ac.signal, {
        maxAttempts: 5,
        sleep: async () => {},
        now: () => Date.parse("2026-08-07T12:15:00.000Z"),
      }),
    ).rejects.toMatchObject({ status: 408, message: expect.stringMatching(/still running/i) });
    expect(fetchImportJobStatus).toHaveBeenCalledTimes(1);
  });

  it("anchors the stale window on started_at after the worker claims the job", async () => {
    vi.useFakeTimers();
    fetchImportJobStatus
      .mockResolvedValueOnce(
        pendingStatus({
          status: "running",
          created_at: "2026-08-07T11:00:00.000Z",
          started_at: "2026-08-07T12:10:00.000Z",
        }),
      )
      .mockResolvedValueOnce({
        jobId: "job-1",
        status: "succeeded",
        importId: "imp-1",
        error: null,
        result: {
          importId: "imp-1",
          toCreate: 1,
          toUpdate: 0,
          toSkip: 0,
          created: 1,
          updated: 0,
          skipped: [],
          invalidRows: [],
          invalidCount: 0,
        },
        created_at: "2026-08-07T11:00:00.000Z",
        started_at: "2026-08-07T12:10:00.000Z",
      });
    const ac = new AbortController();
    // 14 minutes after created_at, but only 4 minutes after started_at → keep polling.
    const done = waitForImportJobResult("evt-1", "job-1", ac.signal, {
      maxAttempts: 5,
      intervalMs: 1000,
      now: () => Date.parse("2026-08-07T12:14:00.000Z"),
    });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(done).resolves.toMatchObject({ created: 1 });
    expect(fetchImportJobStatus).toHaveBeenCalledTimes(2);
  });

  it("propagates AbortError when aborted during sleep", async () => {
    vi.useFakeTimers();
    fetchImportJobStatus.mockResolvedValue(pendingStatus());
    const ac = new AbortController();
    const done = waitForImportJobResult("evt-1", "job-1", ac.signal, {
      maxAttempts: 5,
      intervalMs: 5000,
      now: () => Date.parse("2026-08-07T12:00:10.000Z"),
    });
    await Promise.resolve();
    ac.abort();
    await expect(done).rejects.toMatchObject({ name: "AbortError" });
  });

  it("throws AbortError before polling when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(waitForImportJobResult("evt-1", "job-1", ac.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetchImportJobStatus).not.toHaveBeenCalled();
  });
});

describe("isAbortError", () => {
  it("detects DOMException AbortError only", () => {
    expect(isAbortError(new DOMException("Aborted", "AbortError"))).toBe(true);
    expect(isAbortError(new Error("Aborted"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});
