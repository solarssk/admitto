// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { RegistrationListDto } from "../../src/api/types.js";
import { reportApiError } from "../../src/connection/ConnectionStateProvider.js";
import { LOAD_TIMEOUT_MESSAGE, SLOW_NOTICE_TEXT } from "../../src/utils/loading-timing.js";
import { advanceTimers, deferred, hangUntilAborted, isOff, mockMatchMedia } from "../test-utils.js";
import { answer, bodyRows, counts, guestNames, renderTab, request, requestsPanel, table } from "./requestsFixtures.js";

const fetchRegistrations = vi.fn();
const fetchRegistrationCounts = vi.fn();
const goToLogin = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  fetchRegistrations: (...args: unknown[]) => fetchRegistrations(...args),
  fetchRegistrationCounts: (...args: unknown[]) => fetchRegistrationCounts(...args),
}));

vi.mock("../../src/connection/ConnectionStateProvider.js");
vi.mock("../../src/auth/login-navigation.js", () => ({ goToLogin: (...args: unknown[]) => goToLogin(...args) }));

// The other tabs read and edit their own things: their tests have them. This page is tested around the Requests tab.
vi.mock("../../src/registration/RegistrationFieldsTab.js", () => ({
  RegistrationFieldsTab: () => <p>The attendee fields card</p>,
}));
vi.mock("../../src/registration/RegistrationLegalTab.js", () => ({
  RegistrationLegalTab: () => <p>The legal texts of the event</p>,
}));

const placeholder = () => screen.queryByText("Loading requests");
const lastCall = () => fetchRegistrations.mock.calls.at(-1) as [string, Record<string, unknown>, AbortSignal];

/** Waits until the rows are on screen. */
async function listLoaded() {
  await screen.findByRole("table", { name: "Requests" });
}

function openFilters() {
  fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
}

function pickStatus(option: string) {
  openFilters();
  fireEvent.click(screen.getByRole("button", { name: /^Filter by status/ }));
  fireEvent.click(screen.getByRole("button", { name: option }));
}

beforeEach(() => {
  mockMatchMedia(true);
  // A reset, not a clear: a once-answer a failed test left behind must not reach the next one.
  fetchRegistrations.mockReset();
  fetchRegistrationCounts.mockReset();
  fetchRegistrations.mockResolvedValue(answer([request("r1")]));
  // An event that accepts by itself: the tab opens on every state, which is what these tests are about (the queue as the default view has its own tests).
  fetchRegistrationCounts.mockResolvedValue(counts({ pending: 1 }, "automatic"));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("RegistrationRequestsTab: a route without an event", () => {
  it("says there is no event, without reading anything", () => {
    renderTab({ path: "/admin/registration" });

    expect(screen.getByText("Missing event.")).toBeTruthy();
    expect(fetchRegistrations).not.toHaveBeenCalled();
    expect(fetchRegistrationCounts).not.toHaveBeenCalled();
  });
});

describe("RegistrationRequestsTab: the first read", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // A read that a test has not set up hangs, instead of answering with nothing.
    fetchRegistrations.mockImplementation(hangUntilAborted as never);
  });

  it("holds the room of the table invisibly for 200ms, then draws it grey with its real headings, and says it is taking longer after 8 seconds", async () => {
    renderTab();
    await advanceTimers(0);

    const held = requestsPanel().querySelector(".at-loading-hold") as HTMLElement;
    expect(held).not.toBeNull();
    for (const heading of ["Guest", "Company", "Status", "Last email", "Registered"]) {
      expect(within(held).getByText(heading)).toBeTruthy();
    }
    // The shapes are decoration; nothing claims that there is nothing yet.
    expect(held.querySelector("table")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByText("No requests yet")).toBeNull();
    // The toolbar is real from the first frame: the search can be used while the rows are on their way.
    expect(screen.getByRole("textbox", { name: "Search requests by name or email" })).toBeTruthy();

    await advanceTimers(200);
    expect(requestsPanel().querySelector(".at-loading-hold")).toBeNull();
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();

    await advanceTimers(8000);
    expect(within(placeholder()!.closest("output") as HTMLElement).getByText(SLOW_NOTICE_TEXT)).toBeTruthy();
  });

  it("draws three grey cards in the placeholder on a narrow screen, so that the note about the long wait stays in view under them", async () => {
    mockMatchMedia(false);
    renderTab();
    await advanceTimers(200);
    await advanceTimers(8000);

    expect(requestsPanel().querySelector("table")).toBeNull();
    const cards = requestsPanel().querySelectorAll(".registration-requests__cards .at-skeleton");
    expect(cards).toHaveLength(3);
    expect(within(placeholder()!.closest("output") as HTMLElement).getByText(SLOW_NOTICE_TEXT)).toBeTruthy();
  });

  it("draws six grey rows in the placeholder of the table", async () => {
    renderTab();
    await advanceTimers(200);

    expect(requestsPanel().querySelectorAll(".registration-requests__table tbody .at-skeleton")).toHaveLength(6);
  });

  it("ends in an error after 30 seconds, with a Retry that stays on screen, busy, with its focus, and hands the focus to the card when it works", async () => {
    renderTab();
    await advanceTimers(0);
    await advanceTimers(30_000);
    await advanceTimers(0);
    expect(screen.getByRole("alert").textContent).toContain(LOAD_TIMEOUT_MESSAGE);
    expect(screen.getByRole("alert").textContent).toContain("Could not load the requests");

    const read = deferred<RegistrationListDto>();
    fetchRegistrations.mockReturnValueOnce(read.promise);
    const retry = screen.getByRole("button", { name: "Retry" });
    retry.focus();
    fireEvent.click(retry);
    await advanceTimers(500);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(retry.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(retry);
    expect(placeholder()).toBeNull();

    await act(async () => read.resolve(answer([request("r1")])));
    await advanceTimers(500);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(guestNames()).toEqual(["Ann Kowalska"]);
    expect(document.activeElement).toBe(requestsPanel().querySelector(".registration-requests__panel"));
  });
});

describe("RegistrationRequestsTab: a read that fails", () => {
  it("is an error with the words of the app, never an empty list, and the connection state hears of it", async () => {
    fetchRegistrations.mockRejectedValue(new ApiError(403, "forbidden", "forbidden"));
    renderTab();

    const alert = await screen.findByRole("alert");

    expect(alert.textContent).toContain("Could not load the requests");
    expect(alert.textContent).toContain("You do not have access.");
    expect(screen.queryByText("No requests yet")).toBeNull();
    expect(reportApiError).toHaveBeenCalledWith(403);
  });

  it("hands the browser to the login page on a 401, and shows no error or Retry first", async () => {
    fetchRegistrations.mockRejectedValue(new ApiError(401, "authentication_required"));
    renderTab();

    await waitFor(() => expect(goToLogin).toHaveBeenCalledTimes(1));
    expect(goToLogin).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?next=/));
    expect(reportApiError).toHaveBeenCalledWith(401);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("keeps the toolbar, so a filter that failed can be changed", async () => {
    fetchRegistrations.mockResolvedValueOnce(answer([request("r1")]));
    renderTab();
    await listLoaded();

    fetchRegistrations.mockRejectedValueOnce(new ApiError(500, "internal_error", "internal_error"));
    pickStatus("Accepted (0)");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not load the requests");
    expect(screen.queryByRole("table", { name: "Requests" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Search requests by name or email" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Filters/ })).toBeTruthy();
  });
});

describe("RegistrationRequestsTab: the requests", () => {
  it("asks for the first page of 25, oldest first (the server's order), of the event in the address", async () => {
    renderTab();
    await listLoaded();

    const [eventId, params, signal] = lastCall();
    expect(eventId).toBe("evt-1");
    expect(params).toEqual({ page: 1, pageSize: 25 });
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("lists the guests with their company, their state, the last email and the time they sent the request", async () => {
    fetchRegistrations.mockResolvedValue(
      answer([
        request("r1", {
          first_name: "Ann",
          last_name: "Kowalska",
          company: "Northwind Ltd",
          department: "Marketing",
          status: "pending",
          last_mail: { template_name: "registration-received", status: "sent", retryable: null, can_retry: false },
        }),
        request("r2", { first_name: "Bo", last_name: "Lee", status: "accepted", last_mail: { template_name: "ticket", status: "failed", retryable: false, can_retry: false } }),
        request("r3", { first_name: "Cy", last_name: "Park", status: "rejected" }),
      ]),
    );
    renderTab();
    await listLoaded();

    const headings = within(table()).getAllByRole("columnheader").map((cell) => cell.textContent);
    // The first column holds the checkbox that selects the page: it has no words.
    expect(headings).toEqual(["", "Guest", "Company", "Status", "Last email", "Registered"]);
    const [first, second, third] = bodyRows();
    expect(within(first!).getByText("Ann Kowalska")).toBeTruthy();
    expect(within(first!).getByText("r1@example.com")).toBeTruthy();
    expect(within(first!).getByText("Northwind Ltd")).toBeTruthy();
    expect(within(first!).getByText("Marketing")).toBeTruthy();
    expect(within(first!).getByText("Waiting for a decision")).toBeTruthy();
    expect(within(first!).getByText("Sent")).toBeTruthy();
    expect(within(first!).getByText("Request received")).toBeTruthy();
    expect(within(second!).getByText("Accepted")).toBeTruthy();
    expect(within(second!).getByText("Failed")).toBeTruthy();
    expect(within(second!).getByText("Ticket")).toBeTruthy();
    expect(within(third!).getByText("Rejected")).toBeTruthy();
    // A guest who was sent nothing says so, and one without a company has a dash.
    expect(within(third!).getByText("None")).toBeTruthy();
    expect(within(third!).getByText("-")).toBeTruthy();
  });

  it("shows the time of a request in UTC, with its machine-readable form", async () => {
    renderTab();
    await listLoaded();

    const time = within(bodyRows()[0]!).getByText(/UTC$/);
    expect(time.tagName).toBe("TIME");
    expect(time.getAttribute("datetime")).toBe("2026-10-23T10:14:00.000Z");
    expect(time.textContent).toContain("2026");
  });

  it("marks a guest who brings someone, and says so to a screen reader", async () => {
    fetchRegistrations.mockResolvedValue(answer([request("r1", { companions_count: 1 }), request("r2", { companions_count: 2 }), request("r3")]));
    renderTab();
    await listLoaded();

    const [one, two, none] = bodyRows();
    expect(one!.querySelector(".registration-requests__plus")?.textContent).toBe("+1, brings 1 companion");
    expect(two!.querySelector(".registration-requests__plus")?.textContent).toBe("+2, brings 2 companions");
    expect(none!.querySelector(".registration-requests__plus")).toBeNull();
  });

  it("shows a long name and a long address in full, in the words of the page and not cut to an ellipsis", async () => {
    const longName = "Maximiliana-Guadalupe Wolfeschlegelsteinhausenbergerdorff";
    const longAddress = `${"very.long.address.of.a.guest.".repeat(4)}end@example.com`;
    fetchRegistrations.mockResolvedValue(answer([request("r1", { first_name: longName, last_name: "Nowak-Jeziorańska", email: longAddress, company: "A Company With A Very Long Name Indeed Incorporated" })]));
    renderTab();
    await listLoaded();

    const row = bodyRows()[0]!;
    expect(within(row).getByText(`${longName} Nowak-Jeziorańska`)).toBeTruthy();
    expect(within(row).getByText(longAddress)).toBeTruthy();
    // Nothing carries a title that stands in for the text: the text is all there.
    expect(row.querySelector("[title]")).toBeNull();
  });

  it("lets an address wrap after its @ and its dots, and the text stays the same to copy and to search", async () => {
    fetchRegistrations.mockResolvedValue(answer([request("r1", { email: "ann.kowalska@mail.example.com" })]));
    renderTab();
    await listLoaded();

    const address = bodyRows()[0]!.querySelector(".registration-requests__email") as HTMLElement;
    expect(address.textContent).toBe("ann.kowalska@mail.example.com");
    // After "ann.", "kowalska@", "mail." and "example." (and none after the last part).
    expect(address.querySelectorAll("wbr")).toHaveLength(4);
    expect(address.lastChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(address.lastChild?.textContent).toBe("com");
  });

  it("names the table for a screen reader and marks its headings as column headings", async () => {
    renderTab();
    await listLoaded();

    for (const heading of within(table()).getAllByRole("columnheader")) {
      expect(heading.getAttribute("scope")).toBe("col");
    }
  });
});

describe("RegistrationRequestsTab: on a narrow screen", () => {
  beforeEach(() => {
    mockMatchMedia(false);
  });

  it("draws the table from 1024px, the width it needs, and cards below it", async () => {
    // Only a query for 1024px matches: any other width would draw the cards.
    const matchMedia = vi.fn((query: string) => ({
      matches: query === "(min-width: 1024px)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal("matchMedia", matchMedia);
    renderTab();

    await listLoaded();

    expect(matchMedia).toHaveBeenCalledWith("(min-width: 1024px)");
    expect(screen.queryByRole("list", { name: "Requests" })).toBeNull();
  });

  it("lists the requests as cards, each with its guest, company, state, time and last email", async () => {
    fetchRegistrations.mockResolvedValue(
      answer([
        request("r1", { company: "Northwind Ltd", department: "Marketing", last_mail: { template_name: "registration-waitlist", status: "queued", retryable: null, can_retry: false } }),
        request("r2", { first_name: "Bo", last_name: "Lee", status: "waitlist" }),
      ]),
    );
    renderTab();

    const list = await screen.findByRole("list", { name: "Requests" });

    expect(screen.queryByRole("table")).toBeNull();
    const [first, second] = within(list).getAllByRole("listitem");
    expect(within(first!).getByText("Ann Kowalska")).toBeTruthy();
    expect(within(first!).getByText("Northwind Ltd · Marketing")).toBeTruthy();
    expect(within(first!).getByText("Waiting for a decision")).toBeTruthy();
    expect(within(first!).getByText("Last email")).toBeTruthy();
    expect(within(first!).getByText("Pending")).toBeTruthy();
    expect(within(first!).getByText("Waiting list notice")).toBeTruthy();
    expect(within(second!).getByText("Waiting list")).toBeTruthy();
    expect(within(second!).getByText("None")).toBeTruthy();
  });
});

describe("RegistrationRequestsTab: nothing to list", () => {
  it("says that no request has been sent yet, and offers nothing to clear", async () => {
    fetchRegistrations.mockResolvedValue(answer([]));
    renderTab();

    expect(await screen.findByText("No requests yet")).toBeTruthy();
    expect(screen.getByText("Guests who register through the form are listed here.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    // No rows, so no pager that talks about "Page 1 of 1".
    expect(screen.queryByText(/Showing/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  });

  it("says that nothing matches when a filter is on, and Clear filters takes the state, the age and the search away", async () => {
    fetchRegistrations.mockImplementation(async (_event: string, params: Record<string, unknown>) =>
      "status" in params || "olderThan" in params || "q" in params ? answer([]) : answer([request("r1")]),
    );
    const { router } = renderTab({ search: "?tab=requests&status=accepted" });

    expect(await screen.findByText("No matches")).toBeTruthy();
    expect(screen.getByText("Try a different search, or clear your filters.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    await listLoaded();
    expect(lastCall()[1]).toEqual({ page: 1, pageSize: 25 });
    // Every state is written, not left out: a request that waits would otherwise be what the tab opens on again.
    expect(router.state.location.search).toBe("?tab=requests&status=all");
    expect((screen.getByRole("textbox", { name: "Search requests by name or email" }) as HTMLInputElement).value).toBe("");
  });
});

describe("RegistrationRequestsTab: the focus when the empty list goes", () => {
  const filteredAnswers = () =>
    fetchRegistrations.mockImplementation(async (_event: string, params: Record<string, unknown>) => ("status" in params ? answer([]) : answer([request("r1")])));
  const panelOfCard = () => requestsPanel().querySelector(".registration-requests__panel");

  it("goes to the card when the button that cleared the filters goes with the empty list, so the next Tab goes on from there", async () => {
    filteredAnswers();
    renderTab({ search: "?tab=requests&status=accepted" });
    const clear = await screen.findByRole("button", { name: "Clear filters" });
    clear.focus();

    fireEvent.click(clear);

    await listLoaded();
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
    expect(document.activeElement).toBe(panelOfCard());
  });

  it("goes to the card also when the list that comes back is empty for good, and the button goes with its words", async () => {
    fetchRegistrations.mockImplementation(async (_event: string, params: Record<string, unknown>) => ("status" in params ? answer([]) : answer([])));
    renderTab({ search: "?tab=requests&status=accepted" });
    const clear = await screen.findByRole("button", { name: "Clear filters" });
    clear.focus();

    fireEvent.click(clear);

    expect(await screen.findByText("No requests yet")).toBeTruthy();
    expect(document.activeElement).toBe(panelOfCard());
  });

  it("leaves the focus alone when it has moved on before the list came back", async () => {
    filteredAnswers();
    renderTab({ search: "?tab=requests&status=accepted" });
    const clear = await screen.findByRole("button", { name: "Clear filters" });
    clear.focus();
    const read = deferred<RegistrationListDto>();
    fetchRegistrations.mockReturnValueOnce(read.promise);
    fireEvent.click(clear);
    const box = screen.getByRole("textbox", { name: "Search requests by name or email" });
    box.focus();

    await act(async () => read.resolve(answer([request("r1")])));

    await listLoaded();
    expect(document.activeElement).toBe(box);
  });

  it("does not take the focus when the empty list goes without the button having held it", async () => {
    filteredAnswers();
    renderTab({ search: "?tab=requests&status=accepted" });
    const clear = await screen.findByRole("button", { name: "Clear filters" });

    fireEvent.click(clear);

    await listLoaded();
    expect(document.activeElement).toBe(document.body);
  });
});

describe("RegistrationRequestsTab: the state filter", () => {
  it("reads the state from the address and asks for it", async () => {
    renderTab({ search: "?tab=requests&status=waitlist" });
    await listLoaded();

    expect(lastCall()[1]).toEqual({ page: 1, pageSize: 25, status: "waitlist" });
    expect(screen.getByRole("button", { name: /^Filters/ }).textContent).toContain("1");
  });

  it("takes a state it does not know for every state", async () => {
    renderTab({ search: "?tab=requests&status=nope" });
    await listLoaded();

    expect(lastCall()[1]).toEqual({ page: 1, pageSize: 25 });
  });

  it("offers every state with its number, and writes the one that is chosen to the address", async () => {
    fetchRegistrationCounts.mockResolvedValue(counts({ pending: 4, waitlist: 3, accepted: 120, rejected: 2, awaiting_email: 11 }));
    const { router } = renderTab();
    await listLoaded();
    await waitFor(() => expect(screen.getByRole("tab", { name: /Requests/ }).textContent).toBe("Requests4"));

    openFilters();
    fireEvent.click(screen.getByRole("button", { name: /^Filter by status/ }));
    const options = within(screen.getByRole("list", { name: "Filter by status" })).getAllByRole("button").map((button) => button.getAttribute("aria-label"));
    expect(options).toEqual([
      "All statuses (140)",
      "Waiting for a decision (4)",
      "Waiting list (3)",
      "Accepted (120)",
      "Rejected (2)",
      "Awaiting email (11)",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Waiting for a decision (4)" }));

    await waitFor(() => expect(lastCall()[1]).toEqual({ page: 1, pageSize: 25, status: "pending" }));
    expect(router.state.location.search).toBe("?tab=requests&status=pending");
    expect(screen.getByRole("button", { name: /^Filters/ }).textContent).toContain("1");
  });

  it("writes the tab with the state, also when the address had none, and keeps what else the address holds", async () => {
    const { router } = renderTab({ search: "" });
    await listLoaded();

    pickStatus("Waiting for a decision (1)");

    await waitFor(() => expect(lastCall()[1]).toEqual({ page: 1, pageSize: 25, status: "pending" }));
    expect(router.state.location.search).toBe("?tab=requests&status=pending");
  });

  it("goes back to every state, and writes it to the address: an address without a state opens on what waits", async () => {
    const { router } = renderTab({ search: "?tab=requests&status=pending" });
    await listLoaded();

    pickStatus("All statuses (1)");

    await waitFor(() => expect(lastCall()[1]).toEqual({ page: 1, pageSize: 25 }));
    expect(router.state.location.search).toBe("?tab=requests&status=all");
  });

  it("starts at the first page when the state changes", async () => {
    fetchRegistrations.mockImplementation(async (_event: string, params: { page: number; pageSize: number }) => answer([request(`p${params.page}`)], 60, params.page, params.pageSize));
    renderTab();
    await listLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastCall()[1]).toMatchObject({ page: 2 }));

    pickStatus("Accepted (0)");

    await waitFor(() => expect(lastCall()[1]).toEqual({ page: 1, pageSize: 25, status: "accepted" }));
  });
});

describe("RegistrationRequestsTab: the age filter", () => {
  it("asks for requests older than the chosen age, counts it as a filter, and starts at the first page", async () => {
    renderTab();
    await listLoaded();

    openFilters();
    fireEvent.click(screen.getByRole("button", { name: /^Registered more than/ }));
    fireEvent.click(screen.getByRole("button", { name: "7 days ago" }));

    await waitFor(() => expect(lastCall()[1]).toEqual({ page: 1, pageSize: 25, olderThan: "7d" }));
    expect(screen.getByRole("button", { name: /^Filters/ }).textContent).toContain("1");
    fireEvent.click(screen.getByRole("button", { name: /^Registered more than/ }));
    fireEvent.click(screen.getByRole("button", { name: "Any time" }));
    await waitFor(() => expect(lastCall()[1]).toEqual({ page: 1, pageSize: 25 }));
  });

  it("starts again at the first page when the age changes, as the pages of another age are not these", async () => {
    fetchRegistrations.mockImplementation(async (_event: string, params: { page: number; pageSize: number }) => answer([request(`p${params.page}`)], 60, params.page, params.pageSize));
    renderTab();
    await listLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Page 2 of 3")).toBeTruthy());

    openFilters();
    fireEvent.click(screen.getByRole("button", { name: /^Registered more than/ }));
    fireEvent.click(screen.getByRole("button", { name: "30 days ago" }));

    await waitFor(() => expect(lastCall()[1]).toEqual({ page: 1, pageSize: 25, olderThan: "30d" }));
    // Not even one read of the page the viewer was on, asked for under the new age.
    expect(fetchRegistrations.mock.calls.map((call) => call[1])).not.toContainEqual({ page: 2, pageSize: 25, olderThan: "30d" });
  });

  it("counts the state and the age as two filters", async () => {
    renderTab({ search: "?tab=requests&status=pending" });
    await listLoaded();

    openFilters();
    fireEvent.click(screen.getByRole("button", { name: /^Registered more than/ }));
    fireEvent.click(screen.getByRole("button", { name: "1 day ago" }));

    await waitFor(() => expect(screen.getByRole("button", { name: /^Filters/ }).textContent).toContain("2"));
    expect(lastCall()[1]).toEqual({ page: 1, pageSize: 25, status: "pending", olderThan: "24h" });
  });
});

describe("RegistrationRequestsTab: the search", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  async function loaded() {
    renderTab();
    await advanceTimers(0);
    await advanceTimers(0);
  }

  const box = () => screen.getByRole("textbox", { name: "Search requests by name or email" }) as HTMLInputElement;

  it("asks 300ms after the last key, once, with the words that were typed", async () => {
    await loaded();
    fetchRegistrations.mockClear();

    fireEvent.change(box(), { target: { value: "an" } });
    await advanceTimers(200);
    fireEvent.change(box(), { target: { value: "ann kow" } });
    await advanceTimers(299);
    expect(fetchRegistrations).not.toHaveBeenCalled();
    await advanceTimers(1);

    expect(fetchRegistrations).toHaveBeenCalledTimes(1);
    expect(lastCall()[1]).toEqual({ page: 1, pageSize: 25, q: "ann kow" });
  });

  it("asks with what the server accepts: invisible characters and extra spaces are gone", async () => {
    await loaded();
    fetchRegistrations.mockClear();

    const zeroWidth = String.fromCodePoint(0x200b);
    fireEvent.change(box(), { target: { value: `  ann${zeroWidth}@example.com   ` } });
    await advanceTimers(300);

    expect(lastCall()[1]).toEqual({ page: 1, pageSize: 25, q: "ann @example.com" });
  });

  it("asks nothing for a text that is only spaces", async () => {
    await loaded();
    fetchRegistrations.mockClear();

    fireEvent.change(box(), { target: { value: "   " } });
    await advanceTimers(300);

    expect(fetchRegistrations).not.toHaveBeenCalled();
  });

  it("says that nothing matches, not that there are no requests, when a search finds nothing, and Clear filters empties the box and asks without it", async () => {
    fetchRegistrations.mockImplementation(async (_event: string, params: Record<string, unknown>) => ("q" in params ? answer([]) : answer([request("r1")])));
    await loaded();

    fireEvent.change(box(), { target: { value: "zzz" } });
    await advanceTimers(300);
    await advanceTimers(0);

    expect(screen.getByText("No matches")).toBeTruthy();
    expect(screen.queryByText("No requests yet")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await advanceTimers(0);
    await advanceTimers(300);

    expect(box().value).toBe("");
    expect(lastCall()[1]).toEqual({ page: 1, pageSize: 25 });
    expect(screen.getByRole("table", { name: "Requests" })).toBeTruthy();
  });

  it("starts at the first page, and the clear button empties the box, asks again and keeps the focus in the box", async () => {
    fetchRegistrations.mockImplementation(async (_event: string, params: { page: number; pageSize: number }) => answer([request(`p${params.page}`)], 60, params.page, params.pageSize));
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await advanceTimers(0);
    expect(lastCall()[1]).toMatchObject({ page: 2 });

    fireEvent.change(box(), { target: { value: "ann" } });
    await advanceTimers(300);
    expect(lastCall()[1]).toEqual({ page: 1, pageSize: 25, q: "ann" });

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(box().value).toBe("");
    expect(document.activeElement).toBe(box());
    await advanceTimers(300);
    expect(lastCall()[1]).toEqual({ page: 1, pageSize: 25 });
  });
});

describe("RegistrationRequestsTab: the pages", () => {
  function pagesOf60() {
    fetchRegistrations.mockImplementation(async (_event: string, params: { page: number; pageSize: number }) =>
      answer([request(`p${params.page}a`), request(`p${params.page}b`)], 60, params.page, params.pageSize),
    );
  }

  it("says which requests are on screen, and moves a page at a time", async () => {
    pagesOf60();
    renderTab();
    await listLoaded();

    expect(screen.getByText("Showing 1–25 of 60")).toBeTruthy();
    expect(screen.getByText("Page 1 of 3")).toBeTruthy();
    expect(isOff(screen.getByRole("button", { name: "Previous" }))).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Page 2 of 3")).toBeTruthy());
    expect(lastCall()[1]).toEqual({ page: 2, pageSize: 25 });
    await waitFor(() => expect(guestNames()).toHaveLength(2));
    expect(screen.getByText("Showing 26–50 of 60")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Page 3 of 3")).toBeTruthy());
    await waitFor(() => expect(isOff(screen.getByRole("button", { name: "Next" }))).toBe(true));
    expect(screen.getByText("Showing 51–60 of 60")).toBeTruthy();
  });

  it("keeps the rows of the page before on screen, blocked, until the next page has come, and keeps the focus on the button", async () => {
    pagesOf60();
    renderTab();
    await listLoaded();
    const next = screen.getByRole("button", { name: "Next" });
    next.focus();
    const read = deferred<RegistrationListDto>();
    fetchRegistrations.mockReturnValueOnce(read.promise);

    fireEvent.click(next);

    expect(screen.getByText("Page 2 of 3")).toBeTruthy();
    const before = guestNames();
    expect(before).toHaveLength(2);
    expect(requestsPanel().querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Next" })).toBe(next);
    expect(document.activeElement).toBe(next);
    expect(isOff(next)).toBe(true);
    expect(isOff(screen.getByRole("button", { name: "Previous" }))).toBe(true);

    await act(async () => read.resolve(answer([request("later")], 60, 2, 25)));
    await waitFor(() => expect(guestNames()).toEqual(["Ann Kowalska"]));
    expect(requestsPanel().querySelector('[aria-busy="true"]')).toBeNull();
    expect(document.activeElement).toBe(next);
  });

  it("starts again at the first page when the number of rows changes", async () => {
    pagesOf60();
    renderTab();
    await listLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Page 2 of 3")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Rows per page, 25" }));
    fireEvent.click(screen.getByRole("button", { name: "50" }));

    await waitFor(() => expect(lastCall()[1]).toEqual({ page: 1, pageSize: 50 }));
    await waitFor(() => expect(screen.getByText("Page 1 of 2")).toBeTruthy());
  });

  it("steps back to the last page that exists when the one it is on has gone, and never says there is nothing", async () => {
    // The 60 requests became 30 while the viewer was on page 3: the server answers page 3 with no rows, and the total it now has.
    let shrunk = false;
    fetchRegistrations.mockImplementation(async (_event: string, params: { page: number; pageSize: number }) => {
      if (params.page === 3) {
        shrunk = true;
        return answer([], 30, 3, params.pageSize);
      }
      return answer([request(`p${params.page}`)], shrunk ? 30 : 60, params.page, params.pageSize);
    });
    renderTab();
    await listLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Page 2 of 3")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(screen.getByText("Page 2 of 2")).toBeTruthy());
    // The pages it asked for, in order: not the page that had gone again, and not the one before it.
    expect(fetchRegistrations.mock.calls.map((call) => (call[1] as { page: number }).page)).toEqual([1, 2, 3, 2]);
    expect(screen.queryByText("No requests yet")).toBeNull();
    expect(screen.queryByText("No matches")).toBeNull();
    expect(guestNames()).toEqual(["Ann Kowalska"]);
  });
});

describe("RegistrationRequestsTab: a page with no rows that the total says exists", () => {
  it("steps back one page, as the rows were deleted between the server's count and its read, and never says there is nothing", async () => {
    fetchRegistrations.mockImplementation(async (_event: string, params: { page: number; pageSize: number }) =>
      params.page === 2 ? answer([], 40, 2, params.pageSize) : answer([request(`p${params.page}`)], 40, params.page, params.pageSize),
    );
    renderTab();
    await listLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(screen.getByText("Page 1 of 2")).toBeTruthy());
    expect(fetchRegistrations.mock.calls.map((call) => (call[1] as { page: number }).page)).toEqual([1, 2, 1]);
    expect(screen.queryByText("No requests yet")).toBeNull();
    expect(screen.queryByText("No matches")).toBeNull();
    expect(guestNames()).toEqual(["Ann Kowalska"]);
  });
});

describe("RegistrationRequestsTab: the numbers of each state", () => {
  it("says that registration is off when the event has no mode, and not when it has one", async () => {
    fetchRegistrationCounts.mockResolvedValue(counts({}, null));
    renderTab();
    await listLoaded();

    expect(await screen.findByText(/Registration is off for this event/)).toBeTruthy();

    cleanup();
    fetchRegistrationCounts.mockResolvedValue(counts({ pending: 2 }, "approval"));
    renderTab();
    await listLoaded();
    await waitFor(() => expect(screen.getByRole("tab", { name: /Requests/ }).textContent).toBe("Requests2"));
    expect(screen.queryByText(/Registration is off for this event/)).toBeNull();
  });

  it("says nothing about the mode while the numbers are unknown, and the filter lists the states without them", async () => {
    fetchRegistrationCounts.mockRejectedValue(new ApiError(500, "internal_error", "internal_error"));
    renderTab();
    await listLoaded();

    expect(screen.queryByText(/Registration is off for this event/)).toBeNull();
    expect(screen.getByRole("tab", { name: /Requests/ }).textContent).toBe("Requests");
    openFilters();
    fireEvent.click(screen.getByRole("button", { name: /^Filter by status/ }));
    expect(screen.getByRole("button", { name: "Waiting for a decision" })).toBeTruthy();
  });

  it("reads the numbers again when the tab is opened after another, and not when the page opened on it", async () => {
    renderTab();
    await listLoaded();
    await act(async () => {});
    expect(fetchRegistrationCounts).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("tab", { name: /Fields/ }));
    expect(await screen.findByText("The attendee fields card")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Requests/ }));

    await listLoaded();
    await waitFor(() => expect(fetchRegistrationCounts).toHaveBeenCalledTimes(2));
  });

  it("says nothing when the read of the numbers that opening the tab starts fails, as a missed tick: the numbers it has stay", async () => {
    renderTab();
    await listLoaded();
    await waitFor(() => expect(screen.getByRole("tab", { name: /Requests/ }).textContent).toBe("Requests1"));
    fetchRegistrationCounts.mockRejectedValue(new ApiError(401, "authentication_required"));

    fireEvent.click(screen.getByRole("tab", { name: /Fields/ }));
    expect(await screen.findByText("The attendee fields card")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Requests/ }));

    await listLoaded();
    await waitFor(() => expect(fetchRegistrationCounts).toHaveBeenCalledTimes(2));
    await act(async () => {});
    // Not the connection state, not the login page (the read of the requests, which the viewer waits for, would do that), no error.
    expect(goToLogin).not.toHaveBeenCalled();
    expect(reportApiError).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("tab", { name: /Requests/ }).textContent).toBe("Requests1");
  });

  it("reads the requests again each time the tab is opened, so it never shows what an earlier visit read", async () => {
    renderTab();
    await listLoaded();
    expect(fetchRegistrations).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("tab", { name: /Legal/ }));
    expect(await screen.findByText("The legal texts of the event")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Requests/ }));

    await listLoaded();
    expect(fetchRegistrations).toHaveBeenCalledTimes(2);
  });
});
