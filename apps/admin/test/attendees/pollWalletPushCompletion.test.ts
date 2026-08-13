import { beforeEach, describe, expect, it, vi } from "vitest";
import { pollWalletPushCompletion } from "../../src/attendees/pollWalletPushCompletion.js";

const fetchWalletPushJobStatus = vi.fn();

vi.mock("../../src/api/client.js", () => ({
  fetchWalletPushJobStatus: (...args: unknown[]) => fetchWalletPushJobStatus(...args),
}));

function baseStatus(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    jobId: "job-1",
    status: "running",
    error: null,
    progressTotal: null,
    progressDone: null,
    reissued: null,
    skipped: null,
    errored: null,
    ...overrides,
  };
}

describe("pollWalletPushCompletion", () => {
  beforeEach(() => {
    fetchWalletPushJobStatus.mockReset();
  });

  it.each([
    [2, 0, "2 wallet passes updated."],
    [1, 0, "1 wallet pass updated."],
    [2, 3, "2 wallet passes updated (3 skipped)."],
  ])("toasts success for reissued=%i skipped=%i", async (reissued, skipped, expected) => {
    const addToast = vi.fn();
    const ac = new AbortController();
    fetchWalletPushJobStatus.mockResolvedValueOnce(
      baseStatus({ status: "succeeded", reissued, skipped, errored: 0 }),
    );

    await pollWalletPushCompletion("evt-1", "job-1", addToast, { maxAttempts: 3, signal: ac.signal });

    expect(addToast).toHaveBeenCalledWith(expected, "success");
  });

  it("toasts info when nothing needed pushing", async () => {
    const addToast = vi.fn();
    const ac = new AbortController();
    fetchWalletPushJobStatus.mockResolvedValueOnce(
      baseStatus({ status: "succeeded", reissued: 0, skipped: 5, errored: 0 }),
    );

    await pollWalletPushCompletion("evt-1", "job-1", addToast, { maxAttempts: 3, signal: ac.signal });

    expect(addToast).toHaveBeenCalledWith("Wallet pass update finished - nothing needed pushing.", "info");
  });

  it("toasts warning for a mix of updated and failed", async () => {
    const addToast = vi.fn();
    const ac = new AbortController();
    fetchWalletPushJobStatus.mockResolvedValueOnce(
      baseStatus({ status: "succeeded", reissued: 1, skipped: 0, errored: 1 }),
    );

    await pollWalletPushCompletion("evt-1", "job-1", addToast, { maxAttempts: 3, signal: ac.signal });

    expect(addToast).toHaveBeenCalledWith("Wallet pass update: 1 updated, 1 failed.", "warning");
  });

  it("toasts error when the job itself fails to run", async () => {
    const addToast = vi.fn();
    const ac = new AbortController();
    fetchWalletPushJobStatus.mockResolvedValueOnce(baseStatus({ status: "failed", error: "wallet_not_configured" }));

    await pollWalletPushCompletion("evt-1", "job-1", addToast, { maxAttempts: 3, signal: ac.signal });

    expect(addToast).toHaveBeenCalledWith(
      "Wallet pass update failed to run. Try Push updates from the wallet menu.",
      "error",
    );
  });

  it("polls until a terminal status, then toasts once", async () => {
    vi.useFakeTimers();
    const addToast = vi.fn();
    const ac = new AbortController();
    fetchWalletPushJobStatus
      .mockResolvedValueOnce(baseStatus({ status: "pending" }))
      .mockResolvedValueOnce(baseStatus({ status: "running", progressTotal: 5, progressDone: 2 }))
      .mockResolvedValueOnce(baseStatus({ status: "succeeded", reissued: 5, skipped: 0, errored: 0 }));

    const done = pollWalletPushCompletion("evt-1", "job-1", addToast, {
      maxAttempts: 5,
      intervalMs: 1000,
      signal: ac.signal,
    });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await done;

    expect(fetchWalletPushJobStatus).toHaveBeenCalledTimes(3);
    expect(addToast).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledWith("5 wallet passes updated.", "success");
    vi.useRealTimers();
  });

  it("toasts info when attempts are exhausted while still running", async () => {
    const addToast = vi.fn();
    const ac = new AbortController();
    fetchWalletPushJobStatus.mockResolvedValue(baseStatus({ status: "running" }));

    await pollWalletPushCompletion("evt-1", "job-1", addToast, { maxAttempts: 2, intervalMs: 0, signal: ac.signal });

    expect(fetchWalletPushJobStatus).toHaveBeenCalledTimes(2);
    expect(addToast).toHaveBeenCalledWith("Wallet pass update is still running in the background.", "info");
  });

  it("exits quietly when already aborted before the first poll", async () => {
    const addToast = vi.fn();
    const ac = new AbortController();
    ac.abort();

    await pollWalletPushCompletion("evt-1", "job-1", addToast, { maxAttempts: 3, signal: ac.signal });

    expect(fetchWalletPushJobStatus).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("passes the AbortSignal through to the status fetch and skips toasts after abort", async () => {
    const addToast = vi.fn();
    const ac = new AbortController();
    fetchWalletPushJobStatus.mockImplementation(async (_eventId: string, _jobId: string, signal?: AbortSignal) => {
      expect(signal).toBe(ac.signal);
      ac.abort();
      throw new DOMException("Aborted", "AbortError");
    });

    await pollWalletPushCompletion("evt-1", "job-1", addToast, { maxAttempts: 3, signal: ac.signal });

    expect(addToast).not.toHaveBeenCalled();
  });

  it("rethrows non-abort errors from the status fetch", async () => {
    const addToast = vi.fn();
    const ac = new AbortController();
    fetchWalletPushJobStatus.mockRejectedValueOnce(new Error("network down"));

    await expect(
      pollWalletPushCompletion("evt-1", "job-1", addToast, { maxAttempts: 2, signal: ac.signal }),
    ).rejects.toThrow("network down");
    expect(addToast).not.toHaveBeenCalled();
  });
});
