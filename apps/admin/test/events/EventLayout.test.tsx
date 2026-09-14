// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterProvider } from "react-router/dom";
import { createMemoryRouter, MemoryRouter, Route, Routes } from "react-router";
import { EventLayout, preloadLazyRoute } from "../../src/App.js";
import type { EventDto } from "../../src/api/types.js";

const fetchAdminEvent = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  fetchAdminEvent: (...args: unknown[]) => fetchAdminEvent(...args),
}));

vi.mock("../../src/layouts/AdminShell.js", () => ({
  AdminShell: ({
    event,
    refreshEvent,
  }: {
    event: EventDto;
    refreshEvent?: () => Promise<void>;
  }) => (
    <div>
      <div>shell:{event.title}</div>
      <div data-testid="shell-archived-at">{event.archived_at ?? "active"}</div>
      {refreshEvent && (
        <button type="button" onClick={() => void refreshEvent()}>
          refresh
        </button>
      )}
    </div>
  ),
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
  it("absorbs a speculative route preload failure", async () => {
    await expect(preloadLazyRoute(() => Promise.reject(new Error("chunk unavailable")))).resolves.toBeUndefined();
  });

  it("renders the shell immediately from navigation state without fetching the event again", async () => {
    renderLayout({
      pathname: "/admin/events/evt-1/overview",
      state: { event: eventDto("evt-1", "Spring Gala") },
    });

    // Immediately — no fetch round-trip, no bare-spinner flash in between.
    expect(screen.getByText("shell:Spring Gala")).toBeTruthy();
    expect(document.querySelector(".shell-loading")).toBeNull();
    expect(fetchAdminEvent).not.toHaveBeenCalled();
  });

  it("falls back to fetching the event on a deep link with no navigation state", async () => {
    fetchAdminEvent.mockResolvedValueOnce(eventDto("evt-1", "Spring Gala"));

    renderLayout({ pathname: "/admin/events/evt-1/overview" });

    // Pre-resolution: the loading state, not the shell.
    expect(document.querySelector(".shell-loading")).toBeTruthy();

    await screen.findByText("shell:Spring Gala");
    expect(fetchAdminEvent).toHaveBeenCalledTimes(1);
    expect(fetchAdminEvent).toHaveBeenCalledWith("evt-1");
  });

  it.each([
    "/admin/events/evt-1/settings",
    "/admin/events/evt-1/attendees/import",
    "/admin/events/evt-1/attendees/att-1",
  ])("preloads the exact nested destination while resolving %s", async (pathname) => {
    fetchAdminEvent.mockResolvedValueOnce(eventDto("evt-1", "Spring Gala"));

    renderLayout({ pathname });

    expect(await screen.findByText("shell:Spring Gala")).toBeTruthy();
    expect(fetchAdminEvent).toHaveBeenCalledWith("evt-1");
  });

  it("ignores navigation state for a different event and fetches instead", async () => {
    fetchAdminEvent.mockResolvedValueOnce(eventDto("evt-2", "Autumn Summit"));

    renderLayout({
      pathname: "/admin/events/evt-2/overview",
      state: { event: eventDto("evt-1", "Spring Gala") },
    });

    await screen.findByText("shell:Autumn Summit");
    expect(fetchAdminEvent).toHaveBeenCalledTimes(1);
  });

  it("still redirects to the picker when the event is not found", async () => {
    fetchAdminEvent.mockRejectedValueOnce(new Error("event_not_found"));

    renderLayout({ pathname: "/admin/events/evt-unknown/overview" });

    expect(await screen.findByText("picker")).toBeTruthy();
  });

  it("still resolves archived events through the fallback fetch", async () => {
    fetchAdminEvent.mockResolvedValueOnce(eventDto("evt-old", "Past Conference", "2026-01-15T10:00:00.000Z"));

    renderLayout({ pathname: "/admin/events/evt-old/overview" });

    expect(await screen.findByText("shell:Past Conference")).toBeTruthy();
  });

  it("clears the one-shot navigation state after first use, so a later back/forward revisit re-validates via the fallback fetch (Codex review)", async () => {
    fetchAdminEvent.mockResolvedValueOnce(eventDto("evt-1", "Spring Gala"));

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
    expect(fetchAdminEvent).not.toHaveBeenCalled();

    // Navigate back to the picker, then forward again to the same history
    // entry — simulating an admin whose org assignment was revoked in
    // between returning (via browser back/forward) to a page already
    // visited in this tab. If the stale event snapshot were trusted again,
    // access would never be re-validated for this navigation.
    await act(async () => router.navigate(-1));
    await screen.findByText("picker");

    await act(async () => router.navigate(1));

    await waitFor(() => expect(fetchAdminEvent).toHaveBeenCalledTimes(1));
    await screen.findByText("shell:Spring Gala");
  });

  it("refreshEvent re-fetches and updates the shared event snapshot in place", async () => {
    renderLayout({
      pathname: "/admin/events/evt-1/overview",
      state: { event: eventDto("evt-1", "Spring Gala") },
    });
    expect(screen.getByTestId("shell-archived-at").textContent).toBe("active");

    fetchAdminEvent.mockResolvedValueOnce(eventDto("evt-1", "Spring Gala", "2026-02-01T00:00:00.000Z"));
    screen.getByRole("button", { name: "refresh" }).click();

    await waitFor(() => {
      expect(screen.getByTestId("shell-archived-at").textContent).toBe(
        "2026-02-01T00:00:00.000Z",
      );
    });
    expect(fetchAdminEvent).toHaveBeenCalledWith("evt-1");
  });

  it("refreshEvent silently keeps the last-known snapshot when the background re-fetch fails", async () => {
    renderLayout({
      pathname: "/admin/events/evt-1/overview",
      state: { event: eventDto("evt-1", "Spring Gala") },
    });

    fetchAdminEvent.mockRejectedValueOnce(new Error("network down"));
    screen.getByRole("button", { name: "refresh" }).click();

    await waitFor(() => expect(fetchAdminEvent).toHaveBeenCalledTimes(1));
    expect(screen.getByText("shell:Spring Gala")).toBeTruthy();
    expect(screen.getByTestId("shell-archived-at").textContent).toBe("active");
  });
});
