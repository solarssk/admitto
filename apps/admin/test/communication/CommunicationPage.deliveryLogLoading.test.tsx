// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { ApiError } from "../../src/api/client.js";
import { reportApiError } from "../../src/connection/ConnectionStateProvider.js";
import { CommunicationPage } from "../../src/pages/CommunicationPage.js";
import { advanceTimers, deferred, hangUntilAborted, isOff, mockMatchMedia, renderWithToast } from "../test-utils.js";
import { communicationApiMocks } from "./communicationApiMock.js";
import { acceptedRow, failedRow } from "./deliveryFixtures.js";

const { fetchEventOverview, fetchEventTemplate, fetchEventTemplates, fetchEventDeliveries } = communicationApiMocks;
const exportDeliveryLog = vi.fn();
const outletContext = vi.hoisted(() => ({
  event: { id: "evt-1", title: "Demo", archived_at: null, timezone: "Europe/Warsaw" },
}));

vi.mock("../../src/connection/ConnectionStateProvider.js");

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const { buildCommunicationApiMock } = await import("./communicationApiMock.js");
  return {
    ...buildCommunicationApiMock(await importOriginal<typeof import("../../src/api/client.js")>()),
    exportDeliveryLog: (...args: unknown[]) => exportDeliveryLog(...args),
  };
});

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useBlocker: () => ({ state: "unblocked", proceed: vi.fn(), reset: vi.fn() }),
    useOutletContext: () => outletContext,
  };
});

type Answer = { items: (typeof acceptedRow)[]; total: number };

function renderLog() {
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/communication?tab=log"]}>
      <Routes>
        <Route path="/admin/events/:eventId/communication" element={<CommunicationPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const placeholder = () => screen.queryByRole("status", { name: "Loading delivery log" });
const busyRegion = () => document.querySelector(".refetch-card--busy");

/** The pages the server "has": a page that is not listed answers with no rows, as a page past the end does. */
function serve(pages: Record<number, Answer | Promise<Answer>>, total = 60) {
  fetchEventDeliveries.mockImplementation((_eventId: string, params: { page?: number }) => {
    const page = pages[params.page ?? 1];
    return page ?? Promise.resolve({ items: [], total });
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchEventTemplates.mockResolvedValue([]);
  fetchEventTemplate.mockResolvedValue({
    source: "event" as const,
    allowed_placeholders: ["first_name"],
    required_url_placeholders: [],
    image_placeholders: [],
    subject_template: "Hello",
    body_template: "<p>Hi</p>",
    template_format: "html" as const,
  });
  fetchEventOverview.mockResolvedValue({ email_bounced: 0, email_failed: 0, email_sent: 0, email_queued: 0 });
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  fetchEventDeliveries.mockReset();
  exportDeliveryLog.mockReset();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("CommunicationPage delivery log on the loading standard: the first read", () => {
  it("holds the log's room invisibly for 200ms, then draws the table's own shape with its real column headings", async () => {
    fetchEventDeliveries.mockImplementation(hangUntilAborted as never);
    renderLog();
    await advanceTimers(0);

    expect(placeholder()?.className).toContain("at-loading-hold");
    await advanceTimers(200);
    const region = placeholder() as HTMLElement;
    expect(region.className).not.toContain("at-loading-hold");
    expect([...region.querySelectorAll("th")].map((heading) => heading.textContent)).toEqual([
      "Recipient",
      "Template",
      "Purpose",
      "Status",
      "Sent / Queued",
      "",
    ]);
    expect(region.querySelectorAll("tbody tr")).toHaveLength(6);
    expect(screen.queryByText("No messages sent yet")).toBeNull();
    expect(screen.queryByText(/Taking longer than usual/)).toBeNull();
  });

  it("never draws the placeholder for an answer that comes within 200ms", async () => {
    const answer = deferred<Answer>();
    fetchEventDeliveries.mockReturnValue(answer.promise);
    renderLog();
    await advanceTimers(100);
    expect(placeholder()?.className).toContain("at-loading-hold");

    await act(async () => answer.resolve({ items: [acceptedRow], total: 1 }));
    expect(placeholder()).toBeNull();
    expect(screen.getByText("Guest One")).toBeTruthy();
  });

  it("keeps a placeholder that did show for at least 400ms before the rows replace it", async () => {
    const answer = deferred<Answer>();
    fetchEventDeliveries.mockReturnValue(answer.promise);
    renderLog();
    await advanceTimers(0);
    await advanceTimers(250);

    await act(async () => answer.resolve({ items: [acceptedRow], total: 1 }));
    expect(placeholder()).not.toBeNull();
    expect(screen.queryByText("Guest One")).toBeNull();

    // It was drawn at 200ms, so it stays until 600ms.
    await advanceTimers(349);
    expect(placeholder()).not.toBeNull();
    await advanceTimers(1);
    expect(placeholder()).toBeNull();
    expect(screen.getByText("Guest One")).toBeTruthy();
  });

  it("says it is taking longer than usual after 8 seconds", async () => {
    fetchEventDeliveries.mockImplementation(hangUntilAborted as never);
    renderLog();
    await advanceTimers(0);
    await advanceTimers(7_999);
    expect(screen.queryByText(/Taking longer than usual/)).toBeNull();
    await advanceTimers(1);
    expect(placeholder()?.textContent).toMatch(/Taking longer than usual/);
  });

  it("ends in an error with a Retry after 30 seconds, and the Retry keeps the error on screen, busy, until the rows are in", async () => {
    fetchEventDeliveries.mockImplementation(hangUntilAborted as never);
    renderLog();
    await advanceTimers(30_000);
    await advanceTimers(0);

    expect(placeholder()).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("The server did not answer in time");
    const retry = screen.getByRole("button", { name: "Retry" });
    retry.focus();
    const answer = deferred<Answer>();
    fetchEventDeliveries.mockReset();
    fetchEventDeliveries.mockReturnValue(answer.promise);
    fireEvent.click(retry);
    await advanceTimers(0);

    // The same button, busy, still holding the focus, with the error under it and no placeholder in its place.
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(retry.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(retry);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(placeholder()).toBeNull();
    fireEvent.click(retry);
    expect(fetchEventDeliveries).toHaveBeenCalledTimes(1);

    await act(async () => answer.resolve({ items: [acceptedRow], total: 1 }));
    await advanceTimers(500);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByText("Guest One")).toBeTruthy();
    // The Retry that held the focus is gone: the card that holds the log, which stays, takes it, not the page.
    expect(document.activeElement).toBe(document.querySelector(".communication-delivery-header"));
  });

  it("draws the stacked cards of the narrow layout, not a table, while the first read runs", async () => {
    mockMatchMedia(false);
    fetchEventDeliveries.mockImplementation(hangUntilAborted as never);
    renderLog();
    await advanceTimers(0);
    await advanceTimers(200);

    const region = placeholder() as HTMLElement;
    expect(region.querySelectorAll(".communication-card")).toHaveLength(3);
    expect(region.querySelector("table")).toBeNull();
  });

  it("comes back by itself while Live when the first read failed: the next tick's answer ends the error", async () => {
    fetchEventDeliveries.mockRejectedValueOnce(new ApiError(500, "boom"));
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 1 });
    renderLog();
    await advanceTimers(0);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();

    await advanceTimers(1_750);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByText("Guest One")).toBeTruthy();
  });
});

describe("CommunicationPage delivery log on the loading standard: a later page, filter or tick", () => {
  it("keeps the rows on screen, blocked, while a page is on its way, and has the pager say it is busy", async () => {
    const second = deferred<Answer>();
    serve({ 1: { items: [acceptedRow], total: 60 }, 2: second.promise });
    renderLog();
    await advanceTimers(0);
    expect(screen.getByText("Guest One")).toBeTruthy();

    const next = screen.getByRole("button", { name: "Next" });
    next.focus();
    fireEvent.click(next);
    await advanceTimers(0);

    // The rows are still there (no placeholder, no "No matches"), blocked at once, and the pager that was pressed keeps its focus.
    expect(screen.getByText("Guest One")).toBeTruthy();
    expect(placeholder()).toBeNull();
    expect(busyRegion()?.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("button", { name: "Next" })).toBe(next);
    expect(isOff(next)).toBe(true);
    expect(next.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(next);
    expect(busyRegion()?.className).not.toContain("refetch-card--dim");
    await advanceTimers(200);
    expect(busyRegion()?.className).toContain("refetch-card--dim");

    await act(async () => second.resolve({ items: [failedRow], total: 60 }));
    expect(screen.getByText("Guest Two")).toBeTruthy();
    expect(screen.queryByText("Guest One")).toBeNull();
    expect(busyRegion()).toBeNull();
    expect(isOff(screen.getByRole("button", { name: "Next" }))).toBe(false);
  });

  it("refreshes while Live without a sign of it: the rows are neither blocked nor dimmed, and the new ones replace the old", async () => {
    serve({ 1: { items: [acceptedRow], total: 60 } });
    renderLog();
    await advanceTimers(0);

    const tick = deferred<Answer>();
    serve({ 1: tick.promise });
    await advanceTimers(1_750);
    expect(fetchEventDeliveries).toHaveBeenCalledTimes(2);
    await advanceTimers(500);
    expect(busyRegion()).toBeNull();
    expect(isOff(screen.getByRole("button", { name: "Next" }))).toBe(false);
    expect(document.querySelector(".refetch-card--dim")).toBeNull();

    await act(async () => tick.resolve({ items: [failedRow], total: 60 }));
    expect(screen.getByText("Guest Two")).toBeTruthy();
    expect(screen.queryByText("Guest One")).toBeNull();
  });

  it("does not start a tick while a page the operator asked for is still on its way", async () => {
    const second = deferred<Answer>();
    serve({ 1: { items: [acceptedRow], total: 60 }, 2: second.promise });
    renderLog();
    await advanceTimers(0);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await advanceTimers(0);
    expect(fetchEventDeliveries).toHaveBeenCalledTimes(2);

    await advanceTimers(1_750 * 3);
    expect(fetchEventDeliveries).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve({ items: [failedRow], total: 60 }));
    expect(screen.getByText("Guest Two")).toBeTruthy();
  });

  it("waits out a page that a tick has made disappear like a first load, never saying 'No matches' while the page steps back", async () => {
    const stepBack = deferred<Answer>();
    serve({ 1: { items: [acceptedRow], total: 60 }, 2: { items: [acceptedRow], total: 60 }, 3: { items: [acceptedRow], total: 60 } });
    renderLog();
    await advanceTimers(0);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await advanceTimers(0);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await advanceTimers(0);

    // The next tick says there are only five deliveries now: page 3 is gone, and page 1 is asked for.
    serve({ 3: { items: [], total: 5 }, 1: stepBack.promise });
    await advanceTimers(1_750);
    expect(placeholder()).not.toBeNull();
    expect(screen.queryByText("No matches")).toBeNull();
    expect(screen.queryByText("No messages sent yet")).toBeNull();
    expect(screen.queryByText("Guest One")).toBeNull();

    await act(async () => stepBack.resolve({ items: [failedRow], total: 5 }));
    await advanceTimers(500);
    expect(placeholder()).toBeNull();
    expect(screen.getByText("Guest Two")).toBeTruthy();
    expect(fetchEventDeliveries).toHaveBeenLastCalledWith("evt-1", expect.objectContaining({ page: 1 }), expect.any(AbortSignal));
  });

  it("applies the answer of a slow tick when it comes, and starts no second tick while it is on its way", async () => {
    serve({ 1: { items: [acceptedRow], total: 60 } });
    renderLog();
    await advanceTimers(0);

    const slow = deferred<Answer>();
    serve({ 1: slow.promise });
    fetchEventDeliveries.mockClear();
    await advanceTimers(1_750);
    expect(fetchEventDeliveries).toHaveBeenCalledTimes(1);

    // The server answers slower than the interval: the ticks that would have started wait for this one.
    await advanceTimers(1_750 * 3);
    expect(fetchEventDeliveries).toHaveBeenCalledTimes(1);
    await act(async () => slow.resolve({ items: [failedRow], total: 60 }));
    expect(screen.getByText("Guest Two")).toBeTruthy();
    expect(screen.queryByText("Guest One")).toBeNull();
  });

  it("does not report or act on a 401 that a missed tick got, as it does for a read the operator waits for", async () => {
    const assignSpy = vi.fn();
    const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", { configurable: true, value: { pathname: "/admin/events/evt-1/communication", assign: assignSpy } });
    try {
      fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 1 });
      renderLog();
      await advanceTimers(0);

      fetchEventDeliveries.mockRejectedValueOnce(new ApiError(401, "authentication_required"));
      await advanceTimers(1_750);
      expect(assignSpy).not.toHaveBeenCalled();
      expect(reportApiError).not.toHaveBeenCalled();
      expect(screen.getByText("Guest One")).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
    } finally {
      if (locationDescriptor) Object.defineProperty(window, "location", locationDescriptor);
    }
  });

  it("keeps the focus on the pager when the page it asked for fails to load, and Previous is a way back", async () => {
    fetchEventDeliveries.mockImplementation((_eventId: string, params: { page?: number }) =>
      params.page === 2 ? Promise.reject(new ApiError(500, "boom", "internal_error")) : Promise.resolve({ items: [acceptedRow], total: 60 }),
    );
    renderLog();
    await advanceTimers(0);
    const next = screen.getByRole("button", { name: "Next" });
    next.focus();

    fireEvent.click(next);
    await advanceTimers(500);

    // The rows are replaced by the error, and the button that was pressed is still there, with the focus.
    expect(screen.getByRole("alert").textContent).toContain("Could not load deliveries");
    expect(screen.queryByText("Guest One")).toBeNull();
    expect(screen.getByRole("button", { name: "Next" })).toBe(next);
    expect(document.activeElement).toBe(next);
    expect(isOff(next)).toBe(false);

    const previous = screen.getByRole("button", { name: "Previous" });
    previous.focus();
    fireEvent.click(previous);
    // The answer is committed before the 200ms of the placeholder are counted, as it is in a browser.
    await advanceTimers(0);
    await advanceTimers(700);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(placeholder()).toBeNull();
    expect(screen.getByText("Guest One")).toBeTruthy();
    expect(document.activeElement).toBe(previous);
  });

  it("keeps the pager busy, with the focus on the button pressed, while the page that follows a failed one is on its way", async () => {
    const slow = deferred<Answer>();
    fetchEventDeliveries.mockImplementation((_eventId: string, params: { page?: number }) => {
      if (params.page === 2) return Promise.reject(new ApiError(500, "boom", "internal_error"));
      return params.page === 3 ? slow.promise : Promise.resolve({ items: [acceptedRow], total: 60 });
    });
    renderLog();
    await advanceTimers(0);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await advanceTimers(500);
    expect(screen.getByRole("alert").textContent).toContain("Could not load deliveries");

    // After a failure the next read is a first load (the rows are gone), not a refresh: the pager is busy for it all the same.
    const next = screen.getByRole("button", { name: "Next" });
    next.focus();
    fireEvent.click(next);
    expect(screen.getByText("Page 3 of 3")).toBeTruthy();
    expect(isOff(screen.getByRole("button", { name: "Previous" }))).toBe(true);
    expect(document.activeElement).toBe(next);

    await act(async () => slow.resolve({ items: [failedRow], total: 60 }));
    await advanceTimers(500);
    expect(screen.getByText("Guest Two")).toBeTruthy();
    expect(isOff(screen.getByRole("button", { name: "Previous" }))).toBe(false);
  });

  it("steps back one page when a page answers with no rows although the total says it exists", async () => {
    // Its rows were deleted between the server's count and its read: page 3 of 3 is empty.
    serve({ 1: { items: [acceptedRow], total: 51 }, 2: { items: [failedRow], total: 51 }, 3: { items: [], total: 51 } });
    renderLog();
    await advanceTimers(0);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await advanceTimers(0);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await advanceTimers(1_000);

    expect(fetchEventDeliveries).toHaveBeenLastCalledWith("evt-1", expect.objectContaining({ page: 2 }), expect.any(AbortSignal));
    expect(screen.getByText("Guest Two")).toBeTruthy();
    expect(placeholder()).toBeNull();
    expect(screen.queryByText("No matches")).toBeNull();
  });

  it("takes the number off the tab when the list has given way to an error, and puts it back with the rows", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 1 });
    renderLog();
    await advanceTimers(0);
    expect(screen.getByRole("tab", { name: /Delivery log\s*1/ })).toBeTruthy();

    fetchEventDeliveries.mockRejectedValueOnce(new Error("blip"));
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(screen.getByRole("button", { name: /^Status,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Failed" }));
    await advanceTimers(500);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /Delivery log\s*1/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await advanceTimers(500);
    expect(screen.getByRole("tab", { name: /Delivery log\s*1/ })).toBeTruthy();
  });

  it("tells the connection state about a failed read the operator waits for, but not about a missed tick", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 1 });
    renderLog();
    await advanceTimers(0);

    fetchEventDeliveries.mockRejectedValueOnce(new ApiError(503, "unavailable"));
    await advanceTimers(1_750);
    expect(reportApiError).not.toHaveBeenCalled();
    expect(screen.getByText("Guest One")).toBeTruthy();

    fetchEventDeliveries.mockRejectedValueOnce(new ApiError(503, "unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(screen.getByRole("button", { name: /^Status,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Failed" }));
    await advanceTimers(500);
    expect(reportApiError).toHaveBeenCalledWith(503);
  });
});

describe("CommunicationPage delivery log on the loading standard: what the answer on screen says", () => {
  const searchBox = () => screen.getByRole("textbox", { name: "Search recipient by name or email" });

  it("says 'No matches' for an answer that was asked with a filter, and keeps saying what the answer on screen says while a search is typed", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [], total: 0 });
    renderLog();
    await advanceTimers(0);
    expect(screen.getByText("No messages sent yet")).toBeTruthy();

    // The text is typed but not asked yet: the empty state is still the answer's, not the box's.
    fireEvent.change(searchBox(), { target: { value: "nobody" } });
    expect(screen.getByText("No messages sent yet")).toBeTruthy();
    expect(screen.queryByText("No matches")).toBeNull();

    await advanceTimers(300);
    await advanceTimers(500);
    expect(fetchEventDeliveries).toHaveBeenLastCalledWith("evt-1", expect.objectContaining({ search: "nobody" }), expect.any(AbortSignal));
    expect(screen.getByText("No matches")).toBeTruthy();
    expect(screen.queryByText("No messages sent yet")).toBeNull();
  });

  it("clears the search box and what was asked with it when Clear filters is pressed", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 1 });
    renderLog();
    await advanceTimers(0);
    fireEvent.change(searchBox(), { target: { value: "guest" } });
    await advanceTimers(300);
    await advanceTimers(500);
    expect(fetchEventDeliveries).toHaveBeenLastCalledWith("evt-1", expect.objectContaining({ search: "guest" }), expect.any(AbortSignal));

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await advanceTimers(500);
    expect((searchBox() as HTMLInputElement).value).toBe("");
    expect(fetchEventDeliveries).toHaveBeenLastCalledWith("evt-1", expect.objectContaining({ search: undefined, page: 1 }), expect.any(AbortSignal));
  });

  it("stops refreshing while Paused and starts again when Live is chosen", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 1 });
    renderLog();
    await advanceTimers(0);
    fetchEventDeliveries.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Live" }));
    expect(screen.getByRole("button", { name: "Paused" })).toBeTruthy();
    await advanceTimers(5_000);
    expect(fetchEventDeliveries).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Paused" }));
    await advanceTimers(1_750);
    expect(fetchEventDeliveries).toHaveBeenCalledTimes(1);
  });
});

describe("CommunicationPage delivery log on the loading standard: the search box and the page", () => {
  const searchBox = () => screen.getByRole("textbox", { name: "Search recipient by name or email" });

  it("does not send the operator back to the first page for a search that has not changed", async () => {
    serve({ 1: { items: [acceptedRow], total: 60 }, 2: { items: [failedRow], total: 60 } });
    renderLog();
    await advanceTimers(0);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await advanceTimers(0);
    expect(screen.getByText("Guest Two")).toBeTruthy();

    // A character typed and deleted again inside the debounce window asks for what was asked already: the page stays.
    fireEvent.change(searchBox(), { target: { value: "x" } });
    fireEvent.change(searchBox(), { target: { value: "" } });
    await advanceTimers(1_000);
    expect(screen.getByText("Guest Two")).toBeTruthy();
    expect(fetchEventDeliveries).toHaveBeenLastCalledWith("evt-1", expect.objectContaining({ page: 2 }), expect.any(AbortSignal));
  });

  it("goes back to the first page when the search the server is asked for changes", async () => {
    serve({ 1: { items: [acceptedRow], total: 60 }, 2: { items: [failedRow], total: 60 } });
    renderLog();
    await advanceTimers(0);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await advanceTimers(0);
    expect(screen.getByText("Guest Two")).toBeTruthy();

    fireEvent.change(searchBox(), { target: { value: "guest" } });
    await advanceTimers(300);
    await advanceTimers(500);
    expect(fetchEventDeliveries).toHaveBeenLastCalledWith("evt-1", expect.objectContaining({ page: 1, search: "guest" }), expect.any(AbortSignal));
    expect(screen.getByText("Guest One")).toBeTruthy();
  });
});

describe("CommunicationPage delivery log on the loading standard: its buttons", () => {
  it("shows Export log busy on the button itself, with its label's room and its focus, and ignores a second press", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 1 });
    const exporting = deferred<void>();
    exportDeliveryLog.mockReturnValue(exporting.promise);
    renderLog();
    await advanceTimers(0);
    const button = screen.getByRole("button", { name: "Export log" });
    button.focus();

    fireEvent.click(button);
    await advanceTimers(0);
    expect(screen.getByRole("button", { name: "Exporting…" })).toBe(button);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(exportDeliveryLog).toHaveBeenCalledTimes(1);

    await act(async () => exporting.resolve());
    expect(screen.getByRole("button", { name: "Export log" })).toBe(button);
    expect(button.getAttribute("aria-busy")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("keeps the keyboard focus on Clear filters when it clears the filters and goes off", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 1 });
    renderLog();
    await advanceTimers(0);
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(screen.getByRole("button", { name: /^Status,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Failed" }));
    await advanceTimers(500);
    const clear = screen.getByRole("button", { name: "Clear filters" });
    expect(isOff(clear)).toBe(false);
    clear.focus();

    fireEvent.click(clear);
    await advanceTimers(500);

    expect(isOff(clear)).toBe(true);
    expect(clear.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(clear);
  });

  it("does nothing when Clear filters is pressed with no filter set", async () => {
    fetchEventDeliveries.mockResolvedValue({ items: [acceptedRow], total: 1 });
    renderLog();
    await advanceTimers(0);
    fetchEventDeliveries.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await advanceTimers(500);
    expect(fetchEventDeliveries).not.toHaveBeenCalled();
  });
});
