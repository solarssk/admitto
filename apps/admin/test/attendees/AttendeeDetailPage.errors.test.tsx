// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@admitto/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { ApiError } from "../../src/api/client.js";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { LOAD_TIMEOUT_MESSAGE, LOAD_TIMEOUT_MS, SLOW_NOTICE_MS, SLOW_NOTICE_TEXT } from "../../src/utils/loading-timing.js";
import {
  advanceTimers,
  baseAttendeeDetailEvent,
  deferred,
  hangUntilAborted,
  makeSuperadminAssignment,
  mockMatchMedia,
  renderWithToast,
} from "../test-utils.js";

const loadAttendeeDetailData = vi.fn();
// The event the layout hands to the page: the base one unless a test sets another.
const outlet = vi.hoisted(() => ({ event: null as null | Record<string, unknown> }));

vi.mock("../../src/attendees/attendeeDetailForm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/attendees/attendeeDetailForm.js")>();
  return {
    ...actual,
    loadAttendeeDetailData: (...args: unknown[]) => loadAttendeeDetailData(...args),
  };
});

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: [makeSuperadminAssignment()] }),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useOutletContext: () => ({
      event: outlet.event ?? baseAttendeeDetailEvent,
    }),
  };
});

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    updateAttendee: vi.fn(),
    resendTicket: vi.fn(),
    fetchAttendeeDetail: vi.fn(),
    fetchTicketTypes: vi.fn().mockResolvedValue([]),
  };
});

import { fetchTicketTypes, updateAttendee } from "../../src/api/client.js";

const detail = {
  id: "att-1",
  name: "Anna",
  email: "anna@example.com",
  company: null,
  department: null,
  ticket_type: "vip",
  custom_data: {},
  status: "registered" as const,
  admitted_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  check_in_status: "not_admitted" as const,
  last_mail_status: null,
  rsvp_status: "confirmed" as const,
  rsvp_updated_at: null,
  rsvp_source: null,
  deliveries: [],
  action_log: [],
  event_items: [],
};

function renderPage(strict = false, search = "") {
  const page = (
    <MemoryRouter initialEntries={[`/admin/events/evt-1/attendees/att-1${search}`]}>
      <Routes>
        <Route path="/admin/events/:eventId/attendees/:attendeeId" element={<AttendeeDetailPage />} />
        <Route path="/admin/events/:eventId/attendees" element={<p>the attendee list</p>} />
      </Routes>
    </MemoryRouter>
  );
  // StrictMode only runs the effects of what it mounts twice when it is outermost: inside the toast provider it would do nothing.
  return strict
    ? render(
        <StrictMode>
          <ToastProvider>{page}</ToastProvider>
        </StrictMode>,
      )
    : renderWithToast(page);
}

beforeEach(() => {
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  outlet.event = null;
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("AttendeeDetailPage operator errors", () => {
  it("shows the loading skeleton once the fetch has genuinely taken a moment", () => {
    loadAttendeeDetailData.mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    renderPage();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(document.querySelector(".attendee-detail-skeleton")).toBeTruthy();
  });

  it("draws the status chips the page will have: no Wallet chip for an event that offers no wallet, so the strip does not change its rows when the record arrives", async () => {
    outlet.event = { ...baseAttendeeDetailEvent, wallet_enabled: false };
    let resolveLoad!: (value: unknown) => void;
    loadAttendeeDetailData.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );
    vi.useFakeTimers();
    renderPage();
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect([...document.querySelectorAll(".attendee-status-chip strong")].map((el) => el.textContent)).toEqual(["Pass", "Attendance", "Ticket delivery", "Check-in"]);

    await act(async () => {
      resolveLoad({ detail, attributeFields: [], itemsWarning: null });
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(document.querySelector(".attendee-detail-skeleton")).toBeNull();
    expect([...document.querySelectorAll(".attendee-status-chip strong")].map((el) => el.textContent)).toEqual(["Pass", "Attendance", "Ticket delivery", "Check-in"]);
  });

  it("draws the Wallet chip, and the page keeps it, for an event that offers Samsung Wallet alone", async () => {
    outlet.event = { ...baseAttendeeDetailEvent, wallet_enabled: true, wallet_apple_enabled: false, wallet_google_enabled: false, wallet_samsung_enabled: true };
    let resolveLoad!: (value: unknown) => void;
    loadAttendeeDetailData.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );
    vi.useFakeTimers();
    renderPage();
    act(() => {
      vi.advanceTimersByTime(250);
    });
    const chips = () => [...document.querySelectorAll(".attendee-status-chip strong")].map((el) => el.textContent);
    expect(chips()).toEqual(["Pass", "Attendance", "Ticket delivery", "Check-in", "Wallet"]);

    await act(async () => {
      resolveLoad({ detail, attributeFields: [], itemsWarning: null });
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(document.querySelector(".attendee-detail-skeleton")).toBeNull();
    expect(chips()).toEqual(["Pass", "Attendance", "Ticket delivery", "Check-in", "Wallet"]);
  });

  describe("the tab that the address asks for", () => {
    const openTabs = () => [...document.querySelectorAll(".at-tabs .at-tab--active")].map((el) => el.textContent);

    // The placeholder of a read that is on its way, shown (200ms passed), and what it says when the read answers.
    async function placeholderThenPage(search: string) {
      let resolveLoad!: (value: unknown) => void;
      loadAttendeeDetailData.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLoad = resolve;
          }),
      );
      vi.useFakeTimers();
      renderPage(false, search);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      const whileWaiting = { openTabs: openTabs(), skeleton: document.querySelector(".attendee-detail-skeleton"), hint: document.querySelector(".at-notes-hint")?.textContent };
      await act(async () => {
        resolveLoad({ detail, attributeFields: [], itemsWarning: null });
      });
      act(() => {
        vi.advanceTimersByTime(400);
      });
      return whileWaiting;
    }

    it("draws the Activity log's placeholder under an Activity log that is the open tab for ?tab=activity, and the page opens on that tab", async () => {
      const waiting = await placeholderThenPage("?tab=activity");
      expect(waiting.openTabs).toEqual(["Activity log"]);
      expect(waiting.skeleton?.querySelectorAll(".at-tl-item")).toHaveLength(3);
      expect(document.querySelector(".attendee-detail-skeleton")).toBeNull();
      expect(document.querySelector(".attendee-detail-grid")).toBeNull();
      expect(openTabs()).toEqual(["Activity log"]);
    });

    it("draws the Notes placeholder for ?tab=notes, with the hint that the page itself then says, word for word", async () => {
      const waiting = await placeholderThenPage("?tab=notes");
      expect(waiting.openTabs).toEqual(["Notes"]);
      expect(waiting.skeleton?.querySelector(".at-notes-form")).not.toBeNull();
      expect(document.querySelector(".attendee-detail-skeleton")).toBeNull();
      expect(openTabs()).toEqual(["Notes"]);
      // The placeholder says this copy of its own, so the page's text is what keeps the two from drifting apart.
      expect(waiting.hint).toBeTruthy();
      expect(document.querySelector(".at-notes-hint")?.textContent).toBe(waiting.hint);
    });

    it("draws the Overview placeholder for no tab in the address, and for one that the page does not have", async () => {
      for (const search of ["", "?tab=overview", "?tab=bogus"]) {
        const waiting = await placeholderThenPage(search);
        expect(waiting.openTabs, search).toEqual(["Overview"]);
        expect(waiting.skeleton?.classList.contains("attendee-detail-grid"), search).toBe(true);
        expect(openTabs(), search).toEqual(["Overview"]);
        cleanup();
        vi.useRealTimers();
      }
    });
  });

  it("draws the page's own frame while the record is on its way, and its Back leaves for the list instead of waiting", () => {
    loadAttendeeDetailData.mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    renderPage();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByRole("heading", { level: 1, name: "Attendee" })).toBeTruthy();
    // The five chips and the cards are there by their real names, as bars where the read fills them in.
    expect(document.querySelectorAll(".attendee-status-chip")).toHaveLength(5);
    expect(screen.getByText("Delivery history")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("the attendee list")).toBeTruthy();
    expect(document.querySelector(".attendee-detail-skeleton")).toBeNull();
  });

  it("draws the header's bars for the viewport it is on: Edit and More actions on a desktop, only More actions on a phone", () => {
    const bars = () => document.querySelectorAll(".attendee-detail-pageheader .at-pageheader__actions .at-skeleton").length;
    loadAttendeeDetailData.mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    renderPage();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(bars()).toBe(2);

    cleanup();
    mockMatchMedia(false);
    loadAttendeeDetailData.mockImplementationOnce(() => new Promise(() => {}));
    renderPage();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(bars()).toBe(1);
  });

  it("holds the skeleton's space invisibly for the first 200ms, then fades it in", () => {
    loadAttendeeDetailData.mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    renderPage();
    const page = () => document.querySelector(".attendee-detail-skeleton")?.closest(".attendee-detail-page");
    expect(page()?.className).toContain("at-loading-hold");
    expect(page()?.getAttribute("aria-busy")).toBe("true");

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(page()?.className).toContain("at-fade-in");
    expect(page()?.className).not.toContain("at-loading-hold");
  });

  it("fades the page in when it replaces the skeleton, as a new element", async () => {
    let resolveLoad!: (value: unknown) => void;
    loadAttendeeDetailData.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );
    vi.useFakeTimers();
    renderPage();
    act(() => {
      vi.advanceTimersByTime(250); // skeleton shown at 200ms
    });
    const skeletonRoot = document.querySelector(".attendee-detail-page") as HTMLElement;
    expect(skeletonRoot.getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      resolveLoad({ detail, attributeFields: [], itemsWarning: null });
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });

    const pageRoot = document.querySelector(".attendee-detail-page") as HTMLElement;
    expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy();
    expect(pageRoot.className).toContain("at-fade-in");
    // A new element, so the 150ms fade runs again instead of carrying on from the skeleton's.
    expect(pageRoot).not.toBe(skeletonRoot);
    expect(pageRoot.getAttribute("aria-busy")).toBeNull();
  });

  it("fades the not-found notice in too, when the attendee turns out not to exist after a skeleton", async () => {
    let rejectLoad!: (reason: unknown) => void;
    loadAttendeeDetailData.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectLoad = reject;
        }),
    );
    vi.useFakeTimers();
    renderPage();
    act(() => {
      vi.advanceTimersByTime(250);
    });
    await act(async () => {
      rejectLoad(new ApiError(404, "not_found"));
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByText("Attendee not found")).toBeTruthy();
    expect(document.querySelector(".attendee-detail-page")?.className).toContain("at-fade-in");
  });

  it("fades the error in too, when the load fails after a skeleton", async () => {
    let rejectLoad!: (reason: unknown) => void;
    loadAttendeeDetailData.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectLoad = reject;
        }),
    );
    vi.useFakeTimers();
    renderPage();
    act(() => {
      vi.advanceTimersByTime(250);
    });
    await act(async () => {
      rejectLoad(new ApiError(500, "secret_internal"));
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByText("Could not load attendee")).toBeTruthy();
    expect(document.querySelector(".attendee-detail-page")?.className).toContain("at-fade-in");
  });

  it("never shows the skeleton for a load that answers within 200ms", async () => {
    let resolveLoad!: (value: unknown) => void;
    loadAttendeeDetailData.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );
    vi.useFakeTimers();
    renderPage();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    await act(async () => {
      resolveLoad({ detail, attributeFields: [], itemsWarning: null });
    });
    expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy();
    expect(document.querySelector(".attendee-detail-skeleton")).toBeNull();
  });

  it("keeps a skeleton that did appear for at least 400ms before the attendee replaces it", async () => {
    let resolveLoad!: (value: unknown) => void;
    loadAttendeeDetailData.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );
    vi.useFakeTimers();
    renderPage();
    act(() => {
      vi.advanceTimersByTime(250); // the skeleton appeared at 200ms
    });
    await act(async () => {
      resolveLoad({ detail, attributeFields: [], itemsWarning: null });
    });
    act(() => {
      vi.advanceTimersByTime(349); // 599ms: 1ms short of its 400ms minimum
    });
    expect(document.querySelector(".attendee-detail-skeleton")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Anna" })).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(document.querySelector(".attendee-detail-skeleton")).toBeNull();
    expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy();
  });

  it("shows load failure, and retries the load on demand", async () => {
    loadAttendeeDetailData.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Could not load attendee")).toBeTruthy();
    });

    loadAttendeeDetailData.mockResolvedValueOnce({ detail, attributeFields: [], itemsWarning: null });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("heading", { name: "Anna" });
    expect(loadAttendeeDetailData).toHaveBeenCalledTimes(2);
  });

  it("shows an inline retryable error next to the Ticket type field when the catalog fails to load (CodeRabbit review)", async () => {
    loadAttendeeDetailData.mockResolvedValueOnce({ detail, attributeFields: [], itemsWarning: null });
    vi.mocked(fetchTicketTypes).mockRejectedValueOnce(new Error("network down"));
    renderPage();

    await screen.findByRole("heading", { name: "Anna" });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(await screen.findByText("Could not load ticket types.")).toBeTruthy();
    expect(screen.getByText("Could not load ticket types.").closest("[role='alert']")).not.toBeNull();

    vi.mocked(fetchTicketTypes).mockResolvedValueOnce([
      { id: "tt-1", key: "vip", label: "VIP", color: "purple", sort_order: 0, attendee_count: 1, created_at: "2026-01-01T00:00:00.000Z" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.queryByText("Could not load ticket types.")).toBeNull());
  });

  it("keeps the ticket-type notice and a busy Retry on screen, focus included, while a retry runs, and announces again when it fails again", async () => {
    loadAttendeeDetailData.mockResolvedValueOnce({ detail, attributeFields: [], itemsWarning: null });
    vi.mocked(fetchTicketTypes).mockRejectedValueOnce(new Error("network down"));
    renderPage();

    await screen.findByRole("heading", { name: "Anna" });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const message = await screen.findByText("Could not load ticket types.");
    const retry = screen.getByRole("button", { name: "Retry" });
    // A failure that shows with its Retry is not busy: only a click makes it so.
    expect(retry.getAttribute("aria-busy")).toBeNull();

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
    expect(screen.getByText("Could not load ticket types.")).toBe(message);
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(document.activeElement).toBe(retry);

    await act(async () => failRetry(new Error("still down")));
    await waitFor(() => expect(retry.getAttribute("aria-busy")).toBeNull(), { timeout: 3000 });

    // Same text again: a new message node is what a live region announces. The button is the same node.
    expect(screen.getByText("Could not load ticket types.")).not.toBe(message);
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(document.activeElement).toBe(retry);
  });

  it("shows the items-load-warning Notice when custom attribute fields fail to load", async () => {
    loadAttendeeDetailData.mockResolvedValueOnce({
      detail,
      attributeFields: [],
      itemsWarning: "Attribute fields could not be loaded. Core fields are still editable.",
    });
    renderPage();

    await screen.findByRole("heading", { name: "Anna" });
    const notice = await screen.findByText("Attribute fields could not be loaded. Core fields are still editable.");
    expect(notice.closest(".at-notice--warning")).toBeTruthy();
  });
});

describe("AttendeeDetailPage first read: the time rules and the Retry", () => {
  const status = () => screen.queryByText("Loading attendee")?.closest("output") ?? null;
  const signalOf = (call: number) => loadAttendeeDetailData.mock.calls[call]?.[3] as AbortSignal | undefined;

  it("says that it is taking longer than usual after 8 seconds, in the placeholder's own status region", async () => {
    loadAttendeeDetailData.mockImplementationOnce(hangUntilAborted as never);
    vi.useFakeTimers();
    renderPage();
    await advanceTimers(SLOW_NOTICE_MS - 1);
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
    // The region is always there (it is what names the wait for assistive tech), with no height of its own until the note.
    expect(status()).not.toBeNull();
    await advanceTimers(1);

    const note = screen.getByText(SLOW_NOTICE_TEXT);
    expect(note.closest("output")).toBe(status());
    expect(note.className).toContain("attendee-detail-slow-note");
  });

  it("gives up after 30 seconds with the time limit's own words and a Retry, and cancels the request", async () => {
    loadAttendeeDetailData.mockImplementationOnce(hangUntilAborted as never);
    vi.useFakeTimers();
    renderPage();
    await advanceTimers(LOAD_TIMEOUT_MS - 1);
    expect(signalOf(0)?.aborted).toBe(false);
    expect(screen.queryByText("Could not load attendee")).toBeNull();
    await advanceTimers(1);
    await advanceTimers(0);

    expect(signalOf(0)?.aborted).toBe(true);
    expect(screen.getByText("Could not load attendee")).toBeTruthy();
    expect(screen.getByText(`Could not load attendee. ${LOAD_TIMEOUT_MESSAGE}`)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    // The wait is over: the skeleton and its note are gone.
    expect(document.querySelector(".attendee-detail-skeleton")).toBeNull();
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
    expect(document.querySelector(".attendee-detail-page")?.className).toContain("at-fade-in");
  });

  it("leaves no timer behind that cancels a request which has already answered", async () => {
    loadAttendeeDetailData.mockResolvedValueOnce({ detail, attributeFields: [], itemsWarning: null });
    vi.useFakeTimers();
    renderPage();
    await advanceTimers(0);
    expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy();

    await advanceTimers(LOAD_TIMEOUT_MS);
    expect(signalOf(0)?.aborted).toBe(false);
  });

  it("stops waiting for a request that ignores its signal, when its time is up", async () => {
    // A read that never settles and is not given a way to be cancelled: the limit still ends the wait.
    loadAttendeeDetailData.mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    renderPage();
    await advanceTimers(LOAD_TIMEOUT_MS);
    await advanceTimers(0);
    expect(screen.getByText(`Could not load attendee. ${LOAD_TIMEOUT_MESSAGE}`)).toBeTruthy();
  });

  it("keeps the error with a busy Retry, whose focus it keeps, while a retry runs, with no skeleton or note, and says the failure again when it fails again", async () => {
    loadAttendeeDetailData.mockImplementationOnce(hangUntilAborted as never);
    vi.useFakeTimers();
    renderPage();
    await advanceTimers(LOAD_TIMEOUT_MS);
    await advanceTimers(0);
    const message = screen.getByText(`Could not load attendee. ${LOAD_TIMEOUT_MESSAGE}`);
    const retry = screen.getByRole("button", { name: "Retry" });
    // A failure that shows with its Retry is not busy: only a click makes it so.
    expect(retry.getAttribute("aria-busy")).toBeNull();
    const root = document.querySelector(".attendee-detail-page");

    loadAttendeeDetailData.mockImplementationOnce(hangUntilAborted as never);
    retry.focus();
    fireEvent.click(retry);
    await advanceTimers(0);

    // A Retry is not a first load: the same error, button and page, busy, with the focus. No skeleton takes their place.
    expect(document.querySelector(".attendee-detail-skeleton")).toBeNull();
    expect(document.querySelector(".attendee-detail-page")).toBe(root);
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(retry);
    expect(screen.getByText(`Could not load attendee. ${LOAD_TIMEOUT_MESSAGE}`)).toBe(message);
    expect(loadAttendeeDetailData).toHaveBeenCalledTimes(2);

    // Its own 30 seconds, and no "taking longer than usual": that is for a first load.
    await advanceTimers(SLOW_NOTICE_MS + 1000);
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
    await advanceTimers(LOAD_TIMEOUT_MS - SLOW_NOTICE_MS - 1000);
    await advanceTimers(0);
    expect(signalOf(1)?.aborted).toBe(true);
    expect(screen.getByText(`Could not load attendee. ${LOAD_TIMEOUT_MESSAGE}`)).not.toBe(message);
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(retry.getAttribute("aria-busy")).toBeNull();
    expect(document.activeElement).toBe(retry);
  });

  it("hands the focus to the page when the retry works, and shows the attendee in the same page element", async () => {
    loadAttendeeDetailData.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderPage();
    const retry = await screen.findByRole("button", { name: "Retry" });
    const root = screen.getByRole("region", { name: "Attendee" });

    const second = deferred<unknown>();
    loadAttendeeDetailData.mockReturnValueOnce(second.promise);
    retry.focus();
    fireEvent.click(retry);
    expect(retry.getAttribute("aria-busy")).toBe("true");

    await act(async () => second.resolve({ detail, attributeFields: [], itemsWarning: null }));
    await screen.findByRole("heading", { name: "Anna" });
    expect(screen.queryByText("Could not load attendee")).toBeNull();
    // The element stays (the error and the page share a key), so the 150ms fade does not play again, and it takes the focus.
    expect(screen.getByRole("region", { name: "Attendee" })).toBe(root);
    await waitFor(() => expect(document.activeElement).toBe(root));
  });

  it("turns a retry that finds the attendee gone into the not-found notice", async () => {
    loadAttendeeDetailData.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderPage();
    const retry = await screen.findByRole("button", { name: "Retry" });

    loadAttendeeDetailData.mockRejectedValueOnce(new ApiError(404, "not_found"));
    fireEvent.click(retry);
    expect(await screen.findByText("Attendee not found")).toBeTruthy();
    expect(screen.queryByText("Could not load attendee")).toBeNull();
  });

  it("stops the request, and says nothing, when the page is left", async () => {
    loadAttendeeDetailData.mockImplementationOnce(hangUntilAborted as never);
    vi.useFakeTimers();
    const { unmount } = renderPage();
    await advanceTimers(0);
    expect(signalOf(0)?.aborted).toBe(false);

    unmount();
    expect(signalOf(0)?.aborted).toBe(true);
    await advanceTimers(LOAD_TIMEOUT_MS);
    expect(screen.queryByText("Could not load attendee")).toBeNull();
    expect(screen.queryByText(/Could not load attendee/)).toBeNull();
  });

  it("keeps waiting, with its skeleton, when React runs the page's effects twice and the first request is cancelled", async () => {
    // StrictMode mounts, unmounts and mounts again: the first request is the page being left, and says nothing and ends nothing.
    loadAttendeeDetailData.mockImplementationOnce(hangUntilAborted as never);
    const second = deferred<unknown>();
    loadAttendeeDetailData.mockReturnValueOnce(second.promise);
    vi.useFakeTimers();
    renderPage(true);
    await advanceTimers(0);
    expect(loadAttendeeDetailData).toHaveBeenCalledTimes(2);
    expect(signalOf(0)?.aborted).toBe(true);
    expect(signalOf(1)?.aborted).toBe(false);

    // Still waiting for the second request: the cancelled one did not end the wait, so no empty page stands in for the skeleton.
    await advanceTimers(250);
    expect(document.querySelector(".attendee-detail-skeleton")).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Attendee" })).toBeNull();

    await act(async () => second.resolve({ detail, attributeFields: [], itemsWarning: null }));
    await advanceTimers(400);
    expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy();
    // And the cancelled request left no failure behind on the page that did load.
    expect(screen.queryByText(/Could not load attendee/)).toBeNull();
  });
});
