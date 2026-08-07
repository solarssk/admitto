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
    });
    const ac = new AbortController();
    await expect(waitForImportJobResult("evt-1", "job-1", ac.signal, { sleep: async () => {} })).resolves.toEqual(
      result,
    );
  });

  it("polls pending then succeeded with the default sleep", async () => {
    vi.useFakeTimers();
    fetchImportJobStatus
      .mockResolvedValueOnce({
        jobId: "job-1",
        status: "pending",
        importId: "imp-1",
        error: null,
        result: null,
      })
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
      });
    const ac = new AbortController();
    const done = waitForImportJobResult("evt-1", "job-1", ac.signal, {
      maxAttempts: 5,
      intervalMs: 1000,
    });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(done).resolves.toMatchObject({ created: 1 });
    expect(fetchImportJobStatus).toHaveBeenCalledTimes(2);
  });

  it("throws ApiError when the job fails, using the server message", async () => {
    fetchImportJobStatus.mockResolvedValueOnce({
      jobId: "job-1",
      status: "failed",
      importId: "imp-1",
      error: "disk full",
      result: null,
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
      jobId: "job-1",
      status: "failed",
      importId: "imp-1",
      error: null,
      result: null,
    });
    const ac = new AbortController();
    await expect(
      waitForImportJobResult("evt-1", "job-1", ac.signal, { sleep: async () => {} }),
    ).rejects.toMatchObject({ status: 422, message: "Import failed." });
  });

  it("throws 408 when the poll budget is exhausted while still pending", async () => {
    fetchImportJobStatus.mockResolvedValue({
      jobId: "job-1",
      status: "pending",
      importId: "imp-1",
      error: null,
      result: null,
    });
    const ac = new AbortController();
    await expect(
      waitForImportJobResult("evt-1", "job-1", ac.signal, {
        maxAttempts: 2,
        sleep: async () => {},
      }),
    ).rejects.toMatchObject({ status: 408, message: expect.stringMatching(/still running/i) });
    expect(fetchImportJobStatus).toHaveBeenCalledTimes(2);
  });

  it("propagates AbortError when aborted during sleep", async () => {
    vi.useFakeTimers();
    fetchImportJobStatus.mockResolvedValue({
      jobId: "job-1",
      status: "pending",
      importId: "imp-1",
      error: null,
      result: null,
    });
    const ac = new AbortController();
    const done = waitForImportJobResult("evt-1", "job-1", ac.signal, {
      maxAttempts: 5,
      intervalMs: 5000,
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
