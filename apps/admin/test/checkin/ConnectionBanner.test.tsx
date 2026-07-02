// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionState } from "../../src/connection/types.js";
import {
  CheckinConnectionBanner,
  CheckinConnectionLiveRegion,
  CheckinConnectionPill,
} from "../../src/checkin/ConnectionBanner.js";

const useConnectionState = vi.fn();

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => useConnectionState(),
}));

function mockState(state: ConnectionState) {
  useConnectionState.mockReturnValue({ state, lastCheckedAt: null, reportApiError: vi.fn() });
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
      screen.getByText("Offline — new check-ins are blocked until connection returns"),
    ).toBeTruthy();
  });
});

describe("CheckinConnectionPill", () => {
  it("shows a compact label when connected", () => {
    mockState("connected");
    render(<CheckinConnectionPill />);
    expect(screen.getByText("Server connected")).toBeTruthy();
  });

  it("hides when not connected", () => {
    mockState("offline");
    const { container } = render(<CheckinConnectionPill />);
    expect(container.firstChild).toBeNull();
  });
});

describe("CheckinConnectionLiveRegion", () => {
  it("keeps a single polite live region for connected state", () => {
    mockState("connected");
    render(<CheckinConnectionLiveRegion />);
    const region = screen.getByTestId("checkin-connection-live");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toContain("Connected — all scans confirmed by server");
  });

  it("updates the live region message when connection recovers", () => {
    mockState("offline");
    const { rerender } = render(<CheckinConnectionLiveRegion />);
    expect(screen.getByTestId("checkin-connection-live").textContent).toContain("Offline");

    mockState("connected");
    rerender(<CheckinConnectionLiveRegion />);
    expect(screen.getByTestId("checkin-connection-live").textContent).toContain(
      "Connected — all scans confirmed by server",
    );
  });
});
