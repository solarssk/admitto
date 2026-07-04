// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, MemoryRouter, RouterProvider, Route, Routes } from "react-router-dom";
import { EventLayout } from "../../src/App.js";
import type { EventDto } from "../../src/api/types.js";

const fetchAdminEvents = vi.fn();

vi.mock("../../src/api/client.js", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  fetchAdminEvents: (...args: unknown[]) => fetchAdminEvents(...args),
}));

vi.mock("../../src/layouts/AdminShell.js", () => ({
  AdminShell: ({ event }: { event: EventDto }) => <div>shell:{event.title}</div>,
}));

function eventDto(id: string, title: string, archivedAt: string | null = null): EventDto {
  return {
    id,
    title,
    slug: id,
    date: "2026-09-01",
    timezone: "UTC",
    location: "Hall A",
    archived_at: archivedAt,
  } as EventDto;
}

function renderLayout(initialEntry: { pathname: string; state?: unknown }) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/admin" element={<div>picker</div>} />
        <Route path="/admin/events/:eventId/*" element={<EventLayout />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("EventLayout (#274)", () => {
  it("renders the shell immediately from navigation state without re-fetching the events list", async () => {
    renderLayout({
      pathname: "/admin/events/evt-1/overview",
      state: { event: eventDto("evt-1", "Spring Gala") },
    });

    // Immediately — no fetch round-trip, no bare-spinner flash in between.
    expect(screen.getByText("shell:Spring Gala")).toBeTruthy();
    expect(document.querySelector(".shell-loading")).toBeNull();
    expect(fetchAdminEvents).not.toHaveBeenCalled();
  });

  it("falls back to fetching the event on a deep link with no navigation state", async () => {
    fetchAdminEvents.mockResolvedValueOnce([eventDto("evt-1", "Spring Gala")]);

    renderLayout({ pathname: "/admin/events/evt-1/overview" });

    // Pre-resolution: the loading state, not the shell.
    expect(document.querySelector(".shell-loading")).toBeTruthy();

    await waitFor(() => expect(screen.getByText("shell:Spring Gala")).toBeTruthy());
    expect(fetchAdminEvents).toHaveBeenCalledTimes(1);
    expect(fetchAdminEvents).toHaveBeenCalledWith({ includeArchived: true });
  });

  it("ignores navigation state for a different event and fetches instead", async () => {
    fetchAdminEvents.mockResolvedValueOnce([eventDto("evt-2", "Autumn Summit")]);

    renderLayout({
      pathname: "/admin/events/evt-2/overview",
      state: { event: eventDto("evt-1", "Spring Gala") },
    });

    await waitFor(() => expect(screen.getByText("shell:Autumn Summit")).toBeTruthy());
    expect(fetchAdminEvents).toHaveBeenCalledTimes(1);
  });

  it("still redirects to the picker when the event is not found", async () => {
    fetchAdminEvents.mockResolvedValueOnce([eventDto("evt-1", "Spring Gala")]);

    renderLayout({ pathname: "/admin/events/evt-unknown/overview" });

    await waitFor(() => expect(screen.getByText("picker")).toBeTruthy());
  });

  it("still resolves archived events through the fallback fetch", async () => {
    fetchAdminEvents.mockResolvedValueOnce([
      eventDto("evt-old", "Past Conference", "2026-01-15T10:00:00.000Z"),
    ]);

    renderLayout({ pathname: "/admin/events/evt-old/overview" });

    await waitFor(() => expect(screen.getByText("shell:Past Conference")).toBeTruthy());
  });

  it("clears the one-shot navigation state after first use, so a later back/forward revisit re-validates via the fallback fetch (Codex review)", async () => {
    fetchAdminEvents.mockResolvedValueOnce([eventDto("evt-1", "Spring Gala")]);

    const router = createMemoryRouter(
      [
        { path: "/admin", element: <div>picker</div> },
        { path: "/admin/events/:eventId/*", element: <EventLayout /> },
      ],
      {
        initialEntries: [
          { pathname: "/admin" },
          { pathname: "/admin/events/evt-1/overview", state: { event: eventDto("evt-1", "Spring Gala") } },
        ],
        initialIndex: 1,
      },
    );
    render(<RouterProvider router={router} />);

    // Initial visit: fast path, no fetch — same as the plain fast-path test.
    expect(screen.getByText("shell:Spring Gala")).toBeTruthy();
    expect(fetchAdminEvents).not.toHaveBeenCalled();

    // Navigate back to the picker, then forward again to the same history
    // entry — simulating an admin whose org assignment was revoked in
    // between returning (via browser back/forward) to a page already
    // visited in this tab. If the stale event snapshot were trusted again,
    // access would never be re-validated for this navigation.
    await act(async () => router.navigate(-1));
    await waitFor(() => expect(screen.getByText("picker")).toBeTruthy());

    await act(async () => router.navigate(1));

    await waitFor(() => expect(fetchAdminEvents).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("shell:Spring Gala")).toBeTruthy());
  });
});
