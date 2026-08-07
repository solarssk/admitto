import { beforeEach, describe, expect, it, vi } from "vitest";
import { pollBulkSendCompletion } from "../../src/attendees/pollBulkSendCompletion.js";

const fetchBulkSendStatus = vi.fn();

vi.mock("../../src/api/client.js", () => ({
  fetchBulkSendStatus: (...args: unknown[]) => fetchBulkSendStatus(...args),
}));

describe("pollBulkSendCompletion", () => {
  beforeEach(() => {
    fetchBulkSendStatus.mockReset();
  });

  it("toasts success when the queue drains with no failures", async () => {
    const addToast = vi.fn();
    fetchBulkSendStatus.mockResolvedValueOnce({ queued: 0, sent: 2, failed: 0 });

    await pollBulkSendCompletion("evt-1", "batch-1", addToast, { maxAttempts: 3, sleep: async () => {} });

    expect(addToast).toHaveBeenCalledWith("Send complete: 2 tickets sent.", "success");
  });

  it("toasts error when every drained ticket failed", async () => {
    const addToast = vi.fn();
    fetchBulkSendStatus.mockResolvedValueOnce({ queued: 0, sent: 0, failed: 1 });

    await pollBulkSendCompletion("evt-1", "batch-1", addToast, { maxAttempts: 3, sleep: async () => {} });

    expect(addToast).toHaveBeenCalledWith("Send failed: 1 ticket.", "error");
  });

  it("toasts warning for mixed sent and failed counts", async () => {
    const addToast = vi.fn();
    fetchBulkSendStatus.mockResolvedValueOnce({ queued: 0, sent: 1, failed: 1 });

    await pollBulkSendCompletion("evt-1", "batch-1", addToast, { maxAttempts: 3, sleep: async () => {} });

    expect(addToast).toHaveBeenCalledWith("Send complete: 1 sent, 1 failed.", "warning");
  });

  it("polls until queued reaches zero", async () => {
    const addToast = vi.fn();
    const sleep = vi.fn(async () => {});
    fetchBulkSendStatus
      .mockResolvedValueOnce({ queued: 2, sent: 0, failed: 0 })
      .mockResolvedValueOnce({ queued: 0, sent: 2, failed: 0 });

    await pollBulkSendCompletion("evt-1", "batch-1", addToast, {
      maxAttempts: 5,
      intervalMs: 10,
      sleep,
    });

    expect(sleep).toHaveBeenCalledWith(10);
    expect(fetchBulkSendStatus).toHaveBeenCalledTimes(2);
    expect(addToast).toHaveBeenCalledWith("Send complete: 2 tickets sent.", "success");
  });

  it("toasts info when attempts are exhausted while still queued", async () => {
    const addToast = vi.fn();
    fetchBulkSendStatus.mockResolvedValue({ queued: 1, sent: 0, failed: 0 });

    await pollBulkSendCompletion("evt-1", "batch-1", addToast, {
      maxAttempts: 2,
      sleep: async () => {},
    });

    expect(fetchBulkSendStatus).toHaveBeenCalledTimes(2);
    expect(addToast).toHaveBeenCalledWith(
      "Send is still running in the background. Check Communication for status.",
      "info",
    );
  });

  it("passes AbortSignal to fetch and skips toasts after abort", async () => {
    const addToast = vi.fn();
    const ac = new AbortController();
    fetchBulkSendStatus.mockImplementation(async (_eventId, _batchId, signal?: AbortSignal) => {
      expect(signal).toBe(ac.signal);
      ac.abort();
      throw new DOMException("Aborted", "AbortError");
    });

    await pollBulkSendCompletion("evt-1", "batch-1", addToast, {
      maxAttempts: 3,
      sleep: async () => {},
      signal: ac.signal,
    });

    expect(addToast).not.toHaveBeenCalled();
  });

  it("exits quietly when already aborted before the first poll", async () => {
    const addToast = vi.fn();
    const ac = new AbortController();
    ac.abort();

    await pollBulkSendCompletion("evt-1", "batch-1", addToast, {
      maxAttempts: 3,
      sleep: async () => {},
      signal: ac.signal,
    });

    expect(fetchBulkSendStatus).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
  });
});
