// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fetchEventAttendees, makeRow, renderPage } from "./attendeesPageSetup.js";

describe("AttendeesPage page size (#353)", () => {
  it("changing 'Rows per page' refetches with the new pageSize and resets to page 1", async () => {
    fetchEventAttendees.mockResolvedValue({
      items: [makeRow("att-1", "Jane Doe"), makeRow("att-2", "John Smith")],
      total: 60,
      page: 1,
      pageSize: 25,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeTruthy();
    });

    // Move off page 1 first, so we can prove the page-size change resets it.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(fetchEventAttendees).toHaveBeenLastCalledWith(
        "evt-1",
        expect.objectContaining({ page: 2, pageSize: 25 }),
        expect.anything(),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /^Rows per page,/ }));
    fireEvent.click(screen.getByRole("button", { name: "50" }));

    await waitFor(() => {
      expect(fetchEventAttendees).toHaveBeenLastCalledWith(
        "evt-1",
        expect.objectContaining({ page: 1, pageSize: 50 }),
        expect.anything(),
      );
    });
  });
});
