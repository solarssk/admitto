// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { EraseAttendeesResponse } from "../../src/api/types.js";
import { useEraseWalletResult } from "../../src/attendees/useEraseWalletResult.js";

const addToast = vi.fn();

vi.mock("@admitto/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/ui")>();
  return { ...actual, useToast: () => ({ addToast }) };
});

const answer = (walletPending: number): EraseAttendeesResponse => ({
  erased: 0,
  already_erased: 1,
  not_found: 0,
  wallet_pending: walletPending,
  wallet_removed_ids: [],
});

function setup(scopeKey = "evt-1") {
  const onSettled = vi.fn();
  const hook = renderHook(({ scope }) => useEraseWalletResult({ scopeKey: scope, onSettled }), {
    initialProps: { scope: scopeKey },
  });
  return { ...hook, onSettled };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useEraseWalletResult", () => {
  it("is closed until it is opened, and closes again", () => {
    const { result } = setup();
    expect(result.current.dialogProps).toMatchObject({ open: false, pending: 0, retrying: false, error: null });

    act(() => result.current.open(2, async () => answer(0)));
    expect(result.current.dialogProps).toMatchObject({ open: true, pending: 2 });

    act(() => result.current.dialogProps.onClose());
    expect(result.current.dialogProps.open).toBe(false);
  });

  it("closes with a toast when the retry finds nothing left, and tells the page to refresh", async () => {
    const { result, onSettled } = setup();
    const retry = vi.fn().mockResolvedValue(answer(0));
    act(() => result.current.open(1, retry));

    act(() => result.current.dialogProps.onTryAgain());

    await waitFor(() => expect(result.current.dialogProps.open).toBe(false));
    expect(addToast).toHaveBeenCalledWith("Wallet pass deleted", "success");
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith(answer(0));
  });

  it("says passes in the plural when several were left", async () => {
    const { result } = setup();
    act(() => result.current.open(3, async () => answer(0)));

    act(() => result.current.dialogProps.onTryAgain());

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("Wallet passes deleted", "success"));
  });

  it("stays open with the new count while the provider still fails", async () => {
    const { result, onSettled } = setup();
    act(() => result.current.open(3, async () => answer(2)));

    act(() => result.current.dialogProps.onTryAgain());

    await waitFor(() => expect(result.current.dialogProps.pending).toBe(2));
    expect(result.current.dialogProps.open).toBe(true);
    // The button stays busy for a moment after the answer (400ms at least).
    await waitFor(() => expect(result.current.dialogProps.retrying).toBe(false));
    expect(addToast).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith(answer(2));
  });

  it("shows an operator-safe error when the retry itself fails, and clears it on Close", async () => {
    const { result, onSettled } = setup();
    act(() => result.current.open(1, async () => Promise.reject(new ApiError(500, "secret_internal"))));

    act(() => result.current.dialogProps.onTryAgain());

    await waitFor(() => expect(result.current.dialogProps.error).toBe("Could not try again. Try again in a moment."));
    expect(onSettled).not.toHaveBeenCalled();

    act(() => result.current.dialogProps.onClose());
    expect(result.current.dialogProps).toMatchObject({ open: false, error: null });
  });

  it("keeps the failure of the earlier try on screen while the next one runs, and drops it when the answer is in", async () => {
    const { result } = setup();
    let finish!: (value: EraseAttendeesResponse) => void;
    const retry = vi
      .fn<() => Promise<EraseAttendeesResponse>>()
      .mockRejectedValueOnce(new ApiError(500, "secret_internal"))
      .mockImplementationOnce(() => new Promise<EraseAttendeesResponse>((resolve) => (finish = resolve)));
    act(() => result.current.open(1, retry));
    act(() => result.current.dialogProps.onTryAgain());
    await waitFor(() => expect(result.current.dialogProps.error).toBe("Could not try again. Try again in a moment."));
    await waitFor(() => expect(result.current.dialogProps.retrying).toBe(false));

    act(() => result.current.dialogProps.onTryAgain());
    await waitFor(() => expect(result.current.dialogProps.retrying).toBe(true));
    expect(result.current.dialogProps.error).toBe("Could not try again. Try again in a moment.");

    await act(async () => finish(answer(0)));
    expect(result.current.dialogProps).toMatchObject({ open: false, error: null });
  });

  it("replaces the failure of the earlier try with the new count when the provider still fails", async () => {
    const { result } = setup();
    const retry = vi
      .fn<() => Promise<EraseAttendeesResponse>>()
      .mockRejectedValueOnce(new ApiError(500, "secret_internal"))
      .mockResolvedValueOnce(answer(1));
    act(() => result.current.open(2, retry));
    act(() => result.current.dialogProps.onTryAgain());
    await waitFor(() => expect(result.current.dialogProps.error).not.toBeNull());
    await waitFor(() => expect(result.current.dialogProps.retrying).toBe(false));

    act(() => result.current.dialogProps.onTryAgain());

    await waitFor(() => expect(result.current.dialogProps).toMatchObject({ open: true, pending: 1, error: null }));
  });

  it("keeps the button busy for at least 400ms when a retry fails at once", async () => {
    vi.useFakeTimers();
    try {
      const { result } = setup();
      act(() => result.current.open(1, async () => Promise.reject(new ApiError(500, "secret_internal"))));

      // The click is committed first, as it is in a browser; then the failure arrives.
      act(() => result.current.dialogProps.onTryAgain());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(result.current.dialogProps.error).toBe("Could not try again. Try again in a moment.");
      expect(result.current.dialogProps.retrying).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(result.current.dialogProps.retrying).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores Close while a retry is on its way", async () => {
    const { result } = setup();
    let finish!: (value: EraseAttendeesResponse) => void;
    const retry = vi.fn(() => new Promise<EraseAttendeesResponse>((resolve) => (finish = resolve)));
    act(() => result.current.open(1, retry));

    act(() => result.current.dialogProps.onTryAgain());
    await waitFor(() => expect(result.current.dialogProps.retrying).toBe(true));
    act(() => result.current.dialogProps.onClose());
    expect(result.current.dialogProps.open).toBe(true);

    await act(async () => finish(answer(0)));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(result.current.dialogProps.open).toBe(false);
  });

  it("does nothing on Try again when there is nothing to retry", () => {
    const { result, onSettled } = setup();

    act(() => result.current.dialogProps.onTryAgain());

    expect(onSettled).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("closes when the page moves to another event, and drops a retry that was on its way", async () => {
    const { result, rerender, onSettled } = setup("evt-1");
    let finish!: (value: EraseAttendeesResponse) => void;
    act(() => result.current.open(1, () => new Promise<EraseAttendeesResponse>((resolve) => (finish = resolve))));
    act(() => result.current.dialogProps.onTryAgain());
    await waitFor(() => expect(result.current.dialogProps.retrying).toBe(true));

    rerender({ scope: "evt-2" });
    await waitFor(() => expect(result.current.dialogProps.open).toBe(false));
    await act(async () => finish(answer(0)));

    expect(addToast).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("drops the failure of a retry that was on its way when the page moved on", async () => {
    const { result, rerender } = setup("evt-1");
    let fail!: (err: unknown) => void;
    act(() => result.current.open(1, () => new Promise<EraseAttendeesResponse>((_resolve, reject) => (fail = reject))));
    act(() => result.current.dialogProps.onTryAgain());
    await waitFor(() => expect(result.current.dialogProps.retrying).toBe(true));

    rerender({ scope: "evt-2" });
    await act(async () => fail(new ApiError(500, "secret_internal")));

    expect(result.current.dialogProps.error).toBeNull();
  });
});
