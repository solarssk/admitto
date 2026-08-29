// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { exportAttendees, fetchEventAttendees, makeRow, renderPage } from "./attendeesPageSetup.js";

describe("AttendeesPage export menu (#354)", () => {
  it("opens the Export menu with 3 items; clicking one exports the matching format and closes the menu", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [makeRow("att-1", "Jane Doe")], total: 1, page: 1, pageSize: 25 });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^XLSX/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^CSV/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^PDF/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: /^CSV/ }));

    await waitFor(() => {
      expect(exportAttendees).toHaveBeenCalledTimes(1);
    });
    expect(exportAttendees.mock.calls[0]![2]).toBe("csv");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes the menu on outside click and on Escape", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [makeRow("att-1", "Jane Doe")], total: 1, page: 1, pageSize: 25 });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeTruthy();
    });

    const trigger = screen.getByRole("button", { name: "Export" });

    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("moves focus between menu items with ArrowDown/ArrowUp/Home/End (WAI-ARIA menu pattern)", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [makeRow("att-1", "Jane Doe")], total: 1, page: 1, pageSize: 25 });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining("XLSX"),
      expect.stringContaining("CSV"),
      expect.stringContaining("PDF"),
    ]);
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[2]);

    // Wraps back to the first item past the last one.
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);

    // Wraps to the last item going backward past the first one.
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[2]);

    fireEvent.keyDown(document, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(document, { key: "End" });
    expect(document.activeElement).toBe(items[2]);
  });
});
