// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { RegistrationCountsDto, RegistrationListDto } from "../../src/api/types.js";
import { formatUtcDateTime } from "../../src/utils/event-dates.js";
import { deferred, mockMatchMedia } from "../test-utils.js";
import { api, resetApi } from "./requestsApi.js";
import { OLDEST_WAITING, answer, cardPanel, counts, openIds, renderTab, request, requestsPanel } from "./requestsFixtures.js";

vi.mock("../../src/api/client.js", async () => (await import("./requestsApi.js")).mockedClient());
vi.mock("../../src/connection/ConnectionStateProvider.js");
vi.mock("../../src/auth/login-navigation.js", async () => (await import("./requestsApi.js")).loginNavigationModule());
vi.mock("../../src/registration/RegistrationFieldsTab.js", async () => (await import("./requestsApi.js")).fieldsTabModule());
vi.mock("../../src/registration/RegistrationLegalTab.js", async () => (await import("./requestsApi.js")).legalTabModule());

/** The state each read of the list asked for ("every state" is none), in order. */
const askedStates = () => api.fetchRegistrations.mock.calls.map((call) => (call[1] as { status?: string }).status ?? "all");
const filtersButton = () => screen.getByRole("button", { name: /^Filters/ });
/** The banner over the table, or null when there is none. */
const banner = () => requestsPanel().querySelector<HTMLElement>(".registration-requests__banner");

beforeEach(() => {
  mockMatchMedia(true);
  resetApi();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("what the tab opens on", () => {
  it("is the requests that wait for a decision when staff decide by hand and some wait, read once, for that state", async () => {
    api.fetchRegistrationCounts.mockResolvedValue(counts({ pending: 4 }));
    api.fetchRegistrations.mockResolvedValue(answer([request("r1")]));
    const { router } = renderTab({ search: "?tab=requests" });

    await screen.findByRole("table", { name: "Requests" });

    expect(askedStates()).toEqual(["pending"]);
    // The state is one of the Filters, and is the one that is on.
    expect(filtersButton().textContent).toContain("1");
    // Nothing was written to the address: it still says nothing, and the tab opens on the same again.
    expect(router.state.location.search).toBe("?tab=requests");
  });

  it("is every state when staff decide by hand and none waits", async () => {
    api.fetchRegistrationCounts.mockResolvedValue(counts({ pending: 0, accepted: 5 }));
    api.fetchRegistrations.mockResolvedValue(answer([request("r1", { status: "accepted" })]));
    renderTab();

    await screen.findByRole("table", { name: "Requests" });

    expect(askedStates()).toEqual(["all"]);
    expect(filtersButton().textContent).not.toMatch(/\d/);
  });

  it("is every state when the event accepts by itself, whatever the numbers say waits", async () => {
    api.fetchRegistrationCounts.mockResolvedValue(counts({ pending: 4 }, "automatic"));
    api.fetchRegistrations.mockResolvedValue(answer([request("r1")]));
    renderTab();

    await screen.findByRole("table", { name: "Requests" });

    expect(askedStates()).toEqual(["all"]);
  });

  it("is every state when registration is off", async () => {
    api.fetchRegistrationCounts.mockResolvedValue(counts({ pending: 4 }, null));
    api.fetchRegistrations.mockResolvedValue(answer([request("r1")]));
    renderTab();

    await screen.findByRole("table", { name: "Requests" });

    expect(askedStates()).toEqual(["all"]);
  });

  it("is every state when the numbers could not be read, and says nothing about it over the list", async () => {
    api.fetchRegistrationCounts.mockRejectedValue(new ApiError(500, "internal_error", "internal_error"));
    api.fetchRegistrations.mockResolvedValue(answer([request("r1")]));
    renderTab();

    await screen.findByRole("table", { name: "Requests" });

    expect(askedStates()).toEqual(["all"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("waits for the numbers before it reads the list, and draws the placeholder meanwhile, so that the list is read for the state it will show and never for another first", async () => {
    const numbers = deferred<RegistrationCountsDto>();
    api.fetchRegistrationCounts.mockReturnValue(numbers.promise);
    api.fetchRegistrations.mockResolvedValue(answer([request("r1")]));
    renderTab();
    await act(async () => {});

    expect(api.fetchRegistrations).not.toHaveBeenCalled();
    expect(screen.getByText("Loading requests")).toBeTruthy();
    expect(screen.queryByText("No requests yet")).toBeNull();

    await act(async () => numbers.resolve(counts({ pending: 2 })));
    await screen.findByRole("table", { name: "Requests" });

    expect(askedStates()).toEqual(["pending"]);
  });

  it("is what the address says, at once and without waiting for the numbers, when it names a state", async () => {
    api.fetchRegistrationCounts.mockReturnValue(new Promise(() => {}));
    api.fetchRegistrations.mockResolvedValue(answer([request("r1", { status: "waitlist" })]));
    renderTab({ search: "?tab=requests&status=waitlist" });

    await screen.findByRole("table", { name: "Requests" });

    expect(askedStates()).toEqual(["waitlist"]);
  });

  it("is every state when the address says so, although requests wait: that is a choice, not a gap", async () => {
    api.fetchRegistrationCounts.mockResolvedValue(counts({ pending: 4 }));
    api.fetchRegistrations.mockResolvedValue(answer([request("r1")]));
    renderTab({ search: "?tab=requests&status=all" });

    await screen.findByRole("table", { name: "Requests" });

    expect(askedStates()).toEqual(["all"]);
    expect(filtersButton().textContent).not.toMatch(/\d/);
  });

  it("stays on the queue when the numbers say later that nothing waits any more, and does not switch to every state under the staff member", async () => {
    api.fetchRegistrationCounts.mockResolvedValue(counts({ pending: 2 }));
    api.fetchRegistrations.mockResolvedValue(answer([request("r1")]));
    renderTab();
    await screen.findByRole("table", { name: "Requests" });
    // The numbers are read again when the tab is opened after another, and by then nothing waits.
    fireEvent.click(screen.getByRole("tab", { name: /Fields/ }));
    await screen.findByText("The attendee fields card");
    api.fetchRegistrationCounts.mockResolvedValue(counts({ pending: 0 }));
    fireEvent.click(screen.getByRole("tab", { name: /Requests/ }));
    await screen.findByRole("table", { name: "Requests" });
    await waitFor(() => expect(screen.getByRole("tab", { name: /Requests/ }).textContent).toBe("Requests"));

    // The numbers changed under it, and every read, before and after, was for the queue; nothing waits, so the banner is gone.
    expect(banner()).toBeNull();
    fireEvent.click(filtersButton());
    fireEvent.click(screen.getByRole("button", { name: /^Filter by status/ }));
    expect(screen.getByRole("button", { name: "Waiting for a decision (0)" })).toBeTruthy();
    expect(new Set(askedStates())).toEqual(new Set(["pending"]));
  });
});

describe("the banner over the table", () => {
  beforeEach(() => {
    api.fetchRegistrationCounts.mockResolvedValue(counts({ pending: 4, waitlist: 3, accepted: 120, rejected: 2, awaiting_email: 11 }));
    api.fetchRegistrations.mockResolvedValue(answer([request("r1")]));
  });

  it("says how many wait and when the oldest came in, in UTC, the same text for every viewer", async () => {
    renderTab();
    await screen.findByRole("table", { name: "Requests" });

    expect(banner()?.textContent).toBe(`4 requests wait for your decision. The oldest came in on ${formatUtcDateTime(OLDEST_WAITING)}.`);
    const time = banner()?.querySelector("time");
    expect(time?.getAttribute("datetime")).toBe(OLDEST_WAITING);
    expect(time?.textContent).toMatch(/ UTC$/);
    // In the look of every time: the zone is quiet, in an element of its own.
    expect(time?.querySelector(".time-stack__zone")?.textContent).toBe(" UTC");
  });

  it("is over the table, under the toolbar, in the amber of a warning, and is no button and no tile", async () => {
    renderTab();
    await screen.findByRole("table", { name: "Requests" });

    const panel = cardPanel() as HTMLElement;
    const parts = [...panel.children].map((part) => part.className.split(" ")[0]);
    expect(parts.indexOf("registration-requests__banner")).toBe(parts.indexOf("attendees-toolbar") + 1);
    expect(banner()?.querySelector(".at-notice--warning")).not.toBeNull();
    expect(within(banner() as HTMLElement).queryByRole("button")).toBeNull();
  });

  it("says it in the singular for one request", async () => {
    api.fetchRegistrationCounts.mockResolvedValue(counts({ pending: 1 }));
    renderTab();
    await screen.findByRole("table", { name: "Requests" });

    expect(banner()?.textContent).toContain("1 request waits for your decision.");
  });

  it("says only how many wait when the oldest is not known", async () => {
    api.fetchRegistrationCounts.mockResolvedValue({ ...counts({ pending: 2 }), oldest_waiting_at: null });
    renderTab();
    await screen.findByRole("table", { name: "Requests" });

    expect(banner()?.textContent).toBe("2 requests wait for your decision.");
  });

  it("is not there when nobody waits, and not before the numbers are known", async () => {
    api.fetchRegistrationCounts.mockResolvedValue(counts({ pending: 0, accepted: 5 }));
    api.fetchRegistrations.mockResolvedValue(answer([request("r1", { status: "accepted" })]));
    renderTab();
    await screen.findByRole("table", { name: "Requests" });
    expect(banner()).toBeNull();

    cleanup();
    api.fetchRegistrationCounts.mockRejectedValue(new ApiError(500, "internal_error", "internal_error"));
    renderTab();
    await screen.findByRole("table", { name: "Requests" });
    expect(banner()).toBeNull();
  });

  it("stays over a list of another state, as it is about the event and not about the list", async () => {
    renderTab({ search: "?tab=requests&status=accepted" });
    await screen.findByRole("table", { name: "Requests" });

    expect(banner()?.textContent).toContain("4 requests wait for your decision.");
  });

  it("leaves the line under the search to the search and the Filters: no shortcut to a state and no delete button", async () => {
    renderTab({ search: "?tab=requests&status=rejected" });
    await screen.findByRole("table", { name: "Requests" });

    expect(screen.queryByRole("radiogroup", { name: "Requests to show" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^All \(/ })).toBeNull();
    expect(within(requestsPanel()).queryByRole("button", { name: /^Delete all matching/ })).toBeNull();
    expect(within(cardPanel() as HTMLElement).queryByRole("button", { name: /^Waiting for a decision/ })).toBeNull();
  });

  it("chooses the state in the Filters, and starts again at the first page", async () => {
    api.fetchRegistrations.mockImplementation(async (_event: string, params: { page: number; pageSize: number }) => answer([request(`p${params.page}`)], 60, params.page, params.pageSize));
    renderTab({ search: "?tab=requests&status=all" });
    await screen.findByRole("table", { name: "Requests" });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Page 2 of 3")).toBeTruthy());

    fireEvent.click(filtersButton());
    fireEvent.click(screen.getByRole("button", { name: /^Filter by status/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Waiting for a decision/ }));

    await waitFor(() => expect(api.fetchRegistrations.mock.calls.at(-1)?.[1]).toEqual({ page: 1, pageSize: 25, status: "pending" }));
  });
});

describe("a queue with nothing in it", () => {
  const emptyFor = (params: { status?: string }): RegistrationListDto => (params.status === "pending" ? answer([]) : answer([request("r1", { status: "accepted" })]));

  beforeEach(() => {
    api.fetchRegistrationCounts.mockResolvedValue(counts({ pending: 0, accepted: 1 }));
    api.fetchRegistrations.mockImplementation(async (_event: string, params: { status?: string }) => emptyFor(params));
  });

  it("says that nothing waits, and not that nothing matches, with the way to every request", async () => {
    renderTab({ search: "?tab=requests&status=pending" });

    expect(await screen.findByText("Nothing is waiting for a decision")).toBeTruthy();
    expect(screen.getByText("Requests that need a decision are listed here.")).toBeTruthy();
    expect(screen.queryByText("No matches")).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  });

  it("shows every request, writes it to the address and hands the keyboard to the card when its button is used", async () => {
    const { router } = renderTab({ search: "?tab=requests&status=pending" });
    const showAll = await screen.findByRole("button", { name: "Show all requests" });
    showAll.focus();

    fireEvent.click(showAll);

    await screen.findByRole("table", { name: "Requests" });
    expect(router.state.location.search).toBe("?tab=requests&status=all");
    // The focus is handed on in an effect, which can run after the table is on screen.
    await waitFor(() => expect(document.activeElement).toBe(cardPanel()));
  });

  it("is no longer the queue when a search or an age is on too: then nothing matches", async () => {
    renderTab({ search: "?tab=requests&status=pending" });
    await screen.findByText("Nothing is waiting for a decision");

    fireEvent.change(screen.getByRole("textbox", { name: "Search requests by name or email" }), { target: { value: "zzz" } });

    expect(await screen.findByText("No matches")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeTruthy();
    expect(screen.queryByText("Nothing is waiting for a decision")).toBeNull();
  });

  it("is still nothing yet for an event that has no requests at all", async () => {
    api.fetchRegistrations.mockResolvedValue(answer([]));
    api.fetchRegistrationCounts.mockResolvedValue(counts({}));
    renderTab();

    expect(await screen.findByText("No requests yet")).toBeTruthy();
    expect(screen.queryByText("Nothing is waiting for a decision")).toBeNull();
  });
});

describe("what the tab does with an address that names the state", () => {
  it("reads the requests that wait for the Overview link and shows the state as a filter that is on", async () => {
    api.fetchRegistrationCounts.mockResolvedValue(counts({ pending: 3 }));
    api.fetchRegistrations.mockResolvedValue(answer([request("r1"), request("r2")]));
    renderTab({ search: "?tab=requests&status=pending" });

    await screen.findByRole("table", { name: "Requests" });

    expect(openIds()).toEqual(["r1", "r2"]);
    expect(filtersButton().textContent).toContain("1");
  });
});
