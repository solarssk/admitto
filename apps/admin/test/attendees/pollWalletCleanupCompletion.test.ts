import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollWalletCleanupCompletion } from "../../src/attendees/pollWalletCleanupCompletion.js";

const fetchWalletCleanupJobStatus = vi.fn();

vi.mock("../../src/api/client.js", () => ({
  fetchWalletCleanupJobStatus: (...args: unknown[]) => fetchWalletCleanupJobStatus(...args),
}));

const status = (overrides: Record<string, unknown> = {}) => ({
  jobId: "job-1",
  type: "wallet_void_active",
  status: "running",
  error: null,
  progressTotal: null,
  progressDone: null,
  done: null,
  skipped: null,
  errored: null,
  ...overrides,
});

/** Runs the poll for the void action with sensible defaults; returns what it toasted. */
async function poll(options: { maxAttempts?: number; intervalMs?: number; signal?: AbortSignal; onSuccess?: () => void } = {}) {
  const addToast = vi.fn();
  const ac = new AbortController();
  await pollWalletCleanupCompletion("void_active", "evt-1", "job-1", addToast, {
    maxAttempts: 3,
    intervalMs: 0,
    signal: ac.signal,
    ...options,
  });
  return addToast;
}

describe("pollWalletCleanupCompletion", () => {
  beforeEach(() => {
    fetchWalletCleanupJobStatus.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    [2, 0, "2 wallet passes voided."],
    [1, 0, "1 wallet pass voided."],
    [4, 3, "4 wallet passes voided (3 skipped)."],
  ])("toasts success for done=%i skipped=%i", async (done, skipped, expected) => {
    fetchWalletCleanupJobStatus.mockResolvedValueOnce(status({ status: "succeeded", done, skipped, errored: 0 }));

    expect(await poll()).toHaveBeenCalledWith(expected, "success");
  });

  it("toasts info when there was nothing to void", async () => {
    fetchWalletCleanupJobStatus.mockResolvedValueOnce(status({ status: "succeeded", done: 0, skipped: 2, errored: 0 }));

    expect(await poll()).toHaveBeenCalledWith("There were no active wallet passes to void.", "info");
  });

  it("treats a missing count as zero", async () => {
    fetchWalletCleanupJobStatus.mockResolvedValueOnce(status({ status: "succeeded" }));

    expect(await poll()).toHaveBeenCalledWith("There were no active wallet passes to void.", "info");
  });

  it.each([
    [1, 1, "1 wallet pass voided, 1 could not be voided. Run it again to retry those."],
    [5, 2, "5 wallet passes voided, 2 could not be voided. Run it again to retry those."],
  ])("toasts a warning when some passes could not be voided (done=%i errored=%i)", async (done, errored, expected) => {
    fetchWalletCleanupJobStatus.mockResolvedValueOnce(status({ status: "succeeded", done, skipped: 0, errored }));

    expect(await poll()).toHaveBeenCalledWith(expected, "warning");
  });

  it("calls onSuccess only for a succeeded job", async () => {
    const onSuccess = vi.fn();
    fetchWalletCleanupJobStatus.mockResolvedValueOnce(status({ status: "succeeded", done: 1 }));
    await poll({ onSuccess });
    expect(onSuccess).toHaveBeenCalledTimes(1);

    onSuccess.mockClear();
    fetchWalletCleanupJobStatus.mockResolvedValueOnce(status({ status: "failed" }));
    await poll({ onSuccess });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("toasts an error when the job itself fails to run", async () => {
    fetchWalletCleanupJobStatus.mockResolvedValueOnce(status({ status: "failed", error: "Wallet is not configured for this event." }));

    expect(await poll()).toHaveBeenCalledWith(
      "Voiding the wallet passes failed to run. Try again from More actions.",
      "error",
    );
  });

  it("polls until a terminal status, then toasts once", async () => {
    vi.useFakeTimers();
    const addToast = vi.fn();
    const ac = new AbortController();
    fetchWalletCleanupJobStatus
      .mockResolvedValueOnce(status({ status: "pending" }))
      .mockResolvedValueOnce(status({ status: "running", progressTotal: 5, progressDone: 2 }))
      .mockResolvedValueOnce(status({ status: "succeeded", done: 5 }));

    const finished = pollWalletCleanupCompletion("void_active", "evt-1", "job-1", addToast, {
      maxAttempts: 5,
      intervalMs: 1000,
      signal: ac.signal,
    });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await finished;

    expect(fetchWalletCleanupJobStatus).toHaveBeenCalledTimes(3);
    expect(addToast).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledWith("5 wallet passes voided.", "success");
  });

  it("reports background work, not a failure, when attempts run out while still running", async () => {
    fetchWalletCleanupJobStatus.mockResolvedValue(status({ status: "running" }));

    const addToast = await poll({ maxAttempts: 2 });

    expect(fetchWalletCleanupJobStatus).toHaveBeenCalledTimes(2);
    expect(addToast).toHaveBeenCalledWith("Voiding the wallet passes is still running in the background.", "info");
  });

  it("skips the final 'still running' toast when the signal was aborted exactly as attempts ran out", async () => {
    // Reports not-aborted for the loop's own checks but aborted by the post-loop check, to reach
    // that branch in isolation (a real abort mid-sleep rejects the sleep instead).
    let reads = 0;
    const fakeSignal = {
      get aborted() {
        reads += 1;
        return reads > 2;
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as AbortSignal;
    fetchWalletCleanupJobStatus.mockResolvedValue(status({ status: "running" }));

    const addToast = await poll({ maxAttempts: 1, signal: fakeSignal });

    expect(addToast).not.toHaveBeenCalled();
  });

  it("exits quietly when already aborted before the first poll", async () => {
    const ac = new AbortController();
    ac.abort();

    const addToast = await poll({ signal: ac.signal });

    expect(fetchWalletCleanupJobStatus).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("passes the signal to the status fetch and stays quiet when the fetch is aborted", async () => {
    const ac = new AbortController();
    fetchWalletCleanupJobStatus.mockImplementation(async (_eventId: string, _jobId: string, signal?: AbortSignal) => {
      expect(signal).toBe(ac.signal);
      ac.abort();
      throw new DOMException("Aborted", "AbortError");
    });

    const addToast = await poll({ signal: ac.signal });

    expect(addToast).not.toHaveBeenCalled();
  });

  it("rethrows non-abort errors from the status fetch", async () => {
    fetchWalletCleanupJobStatus.mockRejectedValueOnce(new Error("network down"));

    await expect(poll({ maxAttempts: 2 })).rejects.toThrow("network down");
  });

  it("stops without toasting when the signal aborts while waiting between polls", async () => {
    const ac = new AbortController();
    fetchWalletCleanupJobStatus.mockImplementationOnce(async () => {
      ac.abort();
      return status({ status: "running" });
    });

    const addToast = await poll({ signal: ac.signal, intervalMs: 50 });

    expect(fetchWalletCleanupJobStatus).toHaveBeenCalledTimes(1);
    expect(addToast).not.toHaveBeenCalled();
  });
});
