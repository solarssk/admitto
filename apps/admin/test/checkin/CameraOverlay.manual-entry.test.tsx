// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CameraOverlay } from "../../src/checkin/CameraOverlay.js";

vi.mock("../../src/checkin/CameraScanner.js", () => ({
  CameraScanner: () => <div data-testid="camera-scanner" />,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const baseProps = {
  open: true,
  eventTitle: "Test Event",
  eventTimezone: "UTC",
  admittedCount: 0,
  history: [],
  wedgeActive: false,
  onClose: () => {},
  onScan: () => {},
  onClearManualError: () => {},
  scanResult: null,
  card: null,
  pending: false,
  canAct: true,
  onReset: () => {},
};

afterEach(() => {
  cleanup();
});

describe("CameraOverlay manual entry (#277 review)", () => {
  it("clears the manual-entry field immediately on submit, not only on success", async () => {
    const entry = deferred<boolean>();
    const onManualEntry = vi.fn().mockReturnValueOnce(entry.promise);

    render(<CameraOverlay {...baseProps} onManualEntry={onManualEntry} />);

    fireEvent.click(screen.getByText(/Enter token or search/));
    const input = screen.getByLabelText<HTMLInputElement>("Enter token or search by name");

    fireEvent.change(input, { target: { value: "Alice" } });
    fireEvent.click(screen.getByText("Submit"));

    expect(onManualEntry).toHaveBeenCalledWith("Alice");
    // Root cause: this field has no disabled state, so a wedge scan arriving
    // while the request is pending would otherwise type after "Alice" still
    // sitting in the input.
    expect(input.value).toBe("");

    // A wedge scan now injects a real token while the lookup is still pending.
    fireEvent.change(input, { target: { value: "QRTOKEN-REALPERSON0001" } });
    expect(input.value).toBe("QRTOKEN-REALPERSON0001"); // not "AliceQRTOKEN-REALPERSON0001"

    entry.resolve(false);
    await Promise.resolve();
  });

  it("closes the manual panel on success, keeps it open (but cleared) on failure", async () => {
    const onManualEntrySuccess = vi.fn().mockResolvedValue(true);
    const { unmount } = render(
      <CameraOverlay {...baseProps} onManualEntry={onManualEntrySuccess} />,
    );

    fireEvent.click(screen.getByText(/Enter token or search/));
    const input = screen.getByLabelText<HTMLInputElement>("Enter token or search by name");
    fireEvent.change(input, { target: { value: "match-me" } });
    fireEvent.click(screen.getByText("Submit"));

    await waitFor(() =>
      expect(screen.queryByLabelText("Enter token or search by name")).toBeNull(),
    );
    unmount();

    const onManualEntryFail = vi.fn().mockResolvedValue(false);
    render(<CameraOverlay {...baseProps} onManualEntry={onManualEntryFail} />);
    fireEvent.click(screen.getByText(/Enter token or search/));
    const input2 = screen.getByLabelText<HTMLInputElement>("Enter token or search by name");
    fireEvent.change(input2, { target: { value: "no-match" } });
    fireEvent.click(screen.getByText("Submit"));

    // Panel stays open for the operator to try again, but the field is empty.
    await waitFor(() => expect(onManualEntryFail).toHaveBeenCalled());
    expect(screen.getByLabelText("Enter token or search by name")).toBeTruthy();
    expect(input2.value).toBe("");
  });
});
