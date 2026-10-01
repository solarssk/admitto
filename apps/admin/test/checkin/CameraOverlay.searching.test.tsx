// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CameraOverlay } from "../../src/checkin/CameraOverlay.js";

vi.mock("../../src/checkin/CameraScanner.js", () => ({
  CameraScanner: () => <div data-testid="camera-scanner" />,
}));

afterEach(cleanup);

const baseProps = {
  open: true,
  eventTimezone: "UTC",
  admittedCount: 7,
  history: [],
  wedgeActive: false,
  onClose: () => {},
  onScan: vi.fn(),
  allowManualLookup: true,
  onSearch: vi.fn().mockResolvedValue([]),
  onSelectAttendee: vi.fn(),
  onManualEntry: vi.fn(),
  onClearManualError: () => {},
  scanResult: null,
  card: null,
  pending: false,
  canAct: true,
  onReset: () => {},
};

describe("CameraOverlay while a scan or search is in flight", () => {
  it("says 'Checking…' over the camera frame at once, with a spinner announced as 'Checking'", () => {
    const { rerender } = render(<CameraOverlay {...baseProps} />);
    expect(screen.queryByText("Checking…")).toBeNull();
    expect(screen.queryByRole("status", { name: "Checking" })).toBeNull();

    rerender(<CameraOverlay {...baseProps} searching />);
    const pill = screen.getByText("Checking…").closest(".ck-overlay__checking");
    expect(pill).not.toBeNull();
    // Over the frame the camera and the viewfinder live in, not in the flow around it.
    expect(pill?.parentElement?.className).toContain("ck-overlay__frame");
    expect(screen.getByRole("status", { name: "Checking" })).toBeTruthy();
    // The text is hidden from assistive tech: the spinner already says it, once.
    expect(screen.getByText("Checking…").getAttribute("aria-hidden")).toBe("true");

    rerender(<CameraOverlay {...baseProps} />);
    expect(screen.queryByText("Checking…")).toBeNull();
  });
});
