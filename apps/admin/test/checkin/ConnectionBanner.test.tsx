// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionState } from "../../src/connection/types.js";
import {
  CheckinConnectionBanner,
  CheckinConnectionLiveRegion,
} from "../../src/checkin/ConnectionBanner.js";
import { connectionStateValue } from "./connectionStateMock.js";

const useConnectionState = vi.fn();
vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => useConnectionState(),
}));

function mockState(state: ConnectionState) {
  useConnectionState.mockReturnValue(connectionStateValue(state));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CheckinConnectionBanner", () => {
  it("hides the banner when connected", () => {
    mockState("connected");
    const { container } = render(<CheckinConnectionBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("shows offline copy when offline", () => {
    mockState("offline");
    render(<CheckinConnectionBanner />);
    expect(
      screen.getByText("Offline. New check-ins are blocked until connection returns"),
    ).toBeTruthy();
  });
});

describe("CheckinConnectionLiveRegion", () => {
  it("keeps a single polite live region for connected state", () => {
    mockState("connected");
    render(<CheckinConnectionLiveRegion />);
    const region = screen.getByTestId("checkin-connection-live");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toContain("Connected. All scans confirmed by server");
  });

  it("updates the live region message when connection recovers", () => {
    mockState("offline");
    const { rerender } = render(<CheckinConnectionLiveRegion />);
    expect(screen.getByTestId("checkin-connection-live").textContent).toContain("Offline");

    mockState("connected");
    rerender(<CheckinConnectionLiveRegion />);
    expect(screen.getByTestId("checkin-connection-live").textContent).toContain(
      "Connected. All scans confirmed by server",
    );
  });
});
