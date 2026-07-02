// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionState } from "../../src/connection/types.js";
import {
  CheckinConnectionBanner,
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
