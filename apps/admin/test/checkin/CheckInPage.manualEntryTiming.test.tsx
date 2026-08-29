// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { ToastProvider } from "@admitto/ui";
import { CheckInPage } from "../../src/pages/CheckInPage.js";
import { mockCheckInBootstrap } from "./checkInApiMock.js";
import { lookupCheckInAttendees, submitCheckInScan } from "./checkInScanApiSetup.js";

vi.mock("../../src/checkin/CameraScanner.js", () => ({
  CameraScanner: () => <div data-testid="camera-scanner" />,
}));

vi.mock("../../src/hooks/useIsDesktop.js", () => ({
  useIsDesktop: () => false,
  isDesktopViewport: () => false,
}));

/** Lets a test control exactly when a mocked request resolves. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={["/admin/events/evt-live/checkin"]}>
        <Routes>
          <Route path="/admin/events/:eventId/checkin" element={<CheckInPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("mobile manual-entry overlay — closes only once the real outcome is known (bot review, round 7)", () => {
  it("keeps a multiple-match message inside the mobile overlay", async () => {
    mockCheckInBootstrap();
    lookupCheckInAttendees.mockResolvedValueOnce([
      {
        id: "att-1",
        name: "Anna Alpha",
        ticket_type: "vip",
        company: null,
        department: null,
        check_in_status: "not_admitted",
      },
      {
        id: "att-2",
        name: "Anna Beta",
        ticket_type: "vip",
        company: null,
        department: null,
        check_in_status: "not_admitted",
      },
    ]);

    renderPage();
    await screen.findByRole("button", { name: /manual search/i });
    fireEvent.click(screen.getByRole("button", { name: /manual search/i }));
    const input = await screen.findByLabelText("Search by name or email");
    fireEvent.change(input, { target: { value: "Anna" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(document.querySelector("#ck-overlay-manual-error")?.textContent).toBe(
        "Multiple matches. Narrow your search.",
      ),
    );
    expect(screen.getByLabelText("Search by name or email")).toBeTruthy();
  });

  it("keeps the manual-search screen open while a long entry's scan attempt is still in flight", async () => {
    // Regression: submitOrLookup (wired as CameraOverlay's onManualEntry)
    // used to fire the scan (`void runScan(...)`) and resolve `true`
    // immediately, before the request even started — so the manual-search
    // screen closed on a still-pending request, and any error or no-match
    // from a lookup fallback landed behind an already-hidden screen.
    mockCheckInBootstrap();
    const scan = deferred<{ status: "INVALID"; confirmed: false }>();
    submitCheckInScan.mockReturnValueOnce(scan.promise);

    renderPage();
    await screen.findByRole("button", { name: /manual search/i });
    fireEvent.click(screen.getByRole("button", { name: /manual search/i }));

    const input = await screen.findByLabelText("Search by name or email");
    const value = "TEST-FIXTURE-TOKEN-NOT-REAL-SECRET-000002";
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(submitCheckInScan).toHaveBeenCalled());
    // The scan request is still pending — the manual-search field must
    // still be on screen, not already dismissed back to the scanner.
    expect(screen.getByLabelText("Search by name or email")).toBeTruthy();

    // Resolve the scan as no-match; the fallback lookup finds nothing either.
    lookupCheckInAttendees.mockResolvedValueOnce([]);
    await act(async () => {
      scan.resolve({ status: "INVALID", confirmed: false });
    });

    await waitFor(() => expect(lookupCheckInAttendees).toHaveBeenCalledWith("evt-live", value));
  });
});
