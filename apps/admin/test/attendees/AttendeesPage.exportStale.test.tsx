// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { deferred } from "../test-utils.js";
import { exportAttendees, fetchEventAttendees, makeRow, renderPage } from "./attendeesPageSetup.js";

const exportButton = () => screen.getByRole("button", { name: "Export" }) as HTMLButtonElement;

describe("AttendeesPage Export while the list is changing", () => {
  it("closes an Export menu opened before the first answer when that answer is an empty list, and starts no export from it", async () => {
    const first = deferred<{ items: never[]; total: number; page: number; pageSize: number }>();
    fetchEventAttendees.mockReturnValueOnce(first.promise);
    renderPage();
    const button = await screen.findByRole("button", { name: "Export" });
    fireEvent.click(button);
    const item = screen.getByRole("menuitem", { name: /^XLSX/ });

    first.resolve({ items: [], total: 0, page: 1, pageSize: 25 });
    await waitFor(() => expect(exportButton().disabled).toBe(true));
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(item);
    expect(exportAttendees).not.toHaveBeenCalled();
  });

  it("keeps Export on after a search that found nobody is cleared, while the full list is on its way", async () => {
    fetchEventAttendees.mockResolvedValueOnce({ items: [makeRow("a1", "Ada")], total: 1, page: 1, pageSize: 25 });
    renderPage();
    await screen.findByText("Ada");

    fetchEventAttendees.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 25 });
    const search = screen.getByLabelText("Search attendees by name, email, or company");
    fireEvent.change(search, { target: { value: "zzz" } });
    await waitFor(() => expect(exportButton().disabled).toBe(true));

    const full = deferred<{ items: ReturnType<typeof makeRow>[]; total: number; page: number; pageSize: number }>();
    fetchEventAttendees.mockReturnValueOnce(full.promise);
    fireEvent.change(search, { target: { value: "" } });
    await waitFor(() => expect(exportButton().disabled).toBe(false));

    full.resolve({ items: [makeRow("a1", "Ada")], total: 1, page: 1, pageSize: 25 });
    await screen.findByText("Ada");
    expect(exportButton().disabled).toBe(false);
  });
});
