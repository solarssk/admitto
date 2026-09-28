// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const triggerEventWideWalletRemoveInactive = vi.fn();
const pollWalletCleanupCompletion = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  triggerEventWideWalletRemoveInactive: (...args: unknown[]) => triggerEventWideWalletRemoveInactive(...args),
}));
vi.mock("../../src/attendees/pollWalletCleanupCompletion.js", () => ({
  pollWalletCleanupCompletion: (...args: unknown[]) => pollWalletCleanupCompletion(...args),
}));

import { useWalletRemoveInactive } from "../../src/attendees/useWalletRemoveInactive.js";

/** useWalletCleanupAction's own full behaviour (event-scoped confirmation, navigation resets,
 * poll abort, cancel-while-busy) is exercised end to end via useWalletVoidActive's test suite -
 * this file only checks that the "remove_inactive" instantiation wires the right endpoint,
 * copy key, and fallback text, since that is the only thing that differs. */
describe("useWalletRemoveInactive", () => {
  const addToast = vi.fn();
  const reportApiError = vi.fn();
  const onFinished = vi.fn();

  function setup() {
    return renderHook(() =>
      useWalletRemoveInactive({ eventId: "evt-1", addToast, reportApiError, onFinished }),
    );
  }

  beforeEach(() => {
    triggerEventWideWalletRemoveInactive.mockReset().mockResolvedValue({ jobId: "job-1" });
    pollWalletCleanupCompletion.mockReset().mockResolvedValue(undefined);
    addToast.mockReset();
    reportApiError.mockReset();
    onFinished.mockReset();
  });

  it("triggers the remove-inactive endpoint and polls with the 'remove_inactive' action", async () => {
    const { result } = setup();
    act(() => result.current.requestConfirm());

    await act(async () => {
      await result.current.confirm();
    });

    expect(triggerEventWideWalletRemoveInactive).toHaveBeenCalledWith("evt-1");
    expect(result.current.confirmOpen).toBe(false);
    expect(pollWalletCleanupCompletion).toHaveBeenCalledWith(
      "remove_inactive",
      "evt-1",
      "job-1",
      addToast,
      expect.objectContaining({ onSuccess: onFinished }),
    );
  });

  it("shows the remove-specific fallback error when the request fails", async () => {
    triggerEventWideWalletRemoveInactive.mockRejectedValueOnce(new Error("network down"));
    const { result } = setup();
    act(() => result.current.requestConfirm());

    await act(async () => {
      await result.current.confirm();
    });

    expect(result.current.error).toBe("Failed to remove the wallet passes.");
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
        "Could not check on the removal. It may still be running in the background.",
        "info",
      );
    });
  });
});
