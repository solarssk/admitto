// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fetchEventAttendees, makeRow, renderPage } from "./attendeesPageSetup.js";

type Page = { items: ReturnType<typeof makeRow>[]; total: number; page: number; pageSize: number };

describe("AttendeesPage pager keeps keyboard focus", () => {
  // `disabled` would make a browser drop the focus of the button that was just pressed, once while the next
  // page loads and once more when it becomes the last-page button, so both buttons are `aria-disabled` and
  // Button swallows their click.
  it("keeps focus on Next while the next page loads, and ignores a second press", async () => {
    fetchEventAttendees.mockResolvedValueOnce({
      items: [makeRow("att-1", "Jane Doe")],
      total: 75,
      page: 1,
      pageSize: 25,
    } satisfies Page);
    let resolveSecondPage!: (value: Page) => void;
    fetchEventAttendees.mockReturnValueOnce(
      new Promise<Page>((resolve) => {
        resolveSecondPage = resolve;
      }),
    );
    renderPage();
    await screen.findByText("Jane Doe");
    const next = screen.getByRole("button", { name: "Next" }) as HTMLButtonElement;
    next.focus();
    expect(next.hasAttribute("aria-disabled")).toBe(false);

    fireEvent.click(next);
    await waitFor(() => expect(fetchEventAttendees).toHaveBeenCalledTimes(2));

    // Still loading: the same button, still focused, off but not `disabled`, and a second press does nothing.
    expect(screen.getByRole("button", { name: "Next" })).toBe(next);
    expect(document.activeElement).toBe(next);
    expect(next.getAttribute("aria-disabled")).toBe("true");
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    expect(fetchEventAttendees).toHaveBeenCalledTimes(2);

    resolveSecondPage({ items: [makeRow("att-2", "John Smith")], total: 75, page: 2, pageSize: 25 });
    await screen.findByText("John Smith");
    await waitFor(() => expect(next.hasAttribute("aria-disabled")).toBe(false));
    expect(document.activeElement).toBe(next);
  });

  it("keeps focus on Next when it becomes the last-page button, and does nothing when it is pressed", async () => {
    fetchEventAttendees.mockResolvedValueOnce({
      items: [makeRow("att-1", "Jane Doe")],
      total: 50,
      page: 1,
      pageSize: 25,
    } satisfies Page);
    fetchEventAttendees.mockResolvedValueOnce({
      items: [makeRow("att-2", "John Smith")],
      total: 50,
      page: 2,
      pageSize: 25,
    } satisfies Page);
    renderPage();
    await screen.findByText("Jane Doe");
    const next = screen.getByRole("button", { name: "Next" }) as HTMLButtonElement;
    next.focus();

    fireEvent.click(next);
    await screen.findByText("John Smith");
    await waitFor(() => expect(screen.getByText("Page 2 of 2")).toBeTruthy());

    expect(screen.getByRole("button", { name: "Next" })).toBe(next);
    expect(document.activeElement).toBe(next);
    expect(next.getAttribute("aria-disabled")).toBe("true");
    expect(next.disabled).toBe(false);
    const calls = fetchEventAttendees.mock.calls.length;
    fireEvent.click(next);
    expect(fetchEventAttendees).toHaveBeenCalledTimes(calls);

    // Previous is the live one now.
    const previous = screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement;
    expect(previous.hasAttribute("aria-disabled")).toBe(false);
  });
});
