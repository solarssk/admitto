// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const triggerEventWideWalletVoidActive = vi.fn();
const pollWalletCleanupCompletion = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  triggerEventWideWalletVoidActive: (...args: unknown[]) => triggerEventWideWalletVoidActive(...args),
}));
vi.mock("../../src/attendees/pollWalletCleanupCompletion.js", () => ({
  pollWalletCleanupCompletion: (...args: unknown[]) => pollWalletCleanupCompletion(...args),
}));

import { useWalletVoidActive } from "../../src/attendees/useWalletVoidActive.js";

describe("useWalletVoidActive", () => {
  const addToast = vi.fn();
  const reportApiError = vi.fn();
  const onFinished = vi.fn();

  /** `null` stands for "no event in the route" (a default parameter would swallow `undefined`). */
  function setup(initialEventId: string | null = "evt-1") {
    return renderHook(
      ({ eventId }: { eventId: string | undefined }) =>
        useWalletVoidActive({ eventId, addToast, reportApiError, onFinished }),
      { initialProps: { eventId: initialEventId ?? undefined } },
    );
  }

  beforeEach(() => {
    triggerEventWideWalletVoidActive.mockReset().mockResolvedValue({ jobId: "job-1" });
    pollWalletCleanupCompletion.mockReset().mockResolvedValue(undefined);
    addToast.mockReset();
    reportApiError.mockReset();
    onFinished.mockReset();
  });

  it("opens the confirmation for the current event and voids that event when confirmed", async () => {
    const { result } = setup();
    act(() => result.current.requestConfirm());
    expect(result.current.confirmOpen).toBe(true);

    await act(async () => {
      await result.current.confirm();
    });

    expect(triggerEventWideWalletVoidActive).toHaveBeenCalledWith("evt-1");
    expect(result.current.confirmOpen).toBe(false);
    expect(pollWalletCleanupCompletion).toHaveBeenCalledWith(
      "void_active",
      "evt-1",
      "job-1",
      addToast,
      expect.objectContaining({ onSuccess: onFinished }),
    );
  });

  it("does nothing without a route event, and confirm without an open confirmation does nothing", async () => {
    const { result } = setup(null);
    act(() => result.current.requestConfirm());
    expect(result.current.confirmOpen).toBe(false);

    await act(async () => {
      await result.current.confirm();
    });

    expect(triggerEventWideWalletVoidActive).not.toHaveBeenCalled();
  });

  it("drops the confirmation when the route moves to another event: nothing can be confirmed for it", async () => {
    const { result, rerender } = setup("evt-1");
    act(() => result.current.requestConfirm());
    expect(result.current.confirmOpen).toBe(true);

    rerender({ eventId: "evt-2" });

    expect(result.current.confirmOpen).toBe(false);
    await act(async () => {
      await result.current.confirm();
    });
    expect(triggerEventWideWalletVoidActive).not.toHaveBeenCalled();
  });

  it("does not come back when the operator returns to the event it was opened on, and confirming there does nothing", async () => {
    const { result, rerender } = setup("evt-1");
    act(() => result.current.requestConfirm());
    expect(result.current.confirmOpen).toBe(true);

    rerender({ eventId: "evt-2" });
    rerender({ eventId: "evt-1" });

    expect(result.current.confirmOpen).toBe(false);
    await act(async () => {
      await result.current.confirm();
    });
    expect(triggerEventWideWalletVoidActive).not.toHaveBeenCalled();
  });

  it("shows an error only on the event it happened on", async () => {
    triggerEventWideWalletVoidActive.mockRejectedValueOnce(new Error("network down"));
    const { result, rerender } = setup("evt-1");
    act(() => result.current.requestConfirm());
    await act(async () => {
      await result.current.confirm();
    });
    expect(result.current.error).toBe("Failed to void the wallet passes.");

    rerender({ eventId: "evt-2" });

    expect(result.current.error).toBeNull();
  });

  it("cancel closes the confirmation and clears its error, but not while a request is in flight", async () => {
    let resolveTrigger!: (value: { jobId: string }) => void;
    triggerEventWideWalletVoidActive.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveTrigger = resolve;
      }),
    );
    const { result } = setup();
    act(() => result.current.requestConfirm());
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.confirm();
    });
    await waitFor(() => expect(result.current.busy).toBe(true));

    act(() => result.current.cancel());
    expect(result.current.confirmOpen).toBe(true);

    await act(async () => {
      resolveTrigger({ jobId: "job-1" });
      await pending;
    });
    act(() => result.current.requestConfirm());
    act(() => result.current.cancel());
    expect(result.current.confirmOpen).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("stays quiet when its own poll fails after the event changed (the poll was aborted)", async () => {
    let rejectPoll!: (err: unknown) => void;
    pollWalletCleanupCompletion.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectPoll = reject;
      }),
    );
    const { result, rerender } = setup("evt-1");
    act(() => result.current.requestConfirm());
    await act(async () => {
      await result.current.confirm();
    });
    addToast.mockClear();

    rerender({ eventId: "evt-2" });
    await act(async () => {
      rejectPoll(new Error("aborted"));
      await Promise.resolve();
    });

    expect(addToast).not.toHaveBeenCalled();
  });

  it("tells the operator checking failed, not that the job did not run, when a live poll fails", async () => {
    pollWalletCleanupCompletion.mockRejectedValueOnce(new Error("network down"));
    const { result } = setup();
    act(() => result.current.requestConfirm());

    await act(async () => {
      await result.current.confirm();
    });

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        "Could not check on the voiding. It may still be running in the background.",
        "info",
      );
    });
  });
});
