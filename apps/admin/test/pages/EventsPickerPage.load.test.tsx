// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { ApiError } from "../../src/api/client.js";
import type { EventDto } from "../../src/api/types.js";
import { EventsPickerPage } from "../../src/pages/EventsPickerPage.js";
import { LOAD_TIMEOUT_MESSAGE, LOAD_TIMEOUT_MS, SLOW_NOTICE_MS, SLOW_NOTICE_TEXT } from "../../src/utils/loading-timing.js";
import { advanceTimers, deferred, hangUntilAborted, makeOrgAdminAssignment, renderWithToast } from "../test-utils.js";

const { reportApiError } = vi.hoisted(() => ({ reportApiError: vi.fn() }));
const adminAssignments = [makeOrgAdminAssignment()];

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: adminAssignments }),
}));

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ reportApiError }),
}));

vi.mock("../../src/events/CreateEventModal.js", () => ({
  CreateEventModal: ({ open }: { open: boolean }) => (open ? <p>Create dialog is open</p> : null),
}));

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return { ...actual, fetchAdminEvents: vi.fn() };
});

import { fetchAdminEvents } from "../../src/api/client.js";

const springSummit: EventDto = {
  id: "evt-1",
  title: "Spring Summit",
  slug: "spring-summit",
  date: "2026-04-01",
  timezone: "Europe/Warsaw",
  location: null,
  capacity: 200,
  archived_at: null,
};

function renderPicker() {
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin"]}>
      <Routes>
        <Route path="/admin" element={<EventsPickerPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const loader = () => document.querySelector(".at-loader") as HTMLElement | null;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("EventsPickerPage: the first read and its limits", () => {
  it("holds the loader's room at once, draws it after 200ms, says it is taking longer than usual after 8 seconds, and gives up at 30 with an error and a Retry", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchAdminEvents).mockImplementationOnce(hangUntilAborted as never);
    renderPicker();
    await advanceTimers(0);

    expect(loader()?.className).toContain("at-loading-hold");
    await advanceTimers(200);
    expect(loader()?.className).not.toContain("at-loading-hold");
    expect(screen.getByLabelText("Loading events")).toBeTruthy();

    await advanceTimers(SLOW_NOTICE_MS - 200 - 1);
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
    await advanceTimers(1);
    expect(screen.getByText(SLOW_NOTICE_TEXT)).toBeTruthy();

    // At 30 seconds the request is given up: the wait is over, so the loader and its note go and the error takes their place.
    await advanceTimers(LOAD_TIMEOUT_MS - SLOW_NOTICE_MS);
    await advanceTimers(0);
    expect(screen.getByText("Could not load events")).toBeTruthy();
    expect(screen.getByText(`Could not load events. ${LOAD_TIMEOUT_MESSAGE}`)).toBeTruthy();
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
    expect(loader()).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    // A stalled server is not an API answer: it is not reported as one.
    expect(reportApiError).not.toHaveBeenCalled();
  });

  it("keeps the loader for at least 400ms once it has been drawn, then fades the events in", async () => {
    vi.useFakeTimers();
    const answer = deferred<EventDto[]>();
    vi.mocked(fetchAdminEvents).mockReturnValueOnce(answer.promise);
    renderPicker();
    await advanceTimers(250);
    expect(loader()).not.toBeNull();

    await act(async () => answer.resolve([springSummit]));
    await advanceTimers(0);
    // The loader has been up for 50ms of its 400ms.
    expect(loader()).not.toBeNull();
    expect(screen.queryByText("Spring Summit")).toBeNull();
    await advanceTimers(349);
    expect(loader()).not.toBeNull();

    await advanceTimers(1);
    expect(loader()).toBeNull();
    expect(screen.getByText("Spring Summit")).toBeTruthy();
    expect(document.querySelector(".events-picker-body > .at-fade-in")).not.toBeNull();
  });

  it("draws no loader at all for an answer that comes within 200ms", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([springSummit]);
    renderPicker();
    await advanceTimers(0);

    expect(loader()).toBeNull();
    expect(screen.getByText("Spring Summit")).toBeTruthy();
  });

  it("explains a forbidden read and any other failure, and reports an API answer but not a network failure", async () => {
    vi.mocked(fetchAdminEvents).mockRejectedValueOnce(new ApiError(403, "internal_permission_detail"));
    renderPicker();
    expect(await screen.findByText("You do not have access to the admin panel.")).toBeTruthy();
    expect(reportApiError).toHaveBeenCalledWith(403);
    cleanup();
    reportApiError.mockClear();

    vi.mocked(fetchAdminEvents).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderPicker();
    expect(await screen.findByText("Could not load events.")).toBeTruthy();
    expect(reportApiError).toHaveBeenCalledWith(500);
    cleanup();
    reportApiError.mockClear();

    vi.mocked(fetchAdminEvents).mockRejectedValueOnce(new TypeError("network down"));
    renderPicker();
    expect(await screen.findByText("Could not load events.")).toBeTruthy();
    expect(reportApiError).not.toHaveBeenCalled();
  });

  it("offers to create the first event when there is none, and opens the dialog for it", async () => {
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([]);
    renderPicker();

    expect(await screen.findByText("No events yet")).toBeTruthy();
    expect(screen.queryByText("Create dialog is open")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));
    expect(screen.getByText("Create dialog is open")).toBeTruthy();
  });

  it("stays silent about a request that is aborted because the page left", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.mocked(fetchAdminEvents).mockImplementationOnce(((opts?: { signal?: AbortSignal }) => {
      signal = opts?.signal;
      return hangUntilAborted(opts);
    }) as never);
    const { unmount } = renderPicker();
    await advanceTimers(0);
    expect(signal?.aborted).toBe(false);

    unmount();
    expect(signal?.aborted).toBe(true);
    await advanceTimers(LOAD_TIMEOUT_MS);
    expect(reportApiError).not.toHaveBeenCalled();
  });
});

describe("EventsPickerPage: the Retry of a failed read", () => {
  it("keeps the error with a busy Retry, and its focus, while a retry runs, with no loader and no empty list, then hands the focus to the list", async () => {
    vi.mocked(fetchAdminEvents).mockRejectedValueOnce(new TypeError("network down"));
    renderPicker();
    const retry = await screen.findByRole("button", { name: "Retry" });
    // A failure that shows with its Retry is not busy: only a click makes it so.
    expect(retry.getAttribute("aria-busy")).toBeNull();

    const answer = deferred<EventDto[]>();
    vi.mocked(fetchAdminEvents).mockReturnValueOnce(answer.promise);
    retry.focus();
    fireEvent.click(retry);

    // The same button, busy, with the focus. Neither the loader nor "No events yet" takes the error's place.
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(document.activeElement).toBe(retry);
    expect(screen.getByText("Could not load events")).toBeTruthy();
    expect(loader()).toBeNull();
    expect(screen.queryByText("No events yet")).toBeNull();

    await act(async () => answer.resolve([springSummit]));
    await screen.findByText("Spring Summit");
    expect(screen.queryByText("Could not load events")).toBeNull();
    // The Retry that held the focus is gone: the focus goes to the list's region, not to the top of the page.
    const region = document.querySelector(".events-picker-body");
    expect(region?.getAttribute("aria-label")).toBe("Event list");
    await waitFor(() => expect(document.activeElement).toBe(region));
  });

  it("keeps the same Retry, and says the error again, when a retry fails again", async () => {
    vi.mocked(fetchAdminEvents).mockRejectedValueOnce(new TypeError("network down"));
    renderPicker();
    const retry = await screen.findByRole("button", { name: "Retry" });
    const messageBefore = screen.getByText("Could not load events.");

    const failure = deferred<EventDto[]>();
    vi.mocked(fetchAdminEvents).mockReturnValueOnce(failure.promise);
    retry.focus();
    fireEvent.click(retry);
    expect(retry.getAttribute("aria-busy")).toBe("true");

    await act(async () => failure.reject(new TypeError("still down")));
    await waitFor(() => expect(retry.getAttribute("aria-busy")).toBeNull(), { timeout: 3000 });

    // The same text again: the message is a new node (a live region announces additions), the button is not.
    expect(screen.getByText("Could not load events.")).not.toBe(messageBefore);
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(document.activeElement).toBe(retry);
    expect(fetchAdminEvents).toHaveBeenCalledTimes(2);
  });
});
