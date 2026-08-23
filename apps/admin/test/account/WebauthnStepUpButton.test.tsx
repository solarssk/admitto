// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebauthnStepUpButton } from "../../src/account/WebauthnStepUpButton.js";
import { ApiError } from "../../src/api/client.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    beginWebauthnAssertion: vi.fn(),
  };
});

// startAuthentication() calls the real navigator.credentials.get(), which doesn't exist in
// jsdom - every test drives it through this mock instead of a real WebAuthn ceremony.
vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication: vi.fn(),
}));

import { beginWebauthnAssertion } from "../../src/api/client.js";
import { startAuthentication } from "@simplewebauthn/browser";

const mockBegin = vi.mocked(beginWebauthnAssertion);
const mockAuthenticate = vi.mocked(startAuthentication);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup(onSubmit: (proof: unknown) => Promise<void>) {
  const onError = vi.fn();
  const onBusyChange = vi.fn();
  render(
    <WebauthnStepUpButton busy={false} onBusyChange={onBusyChange} onError={onError} onSubmit={onSubmit} />,
  );
  return { onError, onBusyChange };
}

describe("WebauthnStepUpButton", () => {
  it("runs the ceremony and hands the resulting proof to onSubmit", async () => {
    mockBegin.mockResolvedValue({ options: { challenge: "chal-1" } } as never);
    mockAuthenticate.mockResolvedValue({ id: "cred-1" } as never);
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { onError, onBusyChange } = setup(onSubmit);

    fireEvent.click(screen.getByRole("button", { name: "Use a passkey or security key" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ webauthn: { response: { id: "cred-1" } } }));
    expect(onError).toHaveBeenCalledWith(null);
    expect(onBusyChange).toHaveBeenCalledWith(true);
    expect(onBusyChange).toHaveBeenCalledWith(false);
  });

  it("shows a cancelled message when the browser ceremony is dismissed, without calling onSubmit", async () => {
    mockBegin.mockResolvedValue({ options: { challenge: "chal-1" } } as never);
    const cancelled = Object.assign(new Error("The operation either timed out or was not allowed."), {
      name: "NotAllowedError",
    });
    mockAuthenticate.mockRejectedValue(cancelled);
    const onSubmit = vi.fn();
    const { onError } = setup(onSubmit);

    fireEvent.click(screen.getByRole("button", { name: "Use a passkey or security key" }));

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith("Passkey or security key step-up was cancelled."),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows a generic message when the begin request itself fails", async () => {
    mockBegin.mockRejectedValue(new Error("network down"));
    const onSubmit = vi.fn();
    const { onError } = setup(onSubmit);

    fireEvent.click(screen.getByRole("button", { name: "Use a passkey or security key" }));

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        "Could not verify with your passkey or security key. Try again, or enter a code instead.",
      ),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("routes an ApiError thrown by the protected action through operatorApiErrorMessage, not the ceremony-cancelled copy", async () => {
    mockBegin.mockResolvedValue({ options: { challenge: "chal-1" } } as never);
    mockAuthenticate.mockResolvedValue({ id: "cred-1" } as never);
    const onSubmit = vi.fn().mockRejectedValue(new ApiError(401, "expired", "authentication_required"));
    const { onError } = setup(onSubmit);

    fireEvent.click(screen.getByRole("button", { name: "Use a passkey or security key" }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith("Your session has expired. Sign in again."));
  });

  it("falls back to the ceremony-generic message when the protected action throws a non-ApiError", async () => {
    mockBegin.mockResolvedValue({ options: { challenge: "chal-1" } } as never);
    mockAuthenticate.mockResolvedValue({ id: "cred-1" } as never);
    const onSubmit = vi.fn().mockRejectedValue(new TypeError("failed to fetch"));
    const { onError } = setup(onSubmit);

    fireEvent.click(screen.getByRole("button", { name: "Use a passkey or security key" }));

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        "Could not verify with your passkey or security key. Try again, or enter a code instead.",
      ),
    );
  });

  it("disables the button while busy", () => {
    render(
      <WebauthnStepUpButton busy={true} onBusyChange={vi.fn()} onError={vi.fn()} onSubmit={vi.fn()} />,
    );
    const button = screen.getByRole("button", { name: "Use a passkey or security key" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
