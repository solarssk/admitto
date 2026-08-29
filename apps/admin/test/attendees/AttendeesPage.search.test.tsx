// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fetchEventAttendees, makeRow, renderPage } from "./attendeesPageSetup.js";

describe("AttendeesPage search debounce", () => {
  it("debounces the search box before refetching with the trimmed term", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 });

    renderPage();
    await screen.findByText(/No attendees yet/i);

    fireEvent.change(screen.getByLabelText("Search attendees by name, email, or company"), {
      target: { value: "jane" },
    });

    // Past DEBOUNCE_MS (300ms).
    await new Promise((r) => setTimeout(r, 400));

    await waitFor(() => {
      expect(fetchEventAttendees).toHaveBeenLastCalledWith(
        "evt-1",
        expect.objectContaining({ q: "jane" }),
        expect.anything(),
      );
    });
  });

  it("does not reset to page 1 when the debounce timer fires with an unchanged search value while paginated", async () => {
    fetchEventAttendees.mockResolvedValue({
      items: [makeRow("att-1", "Jane Doe")],
      // > pageSize (25) so a second (and third) page exist to navigate to.
      total: 60,
      page: 1,
      pageSize: 25,
    });

    // Fake timers under full manual control (no shouldAdvanceTime) so the mount-scheduled
    // debounce timer cannot fire until explicitly advanced below. With a real (or
    // auto-advancing) clock, a slow/contended test worker could let this test's own initial
    // `waitFor`/`findByText` eat past DEBOUNCE_MS, so the timer fires while page is still 1
    // (harmless) and *before* the Next click below - the pre-fix code would then pass this
    // test too, a false negative (bot review finding on #675).
    vi.useFakeTimers();
    try {
      renderPage();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText("Jane Doe")).toBeTruthy();
      expect(fetchEventAttendees).toHaveBeenCalledTimes(1);

      // Paginate away from page 1 - still before the mount-scheduled debounce timer has been
      // allowed to fire, since the search box was never touched (starts and stays empty).
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchEventAttendees).toHaveBeenCalledTimes(2);
      expect(fetchEventAttendees).toHaveBeenLastCalledWith(
        "evt-1",
        expect.objectContaining({ page: 2 }),
        expect.anything(),
      );
      expect(screen.getByText("Page 2 of 3")).toBeTruthy();

      // Only now let the mount-scheduled timer (DEBOUNCE_MS = 300) actually fire,
      // deterministically after pagination - this is what exercises the regression. The
      // buggy version calls setPage(1) unconditionally here (the debounced value never
      // actually changed), triggering an unplanned 3rd fetch for page 1 and silently
      // snapping the operator back to it.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });

      expect(fetchEventAttendees).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Page 2 of 3")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
