// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fetchEventAttendees, makeRow, renderPage } from "./attendeesPageSetup.js";

describe("AttendeesPage sortable columns", () => {
  it("clicking a column header sorts ascending, resets to page 1, and clicking again flips to descending", async () => {
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

    // Move off page 1 first, so we can prove sorting resets it.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(fetchEventAttendees).toHaveBeenLastCalledWith(
        "evt-1",
        expect.objectContaining({ page: 2 }),
        expect.anything(),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /Ticket/ }));
    await waitFor(() => {
      expect(fetchEventAttendees).toHaveBeenLastCalledWith(
        "evt-1",
        expect.objectContaining({ page: 1, sortBy: "ticket_type", sortDir: "asc" }),
        expect.anything(),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /Ticket/ }));
    await waitFor(() => {
      expect(fetchEventAttendees).toHaveBeenLastCalledWith(
        "evt-1",
        expect.objectContaining({ page: 1, sortBy: "ticket_type", sortDir: "desc" }),
        expect.anything(),
      );
    });

    // Switching to a different column starts fresh at ascending, not carrying over "desc".
    fireEvent.click(screen.getByRole("button", { name: /Company/ }));
    await waitFor(() => {
      expect(fetchEventAttendees).toHaveBeenLastCalledWith(
        "evt-1",
        expect.objectContaining({ page: 1, sortBy: "company", sortDir: "asc" }),
        expect.anything(),
      );
    });
  });
});
