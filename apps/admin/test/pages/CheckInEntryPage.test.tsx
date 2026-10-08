// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { CheckInEntryPage } from "../../src/pages/CheckInEntryPage.js";
import {
  LOAD_TIMEOUT_MESSAGE,
  LOAD_TIMEOUT_MS,
  SLOW_NOTICE_MS,
  SLOW_NOTICE_TEXT,
} from "../../src/utils/loading-timing.js";

const { reportApiError } = vi.hoisted(() => ({ reportApiError: vi.fn() }));
vi.mock("../../src/connection/ConnectionStateProvider.js", () => {
  const connectionState = { reportApiError };
  return { useConnectionState: () => connectionState };
});

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return { ...actual, fetchCheckInEvents: vi.fn() };
});

import { ApiError, fetchCheckInEvents } from "../../src/api/client.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

function renderAt(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/operator" element={<CheckInEntryPage />} />
        <Route path="/operator/events/:eventId/checkin" element={<p>checkin-target</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CheckInEntryPage", () => {
  it("renders touch-sized event cards with attendee counts when multiple events are available", async () => {
    vi.mocked(fetchCheckInEvents).mockResolvedValue([
      {
        id: "evt-1",
        title: "Spring Summit",
        slug: "spring-summit",
        date: "2026-05-01",
        timezone: "Europe/Warsaw",
        location: "Warsaw",
        organization_id: "org-1",
        archived_at: null,
        attendee_count: 42,
      },
      {
        id: "evt-2",
        title: "Autumn Forum",
        slug: "autumn-forum",
        date: "2026-10-01",
        timezone: "Europe/Warsaw",
        location: null,
        organization_id: "org-1",
        archived_at: null,
      },
    ]);

    renderAt("/operator");

    await waitFor(() => {
      expect(screen.getByText("Spring Summit")).toBeTruthy();
    });
    expect(screen.getByText("Autumn Forum")).toBeTruthy();
    expect(document.querySelector(".event-grid--cols-2")).toBeTruthy();
    expect(document.querySelector(".event-card--touch")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    // Only this page renders counts, so it is the one caller that opts into the extra query.
    expect(fetchCheckInEvents).toHaveBeenCalledWith(expect.objectContaining({ includeAttendeeCount: true }));
  });

  it("uses the two-column grid when at least four events are available, same as the admin picker", async () => {
    vi.mocked(fetchCheckInEvents).mockResolvedValue(
      Array.from({ length: 4 }, (_, index) => ({
        id: `evt-${index + 1}`,
        title: `Event ${index + 1}`,
        slug: `event-${index + 1}`,
        date: "2026-01-01",
        timezone: "Europe/Warsaw",
        location: null,
        organization_id: "org-1",
        archived_at: null,
      })),
    );

    renderAt("/operator");

    await screen.findByText("Event 4");
    expect(document.querySelector(".event-grid")?.className).toContain("event-grid--cols-2");
    expect(document.querySelector(".event-grid")?.className).not.toContain("event-grid--cols-3");
  });

  it("auto-redirects straight to check-in when exactly one event is available", async () => {
    vi.mocked(fetchCheckInEvents).mockResolvedValue([
      {
        id: "evt-solo",
        title: "Solo Event",
        slug: "solo-event",
        date: "2026-05-01",
        timezone: "Europe/Warsaw",
        location: null,
        organization_id: "org-1",
        archived_at: null,
      },
    ]);

    renderAt("/operator");

    await waitFor(() => {
      expect(screen.getByText("checkin-target")).toBeTruthy();
    });
    expect(screen.queryByText("Solo Event")).toBeNull();
  });

  it("shows an empty state when no events have check-in access", async () => {
    vi.mocked(fetchCheckInEvents).mockResolvedValue([]);

    renderAt("/operator");

    await waitFor(() => {
      expect(
        screen.getByText("No events with check-in access were found for your account."),
      ).toBeTruthy();
    });
  });

  it("shows a load error and reports it when the request fails as an ApiError", async () => {
    vi.mocked(fetchCheckInEvents).mockRejectedValue(new ApiError(500, "secret_internal"));

    renderAt("/operator");

    await waitFor(() => {
      expect(screen.getByText("Could not load check-in events.")).toBeTruthy();
    });
    expect(reportApiError).toHaveBeenCalledWith(500);
    expect(screen.queryByText("secret_internal")).toBeNull();
  });

  it("shows the same load error when the request fails outside the API layer", async () => {
    vi.mocked(fetchCheckInEvents).mockRejectedValue(new Error("network down"));

    renderAt("/operator");

    await waitFor(() => {
      expect(screen.getByText("Could not load check-in events.")).toBeTruthy();
    });
    expect(reportApiError).not.toHaveBeenCalled();
    expect(screen.queryByText("network down")).toBeNull();
  });

  it("retries the load when Retry is clicked after a load error", async () => {
    vi.mocked(fetchCheckInEvents).mockRejectedValueOnce(new ApiError(500, "secret_internal"));

    renderAt("/operator");

    await waitFor(() => {
      expect(screen.getByText("Could not load check-in events.")).toBeTruthy();
    });

    vi.mocked(fetchCheckInEvents).mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(fetchCheckInEvents).toHaveBeenCalledTimes(2);
    });
    // The error stays, with its busy Retry, until the answer is in.
    await waitFor(() => expect(screen.queryByText("Could not load check-in events.")).toBeNull());
  });
});

const soloEvent = {
  id: "evt-solo",
  title: "Solo Event",
  slug: "solo-event",
  date: "2026-05-01",
  timezone: "Europe/Warsaw",
  location: null,
  organization_id: "org-1",
  archived_at: null,
};

describe("CheckInEntryPage loading", () => {
  const EMPTY_NOTICE = "No events with check-in access were found for your account.";
  const loader = () => document.querySelector(".at-loader") as HTMLElement | null;

  /** A request that never answers but, like fetch, rejects when its signal is aborted. */
  function stalledUntilAborted() {
    const signals: AbortSignal[] = [];
    vi.mocked(fetchCheckInEvents).mockImplementation(((opts?: { signal?: AbortSignal }) => {
      const signal = opts?.signal;
      if (signal) signals.push(signal);
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
      });
    }) as never);
    return signals;
  }

  it("never shows the empty notice, or the event list, on the way to the only event", async () => {
    vi.mocked(fetchCheckInEvents).mockResolvedValue([soloEvent]);
    const seen: string[] = [];
    const { container } = renderAt("/operator");
    // Every DOM change is checked, so a single frame of the wrong screen cannot slip between two assertions.
    const observer = new MutationObserver(() => seen.push(container.textContent ?? ""));
    observer.observe(container, { childList: true, subtree: true, characterData: true });

    await screen.findByText("checkin-target");
    observer.disconnect();
    expect(seen.some((text) => text.includes(EMPTY_NOTICE))).toBe(false);
    expect(seen.some((text) => text.includes("Choose an event"))).toBe(false);
  });

  it("holds the space for the loader at once, draws it after 200ms, and says so after 8 seconds", async () => {
    stalledUntilAborted();
    vi.useFakeTimers();
    renderAt("/operator");

    expect(loader()?.className).toContain("at-loading-hold");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(199);
    });
    expect(loader()?.className).toContain("at-loading-hold");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(loader()?.className).not.toContain("at-loading-hold");
    expect(loader()?.getAttribute("aria-label")).toBe("Loading check-in events");
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SLOW_NOTICE_MS - 200);
    });
    expect(screen.getByText(SLOW_NOTICE_TEXT)).toBeTruthy();
  });

  it("shows no loader at all when the events arrive before the 200ms are up, and fades each screen in", async () => {
    vi.mocked(fetchCheckInEvents).mockResolvedValue([]);
    const { unmount } = renderAt("/operator");
    await screen.findByText(EMPTY_NOTICE);
    expect(loader()).toBeNull();
    expect(screen.getByText(EMPTY_NOTICE).closest(".at-fade-in")).toBeTruthy();
    unmount();

    vi.mocked(fetchCheckInEvents).mockResolvedValue([
      { ...soloEvent, id: "evt-a", title: "Event A" },
      { ...soloEvent, id: "evt-b", title: "Event B" },
    ]);
    const second = renderAt("/operator");
    await screen.findByText("Event A");
    expect(screen.getByText("Event A").closest(".at-fade-in")).toBeTruthy();
    second.unmount();

    vi.mocked(fetchCheckInEvents).mockRejectedValue(new Error("network down"));
    renderAt("/operator");
    await screen.findByText("Could not load check-in events.");
    expect(screen.getByText("Could not load check-in events.").closest(".at-fade-in")).toBeTruthy();
  });

  it("keeps the loader for at least 400ms once it has been drawn, then shows the events", async () => {
    let answer!: (events: unknown[]) => void;
    vi.mocked(fetchCheckInEvents).mockReturnValue(new Promise((resolve) => (answer = resolve)) as never);
    vi.useFakeTimers();
    renderAt("/operator");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(loader()?.className).not.toContain("at-loading-hold");

    // The answer arrives 50ms after the loader was drawn: it stays until 400ms have passed.
    await act(async () => {
      answer([]);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(loader()).not.toBeNull();
    expect(screen.queryByText(EMPTY_NOTICE)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(349);
    });
    expect(loader()).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(loader()).toBeNull();
    expect(screen.getByText(EMPTY_NOTICE)).toBeTruthy();
  });

  it("gives up after 30 seconds, says why, and Retry asks again with a fresh 30 seconds", async () => {
    const signals = stalledUntilAborted();
    vi.useFakeTimers();
    renderAt("/operator");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1);
    });
    expect(screen.queryByText(/Could not load check-in events/)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText(LOAD_TIMEOUT_MESSAGE)).toBeTruthy();
    // A stalled server is not an API error answer: it is not reported as one.
    expect(reportApiError).not.toHaveBeenCalled();
    expect(loader()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(signals).toHaveLength(2);
    expect(signals[1]?.aborted).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1);
    });
    expect(signals[1]?.aborted).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText(LOAD_TIMEOUT_MESSAGE)).toBeTruthy();
  });

  it("keeps the error with a busy Retry, and its focus, while a retry runs, with no loader and no empty notice, then hands the focus to the region", async () => {
    vi.mocked(fetchCheckInEvents).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderAt("/operator");
    const retry = await screen.findByRole("button", { name: "Retry" });
    // A failure that shows with its Retry is not busy: only a click makes it so.
    expect(retry.getAttribute("aria-busy")).toBeNull();

    let answer: (events: unknown[]) => void = () => {};
    vi.mocked(fetchCheckInEvents).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)) as never);
    retry.focus();
    fireEvent.click(retry);

    // The same button, busy, with the focus. Neither the loader nor the empty notice takes the error's place.
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(document.activeElement).toBe(retry);
    expect(screen.getByText("Could not load check-in events.")).toBeTruthy();
    expect(loader()).toBeNull();
    expect(screen.queryByText(EMPTY_NOTICE)).toBeNull();

    await act(async () => answer([{ ...soloEvent, id: "evt-a" }, { ...soloEvent, id: "evt-b", title: "Second Event" }]));
    await screen.findByText("Second Event");
    expect(screen.queryByText("Could not load check-in events.")).toBeNull();
    // The Retry that held the focus is gone: the focus goes to the region that stays, not to the top of the page.
    const region = document.querySelector(".checkin-entry-body");
    expect(region?.getAttribute("aria-label")).toBe("Check-in events");
    await waitFor(() => expect(document.activeElement).toBe(region));
  });

  it("keeps the same Retry, and says the error again, when a retry fails again", async () => {
    vi.mocked(fetchCheckInEvents).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderAt("/operator");
    const retry = await screen.findByRole("button", { name: "Retry" });
    const messageBefore = screen.getByText("Could not load check-in events.");

    let fail: (error: Error) => void = () => {};
    vi.mocked(fetchCheckInEvents).mockReturnValueOnce(new Promise((_resolve, reject) => (fail = reject)) as never);
    retry.focus();
    fireEvent.click(retry);
    expect(retry.getAttribute("aria-busy")).toBe("true");

    await act(async () => fail(new TypeError("still down")));
    await waitFor(() => expect(retry.getAttribute("aria-busy")).toBeNull(), { timeout: 3000 });

    // The same text again: the message is a new node (a live region announces additions), the button is not.
    expect(screen.getByText("Could not load check-in events.")).not.toBe(messageBefore);
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(document.activeElement).toBe(retry);
  });

  it("ignores a late answer after the page was left: the only event does not pull the operator back to check-in", async () => {
    let answer: (events: unknown[]) => void = () => {};
    vi.mocked(fetchCheckInEvents).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)) as never);
    render(
      <MemoryRouter initialEntries={["/operator"]}>
        <Routes>
          <Route path="/operator" element={<><CheckInEntryPage /><Link to="/elsewhere">Go elsewhere</Link></>} />
          <Route path="/elsewhere" element={<p>elsewhere</p>} />
          <Route path="/operator/events/:eventId/checkin" element={<p>checkin-target</p>} />
        </Routes>
      </MemoryRouter>,
    );

    // The operator leaves before the events are in; the request ignores the abort and answers later, with one event.
    fireEvent.click(screen.getByRole("link", { name: "Go elsewhere" }));
    expect(screen.getByText("elsewhere")).toBeTruthy();
    await act(async () => answer([soloEvent]));

    expect(screen.getByText("elsewhere")).toBeTruthy();
    expect(screen.queryByText("checkin-target")).toBeNull();
  });

  it("abandons the request when the page goes away, and leaves no timeout behind", async () => {
    const signals = stalledUntilAborted();
    vi.useFakeTimers();
    const { unmount } = renderAt("/operator");
    expect(signals[0]?.aborted).toBe(false);
    unmount();
    expect(signals[0]?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

