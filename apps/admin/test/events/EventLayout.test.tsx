// @vitest-environment jsdom
import { StrictMode, useEffect } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterProvider } from "react-router/dom";
import { createMemoryRouter, MemoryRouter, Route, Routes } from "react-router";
import { EventLayout, preloadLazyRoute } from "../../src/App.js";
import { ApiError } from "../../src/api/client.js";
import type { EventDto } from "../../src/api/types.js";
import { LOAD_TIMEOUT_MESSAGE, LOAD_TIMEOUT_MS, SLOW_NOTICE_MS, SLOW_NOTICE_TEXT } from "../../src/utils/loading-timing.js";
import { advanceTimers, deferred, hangUntilAborted } from "../test-utils.js";

const fetchAdminEvent = vi.fn();
// When set, the mocked shell asks for a refresh from a mount effect, like AttendeesPage does to
// pick up the active_attendee_count that the event picker's snapshot omits.
let refreshOnMount = false;

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
  }) => {
    useEffect(() => {
      if (refreshOnMount) void refreshEvent?.();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only, mirrors the page it stands in for
    }, []);
    return (
      <div>
        <div>shell:{event.title}</div>
        <div data-testid="shell-archived-at">{event.archived_at ?? "active"}</div>
        {refreshEvent && (
          <button type="button" onClick={() => void refreshEvent()}>
            refresh
          </button>
        )}
      </div>
    );
  },
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

const loader = () => document.querySelector(".at-loader") as HTMLElement | null;

/** The signal the nth read of the event was given (the fallback read, not the refresh, which has none). */
const signalOf = (call: number) => fetchAdminEvent.mock.calls[call]?.[1] as AbortSignal | undefined;

/** The same layout under a router that the test can move to another event. */
function renderRouted(pathname: string) {
  const router = createMemoryRouter(
    [
      { path: "/admin", element: <div>picker</div> },
      { path: "/admin/events/:eventId/*", element: <EventLayout /> },
    ],
    { initialEntries: [{ pathname }] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
  refreshOnMount = false;
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
    // ...and it says what it is waiting for, so the logo on its own is not left to be guessed at.
    expect(screen.getByRole("status", { name: "Loading event" })).toBeTruthy();
    expect(screen.getByText("Loading event…")).toBeTruthy();

    await screen.findByText("shell:Spring Gala");
    expect(fetchAdminEvent).toHaveBeenCalledTimes(1);
    // The read has the 30 second limit's signal.
    expect(fetchAdminEvent).toHaveBeenCalledWith("evt-1", expect.any(AbortSignal));
  });

  it.each([
    "/admin/events/evt-1/settings",
    "/admin/events/evt-1/attendees/import",
    "/admin/events/evt-1/attendees/att-1",
  ])("preloads the exact nested destination while resolving %s", async (pathname) => {
    fetchAdminEvent.mockResolvedValueOnce(eventDto("evt-1", "Spring Gala"));

    renderLayout({ pathname });

    expect(await screen.findByText("shell:Spring Gala")).toBeTruthy();
    expect(fetchAdminEvent).toHaveBeenCalledWith("evt-1", expect.any(AbortSignal));
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

  it.each([404, 403])("still redirects to the picker when the event is not there for the viewer (%i)", async (status) => {
    fetchAdminEvent.mockRejectedValueOnce(new ApiError(status, "event_not_found"));

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

  it("ignores a stale refreshEvent response that resolves after a newer one (race)", async () => {
    renderLayout({
      pathname: "/admin/events/evt-1/overview",
      state: { event: eventDto("evt-1", "Spring Gala") },
    });

    let resolveFirst!: (event: EventDto) => void;
    let resolveSecond!: (event: EventDto) => void;
    fetchAdminEvent
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSecond = resolve)));

    const refreshButton = screen.getByRole("button", { name: "refresh" });
    refreshButton.click(); // issues the first, older refresh
    refreshButton.click(); // issues a second, newer refresh before the first has settled

    // The newer call settles first...
    resolveSecond(eventDto("evt-1", "Spring Gala", "2026-03-01T00:00:00.000Z"));
    await waitFor(() =>
      expect(screen.getByTestId("shell-archived-at").textContent).toBe("2026-03-01T00:00:00.000Z"),
    );

    // ...and the older call's response, arriving late, must not overwrite it.
    await act(async () => {
      resolveFirst(eventDto("evt-1", "Spring Gala", "2026-01-01T00:00:00.000Z"));
    });
    expect(screen.getByTestId("shell-archived-at").textContent).toBe("2026-03-01T00:00:00.000Z");
  });

  it("applies a refreshEvent that a child page starts from its own mount effect (event opened from the picker)", async () => {
    refreshOnMount = true;
    fetchAdminEvent.mockResolvedValueOnce(eventDto("evt-1", "Spring Gala", "2026-02-01T00:00:00.000Z"));

    renderLayout({
      pathname: "/admin/events/evt-1/attendees",
      state: { event: eventDto("evt-1", "Spring Gala") },
    });

    await waitFor(() => {
      expect(screen.getByTestId("shell-archived-at").textContent).toBe("2026-02-01T00:00:00.000Z");
    });
    expect(fetchAdminEvent).toHaveBeenCalledTimes(1);
  });

  it("drops a refreshEvent response that lands after navigating to another event", async () => {
    const router = createMemoryRouter(
      [
        { path: "/admin", element: <div>picker</div> },
        { path: "/admin/events/:eventId/*", element: <EventLayout /> },
      ],
      {
        initialEntries: [
          { pathname: "/admin/events/evt-1/overview", state: { event: eventDto("evt-1", "Spring Gala") } },
        ],
      },
    );
    render(<RouterProvider router={router} />);

    let resolveStale!: (event: EventDto) => void;
    fetchAdminEvent.mockImplementationOnce(() => new Promise((resolve) => (resolveStale = resolve)));
    screen.getByRole("button", { name: "refresh" }).click(); // refresh bound to evt-1, still pending

    await act(async () => {
      await router.navigate("/admin/events/evt-2/overview", {
        state: { event: eventDto("evt-2", "Autumn Summit") },
      });
    });
    await screen.findByText("shell:Autumn Summit");

    // evt-1's response arrives late: it must not replace evt-2 under evt-2's URL.
    await act(async () => {
      resolveStale(eventDto("evt-1", "Spring Gala", "2026-02-01T00:00:00.000Z"));
    });
    expect(screen.getByText("shell:Autumn Summit")).toBeTruthy();
    expect(screen.queryByText("shell:Spring Gala")).toBeNull();
    expect(screen.getByTestId("shell-archived-at").textContent).toBe("active");
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

describe("EventLayout: the read of the event and its limits", () => {
  it("draws its loader at once, says it is taking longer than usual after 8 seconds, and gives up at 30 with an error and a Retry", async () => {
    vi.useFakeTimers();
    fetchAdminEvent.mockImplementationOnce(hangUntilAborted as never);
    renderLayout({ pathname: "/admin/events/evt-1/overview" });
    await advanceTimers(0);

    // A whole-screen wait: the mark is there from the first frame, with the line that says what it waits for.
    expect(screen.getByRole("status", { name: "Loading event" })).toBeTruthy();
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();

    await advanceTimers(SLOW_NOTICE_MS - 1);
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
    await advanceTimers(1);
    expect(screen.getByText(SLOW_NOTICE_TEXT)).toBeTruthy();

    // At 30 seconds the read is given up: the wait is over, so the loader and its note go and the error takes their place.
    await advanceTimers(LOAD_TIMEOUT_MS - SLOW_NOTICE_MS - 1);
    expect(screen.queryByText("Could not load event")).toBeNull();
    await advanceTimers(1);
    expect(signalOf(0)?.aborted).toBe(true);
    expect(screen.getByText("Could not load event")).toBeTruthy();
    expect(screen.getByText(`Could not load event. ${LOAD_TIMEOUT_MESSAGE}`)).toBeTruthy();
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
    expect(loader()).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    // The error that replaces the loader fades in, on the page's own centring box.
    const fade = document.querySelector(".shell-loading.at-fade-in");
    expect(fade?.querySelector(".event-load-error")?.contains(screen.getByRole("button", { name: "Retry" }))).toBe(true);
  });

  it("gives up on a read that ignores its signal too", async () => {
    vi.useFakeTimers();
    fetchAdminEvent.mockImplementationOnce(() => new Promise(() => {}));
    renderLayout({ pathname: "/admin/events/evt-1/overview" });
    await advanceTimers(LOAD_TIMEOUT_MS - 1);
    expect(screen.queryByText("Could not load event")).toBeNull();

    await advanceTimers(1);
    expect(screen.getByText(`Could not load event. ${LOAD_TIMEOUT_MESSAGE}`)).toBeTruthy();
  });

  it("counts the 8 seconds again for another event that replaces one still on its way", async () => {
    vi.useFakeTimers();
    fetchAdminEvent.mockImplementation(hangUntilAborted as never);
    const router = renderRouted("/admin/events/evt-1/overview");
    await advanceTimers(SLOW_NOTICE_MS - 1000);

    await act(async () => {
      await router.navigate("/admin/events/evt-2/overview");
    });
    expect(fetchAdminEvent).toHaveBeenCalledTimes(2);
    expect(signalOf(0)?.aborted).toBe(true);
    expect(signalOf(1)?.aborted).toBe(false);

    // 8 seconds since the first read began, 1 second since the second: no note yet.
    await advanceTimers(1000);
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
    await advanceTimers(SLOW_NOTICE_MS - 1000 - 1);
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
    await advanceTimers(1);
    expect(screen.getByText(SLOW_NOTICE_TEXT)).toBeTruthy();
  });

  it("hands the browser to the login page for a 401, with no error and no picker flashing up first", async () => {
    fetchAdminEvent.mockRejectedValueOnce(new ApiError(401, "authentication_required"));
    const assignSpy = vi.fn();
    const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", { configurable: true, value: { pathname: "/admin/events/evt-1/overview", assign: assignSpy } });
    try {
      renderLayout({ pathname: "/admin/events/evt-1/overview" });
      await waitFor(() => expect(assignSpy).toHaveBeenCalledWith("/login?next=%2Fadmin%2Fevents%2Fevt-1%2Foverview"));
      // The page is on its way out: it keeps its loader, says nothing, and does not go to the picker.
      expect(screen.getByRole("status", { name: "Loading event" })).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByText("picker")).toBeNull();
    } finally {
      if (locationDescriptor) Object.defineProperty(window, "location", locationDescriptor);
    }
  });

  it.each([
    ["a network failure", () => new TypeError("network down")],
    ["a server error", () => new ApiError(500, "secret_internal")],
  ])("shows an error with a Retry and the way back to the picker for %s, and does not go to the picker by itself", async (_name, failure) => {
    fetchAdminEvent.mockRejectedValueOnce(failure());
    renderLayout({ pathname: "/admin/events/evt-1/overview" });

    expect(await screen.findByText("Could not load event")).toBeTruthy();
    // What the server said stays out of the page.
    expect(screen.getByText("Could not load event.")).toBeTruthy();
    expect(screen.queryByText(/secret_internal/)).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to events" })).toBeTruthy();
    expect(screen.queryByText("picker")).toBeNull();
    expect(loader()).toBeNull();
  });

  it("leads back to the picker from the error", async () => {
    fetchAdminEvent.mockRejectedValueOnce(new TypeError("network down"));
    renderLayout({ pathname: "/admin/events/evt-1/overview" });

    fireEvent.click(await screen.findByRole("button", { name: "Back to events" }));

    expect(await screen.findByText("picker")).toBeTruthy();
  });

  it("cancels the read, and leaves no timer behind, when the page is left", async () => {
    vi.useFakeTimers();
    fetchAdminEvent.mockImplementationOnce(hangUntilAborted as never);
    const { unmount } = renderLayout({ pathname: "/admin/events/evt-1/overview" });
    await advanceTimers(0);
    expect(signalOf(0)?.aborted).toBe(false);

    unmount();
    await advanceTimers(0);
    expect(signalOf(0)?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the time limit once the event has answered", async () => {
    vi.useFakeTimers();
    fetchAdminEvent.mockResolvedValueOnce(eventDto("evt-1", "Spring Gala"));
    renderLayout({ pathname: "/admin/events/evt-1/overview" });
    await advanceTimers(0);

    expect(screen.getByText("shell:Spring Gala")).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
    await advanceTimers(LOAD_TIMEOUT_MS);
    expect(screen.getByText("shell:Spring Gala")).toBeTruthy();
  });

  it("drops the answer of the event it was reading when the route has moved to another one", async () => {
    const stale = deferred<EventDto>();
    fetchAdminEvent.mockReturnValueOnce(stale.promise);
    const router = renderRouted("/admin/events/evt-1/overview");
    fetchAdminEvent.mockResolvedValueOnce(eventDto("evt-2", "Autumn Summit"));
    await act(async () => {
      await router.navigate("/admin/events/evt-2/overview");
    });
    await screen.findByText("shell:Autumn Summit");

    await act(async () => stale.resolve(eventDto("evt-1", "Spring Gala")));
    expect(screen.getByText("shell:Autumn Summit")).toBeTruthy();
    expect(screen.queryByText("shell:Spring Gala")).toBeNull();
  });

  it("keeps waiting, with its loader, when React runs the effects twice and the first read is cancelled", async () => {
    // StrictMode mounts, unmounts and mounts again: the first read is the page being left, and says nothing and ends nothing.
    const first = deferred<EventDto>();
    const second = deferred<EventDto>();
    fetchAdminEvent.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/admin/events/evt-1/overview"]}>
          <Routes>
            <Route path="/admin" element={<div>picker</div>} />
            <Route path="/admin/events/:eventId/*" element={<EventLayout />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );
    await act(async () => {});
    expect(fetchAdminEvent).toHaveBeenCalledTimes(2);
    expect(signalOf(0)?.aborted).toBe(true);
    expect(signalOf(1)?.aborted).toBe(false);

    // The cancelled read fails late: it neither shows an error nor sends the viewer to the picker.
    await act(async () => first.reject(new ApiError(404, "event_not_found")));
    expect(screen.queryByText("picker")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status", { name: "Loading event" })).toBeTruthy();

    await act(async () => second.resolve(eventDto("evt-1", "Spring Gala")));
    expect(screen.getByText("shell:Spring Gala")).toBeTruthy();
    expect(screen.queryByText("Could not load event")).toBeNull();
  });
});

describe("EventLayout: the Retry of a failed read", () => {
  it("keeps the error with a busy Retry, and its focus, while a retry runs, with no loader in its place, then shows the event", async () => {
    fetchAdminEvent.mockRejectedValueOnce(new TypeError("network down"));
    renderLayout({ pathname: "/admin/events/evt-1/overview" });
    const retry = await screen.findByRole("button", { name: "Retry" });
    // A failure that shows with its Retry is not busy: only a click makes it so.
    expect(retry.getAttribute("aria-busy")).toBeNull();
    const fade = retry.closest(".at-fade-in");
    expect(fade).not.toBeNull();

    const answer = deferred<EventDto>();
    fetchAdminEvent.mockReturnValueOnce(answer.promise);
    retry.focus();
    fireEvent.click(retry);

    // The same button, busy, with the focus, in the same faded-in wrapper (so the fade does not play again). The loader does not
    // take the error's place.
    expect(retry.closest(".at-fade-in")).toBe(fade);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(document.activeElement).toBe(retry);
    expect(screen.getByText("Could not load event")).toBeTruthy();
    expect(loader()).toBeNull();
    // The way back stays too, and is not the busy control.
    expect(screen.getByRole("button", { name: "Back to events" })).toBeTruthy();

    await act(async () => answer.resolve(eventDto("evt-1", "Spring Gala")));
    expect(await screen.findByText("shell:Spring Gala")).toBeTruthy();
    expect(screen.queryByText("Could not load event")).toBeNull();
    expect(fetchAdminEvent).toHaveBeenCalledTimes(2);
    // A retry is a read like the first: it has the limit's signal.
    expect(signalOf(1)).toBeInstanceOf(AbortSignal);
  });

  it("keeps the same Retry, and says the error again, when a retry fails again", async () => {
    fetchAdminEvent.mockRejectedValueOnce(new TypeError("network down"));
    renderLayout({ pathname: "/admin/events/evt-1/overview" });
    const retry = await screen.findByRole("button", { name: "Retry" });
    const messageBefore = screen.getByText("Could not load event.");

    const failure = deferred<EventDto>();
    fetchAdminEvent.mockReturnValueOnce(failure.promise);
    retry.focus();
    fireEvent.click(retry);
    expect(retry.getAttribute("aria-busy")).toBe("true");

    await act(async () => failure.reject(new TypeError("still down")));
    await waitFor(() => expect(retry.getAttribute("aria-busy")).toBeNull(), { timeout: 3000 });

    // The same text again: the message is a new node (a live region announces additions), the button is not.
    expect(screen.getByText("Could not load event.")).not.toBe(messageBefore);
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(document.activeElement).toBe(retry);
    expect(fetchAdminEvent).toHaveBeenCalledTimes(2);
  });

  it("gives a retry the 30 second limit too, and is back to the error, ready for another", async () => {
    vi.useFakeTimers();
    fetchAdminEvent.mockRejectedValueOnce(new TypeError("network down"));
    renderLayout({ pathname: "/admin/events/evt-1/overview" });
    await advanceTimers(0);
    const retry = screen.getByRole("button", { name: "Retry" });

    fetchAdminEvent.mockImplementationOnce(hangUntilAborted as never);
    fireEvent.click(retry);
    await advanceTimers(LOAD_TIMEOUT_MS - 1);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByText(`Could not load event. ${LOAD_TIMEOUT_MESSAGE}`)).toBeNull();

    await advanceTimers(1);
    expect(signalOf(1)?.aborted).toBe(true);
    // The Retry has been busy for far longer than its 400ms minimum, so it is ready again on the next tick.
    await advanceTimers(0);
    expect(retry.getAttribute("aria-busy")).toBeNull();
    expect(screen.getByText(`Could not load event. ${LOAD_TIMEOUT_MESSAGE}`)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(loader()).toBeNull();
  });

  it("goes to the picker when a retry finds that the event is not there", async () => {
    fetchAdminEvent.mockRejectedValueOnce(new TypeError("network down"));
    renderLayout({ pathname: "/admin/events/evt-1/overview" });
    const retry = await screen.findByRole("button", { name: "Retry" });

    fetchAdminEvent.mockRejectedValueOnce(new ApiError(404, "event_not_found"));
    fireEvent.click(retry);

    expect(await screen.findByText("picker")).toBeTruthy();
  });

  it("does not show an old error for the next event after the route has moved on", async () => {
    fetchAdminEvent.mockRejectedValueOnce(new TypeError("network down"));
    const router = renderRouted("/admin/events/evt-1/overview");
    await screen.findByText("Could not load event");

    const next = deferred<EventDto>();
    fetchAdminEvent.mockReturnValueOnce(next.promise);
    await act(async () => {
      await router.navigate("/admin/events/evt-2/overview");
    });

    // The other event is read from scratch: its loader, not the previous event's error.
    expect(screen.queryByText("Could not load event")).toBeNull();
    expect(screen.getByRole("status", { name: "Loading event" })).toBeTruthy();
    await act(async () => next.resolve(eventDto("evt-2", "Autumn Summit")));
    expect(screen.getByText("shell:Autumn Summit")).toBeTruthy();
  });
});
