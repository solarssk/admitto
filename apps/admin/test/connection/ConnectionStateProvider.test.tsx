// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionBanner, ConnectionStateProvider } from "../../src/connection/ConnectionStateProvider.js";
import { ApiError, fetchMe } from "../../src/api/client.js";
import { clearSignOutInProgress, markSignOutInProgress } from "../../src/auth/sign-out-in-progress.js";

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  fetchMe: vi.fn(),
}));

const mockFetchMe = vi.mocked(fetchMe);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ConnectionStateProvider", () => {
  it("uses the successful auth bootstrap instead of immediately pinging /me again", () => {
    render(
      <ConnectionStateProvider initiallyConnected>
        <ConnectionBanner />
      </ConnectionStateProvider>,
    );

    expect(mockFetchMe).not.toHaveBeenCalled();
    expect(screen.queryByText(/not connected/i)).toBeNull();
  });

  it("pings /me on mount when no authenticated bootstrap result is available", async () => {
    mockFetchMe.mockResolvedValueOnce({} as never);

    render(
      <ConnectionStateProvider>
        <ConnectionBanner />
      </ConnectionStateProvider>,
    );

    await waitFor(() => expect(mockFetchMe).toHaveBeenCalledTimes(1));
  });
});

describe("ConnectionStateProvider when the connection check finds the session gone (401)", () => {
  const assign = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("location", { pathname: "/operator", search: "?tab=a", assign });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearSignOutInProgress();
  });

  it("goes to the sign-in page and keeps the page it was on as the way back", async () => {
    mockFetchMe.mockRejectedValueOnce(new ApiError(401, "unauthorized"));

    render(
      <ConnectionStateProvider>
        <ConnectionBanner />
      </ConnectionStateProvider>,
    );

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(assign).toHaveBeenCalledWith("/login?reason=session_ended&next=%2Foperator%3Ftab%3Da");
  });

  it("stays where it is while the user's Sign out is under way, so the trip to the identity provider is not replaced", async () => {
    markSignOutInProgress();
    mockFetchMe.mockRejectedValueOnce(new ApiError(401, "unauthorized"));

    render(
      <ConnectionStateProvider>
        <ConnectionBanner />
      </ConnectionStateProvider>,
    );

    await waitFor(() => expect(mockFetchMe).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(assign).not.toHaveBeenCalled();
  });
});
