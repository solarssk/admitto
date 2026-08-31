import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollWalletRefreshStatusCompletion } from "../../src/attendees/pollWalletRefreshStatusCompletion.js";

const fetchWalletRefreshStatusJobStatus = vi.fn();

vi.mock("../../src/api/client.js", () => ({
  fetchWalletRefreshStatusJobStatus: (...args: unknown[]) => fetchWalletRefreshStatusJobStatus(...args),
}));

function baseStatus(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    jobId: "job-1",
    status: "running",
    error: null,
    progressTotal: null,
    progressDone: null,
    refreshed: null,
    skipped: null,
    errored: null,
    ...overrides,
  };
}

describe("pollWalletRefreshStatusCompletion", () => {
  beforeEach(() => {
    fetchWalletRefreshStatusJobStatus.mockReset();
  });

  // Restored here, not at the end of the fake-timers test below, so a failed assertion in that
  // test can't leave fake timers active for every test that runs after it (bot review).
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    [2, 0, "2 wallet passes refreshed."],
    [1, 0, "1 wallet pass refreshed."],
    [2, 3, "2 wallet passes refreshed (3 skipped)."],
  ])("toasts success for refreshed=%i skipped=%i", async (refreshed, skipped, expected) => {
    const addToast = vi.fn();
    const ac = new AbortController();
    fetchWalletRefreshStatusJobStatus.mockResolvedValueOnce(
      baseStatus({ status: "succeeded", refreshed, skipped, errored: 0 }),
    );

    await pollWalletRefreshStatusCompletion("evt-1", "job-1", addToast, { maxAttempts: 3, signal: ac.signal });

    expect(addToast).toHaveBeenCalledWith(expected, "success");
  });

  it("toasts info when nothing needed refreshing", async () => {
    const addToast = vi.fn();
    const ac = new AbortController();
    fetchWalletRefreshStatusJobStatus.mockResolvedValueOnce(
      baseStatus({ status: "succeeded", refreshed: 0, skipped: 5, errored: 0 }),
    );

    await pollWalletRefreshStatusCompletion("evt-1", "job-1", addToast, { maxAttempts: 3, signal: ac.signal });

    expect(addToast).toHaveBeenCalledWith("Wallet status refresh finished - nothing needed refreshing.", "info");
  });

  it("toasts warning for a mix of refreshed and failed", async () => {
    const addToast = vi.fn();
    const ac = new AbortController();
    fetchWalletRefreshStatusJobStatus.mockResolvedValueOnce(
      baseStatus({ status: "succeeded", refreshed: 1, skipped: 0, errored: 1 }),
    );

    await pollWalletRefreshStatusCompletion("evt-1", "job-1", addToast, { maxAttempts: 3, signal: ac.signal });

    expect(addToast).toHaveBeenCalledWith("Wallet status refresh: 1 updated, 1 failed.", "warning");
  });

  it("toasts error when the job itself fails to run", async () => {
    const addToast = vi.fn();
    const ac = new AbortController();
    fetchWalletRefreshStatusJobStatus.mockResolvedValueOnce(
      baseStatus({ status: "failed", error: "wallet_not_configured" }),
    );

    await pollWalletRefreshStatusCompletion("evt-1", "job-1", addToast, { maxAttempts: 3, signal: ac.signal });

    expect(addToast).toHaveBeenCalledWith(
      "Wallet status refresh failed to run. Try Refresh status from the wallet menu.",
      "error",
    );
  });

  it("polls until a terminal status, then toasts once", async () => {
    vi.useFakeTimers();
    const addToast = vi.fn();
    const ac = new AbortController();
    fetchWalletRefreshStatusJobStatus
      .mockResolvedValueOnce(baseStatus({ status: "pending" }))
      .mockResolvedValueOnce(baseStatus({ status: "running", progressTotal: 5, progressDone: 2 }))
      .mockResolvedValueOnce(baseStatus({ status: "succeeded", refreshed: 5, skipped: 0, errored: 0 }));

    const done = pollWalletRefreshStatusCompletion("evt-1", "job-1", addToast, {
      maxAttempts: 5,
      intervalMs: 1000,
      signal: ac.signal,
    });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await done;

    expect(fetchWalletRefreshStatusJobStatus).toHaveBeenCalledTimes(3);
    expect(addToast).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledWith("5 wallet passes refreshed.", "success");
  });

  it("toasts info when attempts are exhausted while still running", async () => {
    const addToast = vi.fn();
    const ac = new AbortController();
    fetchWalletRefreshStatusJobStatus.mockResolvedValue(baseStatus({ status: "running" }));

    await pollWalletRefreshStatusCompletion("evt-1", "job-1", addToast, {
      maxAttempts: 2,
      intervalMs: 0,
      signal: ac.signal,
    });

    expect(fetchWalletRefreshStatusJobStatus).toHaveBeenCalledTimes(2);
    expect(addToast).toHaveBeenCalledWith("Wallet status refresh is still running in the background.", "info");
  });

  it("exits quietly when already aborted before the first poll", async () => {
    const addToast = vi.fn();
    const ac = new AbortController();
    ac.abort();

    await pollWalletRefreshStatusCompletion("evt-1", "job-1", addToast, { maxAttempts: 3, signal: ac.signal });

    expect(fetchWalletRefreshStatusJobStatus).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("passes the AbortSignal through to the status fetch and skips toasts after abort", async () => {
    const addToast = vi.fn();
    const ac = new AbortController();
    fetchWalletRefreshStatusJobStatus.mockImplementation(
      async (_eventId: string, _jobId: string, signal?: AbortSignal) => {
        expect(signal).toBe(ac.signal);
        ac.abort();
        throw new DOMException("Aborted", "AbortError");
      },
    );

    await pollWalletRefreshStatusCompletion("evt-1", "job-1", addToast, { maxAttempts: 3, signal: ac.signal });

    expect(addToast).not.toHaveBeenCalled();
  });

  it("rethrows non-abort errors from the status fetch", async () => {
    const addToast = vi.fn();
    const ac = new AbortController();
    fetchWalletRefreshStatusJobStatus.mockRejectedValueOnce(new Error("network down"));

    await expect(
      pollWalletRefreshStatusCompletion("evt-1", "job-1", addToast, { maxAttempts: 2, signal: ac.signal }),
    ).rejects.toThrow("network down");
    expect(addToast).not.toHaveBeenCalled();
  });

  it("rejects immediately, without toasting, when the signal is already aborted by the time a non-terminal poll needs to sleep", async () => {
    const addToast = vi.fn();
    const ac = new AbortController();
    fetchWalletRefreshStatusJobStatus.mockImplementationOnce(async () => {
      ac.abort();
      return baseStatus({ status: "running" });
    });

    await pollWalletRefreshStatusCompletion("evt-1", "job-1", addToast, { maxAttempts: 3, signal: ac.signal });

    expect(addToast).not.toHaveBeenCalled();
  });

  it("stops sleeping and exits quietly when aborted while waiting between polls", async () => {
    vi.useFakeTimers();
    const addToast = vi.fn();
    const ac = new AbortController();
    fetchWalletRefreshStatusJobStatus.mockResolvedValueOnce(baseStatus({ status: "running" }));

    const done = pollWalletRefreshStatusCompletion("evt-1", "job-1", addToast, {
      maxAttempts: 5,
      intervalMs: 5000,
      signal: ac.signal,
    });
    await Promise.resolve();
    ac.abort();
    await done;

    expect(fetchWalletRefreshStatusJobStatus).toHaveBeenCalledTimes(1);
    expect(addToast).not.toHaveBeenCalled();
  });

  it("treats a missing refreshed/skipped/errored triple as all-zero", async () => {
    const addToast = vi.fn();
    const ac = new AbortController();
    fetchWalletRefreshStatusJobStatus.mockResolvedValueOnce(baseStatus({ status: "succeeded" }));

    await pollWalletRefreshStatusCompletion("evt-1", "job-1", addToast, { maxAttempts: 3, signal: ac.signal });

    expect(addToast).toHaveBeenCalledWith("Wallet status refresh finished - nothing needed refreshing.", "info");
  });

  it("uses the default maxAttempts/intervalMs when the caller supplies neither", async () => {
    const addToast = vi.fn();
    const ac = new AbortController();
    fetchWalletRefreshStatusJobStatus.mockResolvedValueOnce(
      baseStatus({ status: "succeeded", refreshed: 1, skipped: 0, errored: 0 }),
    );

    await pollWalletRefreshStatusCompletion("evt-1", "job-1", addToast, { signal: ac.signal });

    expect(addToast).toHaveBeenCalledWith("1 wallet pass refreshed.", "success");
  });
});
