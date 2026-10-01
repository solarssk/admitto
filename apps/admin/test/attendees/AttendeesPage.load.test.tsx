// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useParams } from "react-router";
import { AttendeesPage } from "../../src/pages/AttendeesPage.js";
import { mockMatchMedia, renderWithToast } from "../test-utils.js";
import { exportAttendees, fetchEventAttendees, fetchEventCustomFields, makeRow, reportApiError } from "./attendeesPageSetup.js";

function AttendeeRouteProbe() {
  const { attendeeId } = useParams();
  return <div>attendee page {attendeeId}</div>;
}

function renderPage() {
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/attendees"]}>
      <Routes>
        <Route path="/admin/events/:eventId/attendees" element={<AttendeesPage />} />
        <Route path="/admin/events/:eventId/attendees/import" element={<div>import page</div>} />
        <Route path="/admin/events/:eventId/attendees/:attendeeId" element={<AttendeeRouteProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AttendeesPage load errors", () => {
  it("shows persistent empty state instead of an empty roster on load failure", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventAttendees.mockRejectedValueOnce(new ApiError(403, "Forbidden"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Could not load attendees")).toBeTruthy();
    });
    expect(screen.getByText("You do not have access to this event.")).toBeTruthy();
    // A failed load is announced at once, not politely like an empty list.
    expect(screen.getByText("Could not load attendees").closest("[role='alert']")).not.toBeNull();
    expect(screen.queryByText(/No attendees yet/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("shows a safe generic error when the attendee request is not an API response", async () => {
    fetchEventAttendees.mockRejectedValueOnce(new TypeError("network unavailable"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Could not load attendees")).toBeTruthy();
      expect(screen.getByText("Could not load attendees.")).toBeTruthy();
    });
    expect(reportApiError).not.toHaveBeenCalled();
  });

  it("shows the generic load error for an API failure that isn't a 401 or 403", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventAttendees.mockRejectedValueOnce(new ApiError(500, "secret_internal"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Could not load attendees")).toBeTruthy();
      expect(screen.getByText("Could not load attendees.")).toBeTruthy();
    });
    expect(reportApiError).toHaveBeenCalledWith(500);
  });

  it("redirects to login instead of displaying an inline error after a 401 list response", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    const assignSpy = vi.fn();
    const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/admin/events/evt-1/attendees", assign: assignSpy },
    });
    try {
      fetchEventAttendees.mockRejectedValueOnce(new ApiError(401, "unauthorized"));

      renderPage();

      await waitFor(() => {
        expect(assignSpy).toHaveBeenCalledWith("/login?next=%2Fadmin%2Fevents%2Fevt-1%2Fattendees");
        expect(reportApiError).toHaveBeenCalledWith(401);
      });
      expect(screen.queryByText("Could not load attendees")).toBeNull();
    } finally {
      if (locationDescriptor) Object.defineProperty(window, "location", locationDescriptor);
    }
  });

  /** The one visually hidden alert that is always mounted, which is all that can speak while Filters is closed. */
  function announcer(): HTMLElement {
    const found = screen.getAllByRole("alert").find((el) => el.classList.contains("sr-only"));
    if (!found) throw new Error("no announcer");
    return found;
  }

  it("announces a failed ticket-type catalog at page entry, before Filters is ever opened, and the list still shows (CodeRabbit review)", async () => {
    const { fetchTicketTypes } = await import("../../src/api/client.js");
    fetchEventAttendees.mockResolvedValue({ items: [makeRow("a1", "Ada")], total: 1, page: 1, pageSize: 25 });
    vi.mocked(fetchTicketTypes).mockRejectedValueOnce(new Error("network down"));

    renderPage();

    await screen.findByText("Ada");
    await waitFor(() => expect(announcer().textContent).toBe("Could not load types."));
    // The failure is not a page-level error: the list is there, and nothing else is an alert.
    expect(screen.queryByText("Could not load attendees")).toBeNull();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("announces a failed custom-field catalog and a failed item catalog at page entry too, in one message", async () => {
    const { fetchEventItems } = await import("../../src/api/client.js");
    fetchEventAttendees.mockResolvedValue({ items: [makeRow("a1", "Ada")], total: 1, page: 1, pageSize: 25 });
    fetchEventCustomFields.mockRejectedValueOnce(new Error("network down"));
    vi.mocked(fetchEventItems).mockRejectedValueOnce(new Error("network down"));

    renderPage();

    await screen.findByText("Ada");
    await waitFor(() => expect(announcer().textContent).toBe("Could not load custom fields. Could not load items."));
  });

  it("says nothing while every catalog loads, and keeps one empty alert mounted for a failure to be added to", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [makeRow("a1", "Ada")], total: 1, page: 1, pageSize: 25 });

    renderPage();

    await screen.findByText("Ada");
    expect(announcer().textContent).toBe("");
  });

  it("shows the failure with its Retry inside the Filters panel, without blocking the attendee list (CodeRabbit review)", async () => {
    const { fetchTicketTypes } = await import("../../src/api/client.js");
    fetchEventAttendees.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
    });
    vi.mocked(fetchTicketTypes).mockRejectedValueOnce(new Error("network down"));

    renderPage();

    // The hint sits inside the Filters dropdown panel (PO review) - open it to see it.
    fireEvent.click(await screen.findByRole("button", { name: "Filters" }));
    const panel = screen.getByRole("group", { name: "Filters" });
    await within(panel).findByText("Could not load types.");
    // The list itself isn't replaced by an error - only the Type filter is affected.
    expect(screen.queryByText("Could not load attendees")).toBeNull();

    vi.mocked(fetchTicketTypes).mockResolvedValueOnce([
      { id: "tt-1", key: "vip", label: "VIP", color: "purple", sort_order: 0, attendee_count: 0, created_at: "2026-01-01T00:00:00.000Z" },
    ]);
    fireEvent.click(within(panel).getByRole("button", { name: "Retry" }));

    // Both the hint and the announcer go once the catalog is in.
    await waitFor(() => expect(screen.queryByText("Could not load types.")).toBeNull());
  });

  it("keeps the hint and a busy Retry on screen, focus included, while a retry runs, and announces again when it fails again", async () => {
    const { fetchTicketTypes } = await import("../../src/api/client.js");
    fetchEventAttendees.mockResolvedValue({ items: [makeRow("a1", "Ada")], total: 1, page: 1, pageSize: 25 });
    vi.mocked(fetchTicketTypes).mockRejectedValueOnce(new Error("network down"));

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Filters" }));
    const panel = screen.getByRole("group", { name: "Filters" });
    await within(panel).findByText("Could not load types.");
    const retry = within(panel).getByRole("button", { name: "Retry" });
    // A failure that shows with its Retry is not busy: only a click makes it so.
    expect(retry.getAttribute("aria-busy")).toBeNull();
    const hintBefore = within(panel).getByText("Could not load types.");
    const announcerBefore = announcer();

    let failRetry: (error: Error) => void = () => {};
    vi.mocked(fetchTicketTypes).mockImplementationOnce(
      () => new Promise((_, reject) => {
        failRetry = reject;
      }),
    );
    retry.focus();
    fireEvent.click(retry);

    // Still there, the same button, busy, with focus: nothing was unmounted around it.
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(within(panel).getByText("Could not load types.")).toBe(hintBefore);
    expect(within(panel).getByRole("button", { name: "Retry" })).toBe(retry);
    expect(document.activeElement).toBe(retry);

    await act(async () => failRetry(new Error("still down")));
    await waitFor(() => expect(retry.getAttribute("aria-busy")).toBeNull(), { timeout: 3000 });

    // Same text again: the message and the announcer are new nodes (a live region announces additions), the button is not.
    expect(within(panel).getByText("Could not load types.")).not.toBe(hintBefore);
    expect(announcer()).not.toBe(announcerBefore);
    expect(announcer().textContent).toBe("Could not load types.");
    expect(within(panel).getByRole("button", { name: "Retry" })).toBe(retry);
    expect(document.activeElement).toBe(retry);
  });

  it("clears the custom-field failure, hint and announcer both, once a retry has the catalog", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [makeRow("a1", "Ada")], total: 1, page: 1, pageSize: 25 });
    fetchEventCustomFields.mockRejectedValueOnce(new Error("network down"));

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Filters" }));
    const panel = screen.getByRole("group", { name: "Filters" });
    await within(panel).findByText("Could not load custom fields.");

    fetchEventCustomFields.mockResolvedValueOnce([]);
    fireEvent.click(within(panel).getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.queryByText("Could not load custom fields.")).toBeNull());
    expect(announcer().textContent).toBe("");
  });

  it("does the same for a failed custom-field catalog: hint and busy Retry stay while it retries, a repeat failure is announced again", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [makeRow("a1", "Ada")], total: 1, page: 1, pageSize: 25 });
    fetchEventCustomFields.mockRejectedValueOnce(new Error("network down"));

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Filters" }));
    const panel = screen.getByRole("group", { name: "Filters" });
    const hintBefore = await within(panel).findByText("Could not load custom fields.");
    const retry = within(panel).getByRole("button", { name: "Retry" });
    expect(retry.getAttribute("aria-busy")).toBeNull();
    const announcerBefore = announcer();

    let failRetry: (error: Error) => void = () => {};
    fetchEventCustomFields.mockImplementationOnce(
      () => new Promise((_, reject) => {
        failRetry = reject;
      }),
    );
    retry.focus();
    fireEvent.click(retry);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(within(panel).getByText("Could not load custom fields.")).toBe(hintBefore);
    expect(document.activeElement).toBe(retry);

    await act(async () => failRetry(new Error("still down")));
    await waitFor(() => expect(retry.getAttribute("aria-busy")).toBeNull(), { timeout: 3000 });
    expect(within(panel).getByText("Could not load custom fields.")).not.toBe(hintBefore);
    expect(announcer()).not.toBe(announcerBefore);
    expect(within(panel).getByRole("button", { name: "Retry" })).toBe(retry);
  });
});

describe("AttendeesPage header actions on mobile (PO review — header must never change height)", () => {
  it("shortens '+ Add attendee' to '+ Add' below 768px, so all header buttons fit one line", async () => {
    mockMatchMedia(false);
    fetchEventAttendees.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 });

    renderPage();
    await screen.findByText(/No attendees yet/i);

    expect(screen.queryByRole("button", { name: "+ Add attendee" })).toBeNull();
    expect(screen.getByRole("button", { name: "+ Add" })).toBeTruthy();
    // Import, Send tickets, and Export all moved into the "More" menu (#615) — only "+ Add"
    // and "More" remain as standalone buttons, few enough to sit beside the "Attendees" title
    // instead of wrapping onto their own row underneath it. Menu items always show their full
    // label, since a menu item isn't width-constrained the way a header button is.
    expect(screen.getByRole("button", { name: "More" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Export" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("menuitem", { name: /^Import/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^Send tickets/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^Export XLSX/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^Export CSV/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^Export PDF/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: /^Import/ }));
    expect(screen.getByText("import page")).toBeTruthy();
  });

  it("exports from the mobile More menu and closes it before starting the download", async () => {
    mockMatchMedia(false);
    fetchEventAttendees.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 });
    exportAttendees.mockResolvedValue(undefined);

    renderPage();
    await screen.findByText(/No attendees yet/i);

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Export CSV/ }));

    await waitFor(() => expect(exportAttendees).toHaveBeenCalledTimes(1));
    expect(exportAttendees.mock.calls[0]![2]).toBe("csv");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps the full header button labels at desktop widths, with Export as its own standalone button", async () => {
    fetchEventAttendees.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 });

    renderPage();
    await screen.findByText(/No attendees yet/i);

    expect(screen.getByRole("button", { name: "+ Add attendee" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: /^Send tickets/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /^Export/ })).toBeNull();
  });
});

describe("AttendeesPage row navigation", () => {
  it("opens the attendee's own page when a row is clicked", async () => {
    fetchEventAttendees.mockResolvedValue({
      items: [makeRow("att-1", "Jane Doe"), makeRow("att-2", "John Smith")],
      total: 2,
      page: 1,
      pageSize: 25,
    });

    renderPage();
    await screen.findByText("Jane Doe");

    fireEvent.click(screen.getByText("John Smith"));

    expect(await screen.findByText("attendee page att-2")).toBeTruthy();
  });
});
