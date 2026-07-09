// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CameraOverlay } from "../../src/checkin/CameraOverlay.js";
import type { LookupAttendeeResult } from "../../src/api/types.js";

vi.mock("../../src/checkin/CameraScanner.js", () => ({
  CameraScanner: () => <div data-testid="camera-scanner" />,
}));

const SEARCH_DEBOUNCE_MS = 300;

function hit(overrides: Partial<LookupAttendeeResult> = {}): LookupAttendeeResult {
  return {
    id: "att-1",
    name: "Alice Smith",
    ticket_type: "VIP",
    company: "Acme",
    department: null,
    check_in_status: "not_admitted",
    ...overrides,
  };
}

const baseProps = {
  open: true,
  eventTimezone: "UTC",
  admittedCount: 0,
  history: [],
  wedgeActive: false,
  onClose: () => {},
  onScan: vi.fn(),
  allowManualLookup: true,
  onClearManualError: () => {},
  scanResult: null,
  card: null,
  pending: false,
  canAct: true,
  onReset: () => {},
};

function openManualSearch() {
  fireEvent.click(screen.getByText("Manual search"));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CameraOverlay manual search (#433)", () => {
  it("debounces the search — does not call onSearch until typing pauses", async () => {
    const onSearch = vi.fn().mockResolvedValue([]);
    render(
      <CameraOverlay
        {...baseProps}
        onSearch={onSearch}
        onSelectAttendee={vi.fn()}
        onManualEntry={vi.fn()}
      />,
    );

    openManualSearch();
    const input = screen.getByLabelText<HTMLInputElement>("Search by name or email");
    fireEvent.change(input, { target: { value: "Al" } });
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 50);
    expect(onSearch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(50);
    expect(onSearch).toHaveBeenCalledWith("Al");
  });

  it("renders results and selecting one closes the search and calls onSelectAttendee", async () => {
    const onSearch = vi.fn().mockResolvedValue([hit()]);
    const onSelectAttendee = vi.fn();
    render(
      <CameraOverlay
        {...baseProps}
        onSearch={onSearch}
        onSelectAttendee={onSelectAttendee}
        onManualEntry={vi.fn()}
      />,
    );

    openManualSearch();
    const input = screen.getByLabelText<HTMLInputElement>("Search by name or email");
    fireEvent.change(input, { target: { value: "Alice" } });
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);

    await waitFor(() => expect(screen.getByText("Alice Smith")).toBeTruthy());
    expect(screen.getByText("Acme · VIP")).toBeTruthy();

    fireEvent.click(screen.getByText("Alice Smith"));
    expect(onSelectAttendee).toHaveBeenCalledWith("att-1");
    // Selecting closes the search view — back to the camera frame.
    expect(screen.queryByLabelText("Search by name or email")).toBeNull();
  });

  it("shows a checked-in marker for an already-admitted match", async () => {
    const onSearch = vi.fn().mockResolvedValue([hit({ check_in_status: "admitted" })]);
    render(
      <CameraOverlay
        {...baseProps}
        onSearch={onSearch}
        onSelectAttendee={vi.fn()}
        onManualEntry={vi.fn()}
      />,
    );

    openManualSearch();
    fireEvent.change(screen.getByLabelText("Search by name or email"), {
      target: { value: "Alice" },
    });
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await waitFor(() => expect(screen.getByText("checked in")).toBeTruthy());
  });

  it("shows an empty state when nothing matches", async () => {
    const onSearch = vi.fn().mockResolvedValue([]);
    render(
      <CameraOverlay
        {...baseProps}
        onSearch={onSearch}
        onSelectAttendee={vi.fn()}
        onManualEntry={vi.fn()}
      />,
    );

    openManualSearch();
    fireEvent.change(screen.getByLabelText("Search by name or email"), {
      target: { value: "nomatch" },
    });
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await waitFor(() =>
      expect(screen.getByText('No attendees found for "nomatch"')).toBeTruthy(),
    );
  });

  it("never calls onSearch when manual lookup is disabled for the event", async () => {
    const onSearch = vi.fn().mockResolvedValue([hit()]);
    render(
      <CameraOverlay
        {...baseProps}
        allowManualLookup={false}
        onSearch={onSearch}
        onSelectAttendee={vi.fn()}
        onManualEntry={vi.fn()}
      />,
    );

    openManualSearch();
    fireEvent.change(screen.getByLabelText("Search by name or email"), {
      target: { value: "Alice" },
    });
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    expect(onSearch).not.toHaveBeenCalled();
    expect(screen.getByText(/Manual lookup is disabled/)).toBeTruthy();
  });

  it("Back to scanner closes the search view without selecting anything", async () => {
    const onSelectAttendee = vi.fn();
    render(
      <CameraOverlay
        {...baseProps}
        onSearch={vi.fn().mockResolvedValue([])}
        onSelectAttendee={onSelectAttendee}
        onManualEntry={vi.fn()}
      />,
    );

    openManualSearch();
    expect(screen.getByLabelText("Search by name or email")).toBeTruthy();

    fireEvent.click(screen.getByText("Back to scanner"));
    expect(screen.queryByLabelText("Search by name or email")).toBeNull();
    expect(screen.getByText("Manual search")).toBeTruthy();
    expect(onSelectAttendee).not.toHaveBeenCalled();
  });

  it("Enter submits the raw query through onManualEntry (token / exact-match path)", async () => {
    const onManualEntry = vi.fn().mockResolvedValue(true);
    render(
      <CameraOverlay
        {...baseProps}
        onSearch={vi.fn().mockResolvedValue([])}
        onSelectAttendee={vi.fn()}
        onManualEntry={onManualEntry}
      />,
    );

    openManualSearch();
    const input = screen.getByLabelText<HTMLInputElement>("Search by name or email");
    fireEvent.change(input, { target: { value: "QRTOKEN-REALPERSON0001" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onManualEntry).toHaveBeenCalledWith("QRTOKEN-REALPERSON0001");
  });

  it("Enter-submit closes the search screen once onManualEntry resolves true (review finding)", async () => {
    const onManualEntry = vi.fn().mockResolvedValue(true);
    render(
      <CameraOverlay
        {...baseProps}
        onSearch={vi.fn().mockResolvedValue([])}
        onSelectAttendee={vi.fn()}
        onManualEntry={onManualEntry}
      />,
    );

    openManualSearch();
    const input = screen.getByLabelText<HTMLInputElement>("Search by name or email");
    fireEvent.change(input, { target: { value: "QRTOKEN-REALPERSON0001" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.queryByLabelText("Search by name or email")).toBeNull());
  });

  it("Enter-submit keeps the search screen open when onManualEntry resolves false", async () => {
    const onManualEntry = vi.fn().mockResolvedValue(false);
    render(
      <CameraOverlay
        {...baseProps}
        onSearch={vi.fn().mockResolvedValue([])}
        onSelectAttendee={vi.fn()}
        onManualEntry={onManualEntry}
      />,
    );

    openManualSearch();
    const input = screen.getByLabelText<HTMLInputElement>("Search by name or email");
    fireEvent.change(input, { target: { value: "nomatch" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(onManualEntry).toHaveBeenCalled());
    expect(screen.getByLabelText("Search by name or email")).toBeTruthy();
  });

  it("keeps CameraScanner mounted (not torn down) while manual search is open — unmounting it mid-decode throws ZXing's AbortError", () => {
    render(
      <CameraOverlay
        {...baseProps}
        onSearch={vi.fn().mockResolvedValue([])}
        onSelectAttendee={vi.fn()}
        onManualEntry={vi.fn()}
      />,
    );

    const scannerBefore = screen.getByTestId("camera-scanner");
    openManualSearch();
    expect(screen.getByTestId("camera-scanner")).toBe(scannerBefore);
    expect(document.body.contains(scannerBefore)).toBe(true);

    fireEvent.click(screen.getByText("Back to scanner"));
    expect(screen.getByTestId("camera-scanner")).toBe(scannerBefore);
  });

  it("shows manualError inline and clears it as the operator keeps typing", async () => {
    const onClearManualError = vi.fn();
    render(
      <CameraOverlay
        {...baseProps}
        onSearch={vi.fn().mockResolvedValue([])}
        onSelectAttendee={vi.fn()}
        onManualEntry={vi.fn()}
        manualError="No attendees matched that search."
        onClearManualError={onClearManualError}
      />,
    );

    openManualSearch();
    expect(screen.getByText("No attendees matched that search.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Search by name or email"), {
      target: { value: "a" },
    });
    expect(onClearManualError).toHaveBeenCalled();
  });
});
