// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { RegistrationCountsDto, RegistrationListDto } from "../../src/api/types.js";
import { deferred, mockMatchMedia } from "../test-utils.js";
import { api, resetApi } from "./requestsApi.js";
import { answer, cardPanel, counts, openIds, renderTab, request, requestsPanel } from "./requestsFixtures.js";

vi.mock("../../src/api/client.js", async () => (await import("./requestsApi.js")).mockedClient());
vi.mock("../../src/connection/ConnectionStateProvider.js");
vi.mock("../../src/auth/login-navigation.js", async () => (await import("./requestsApi.js")).loginNavigationModule());
vi.mock("../../src/registration/RegistrationFieldsTab.js", async () => (await import("./requestsApi.js")).fieldsTabModule());
vi.mock("../../src/registration/RegistrationLegalTab.js", async () => (await import("./requestsApi.js")).legalTabModule());

/** The state each read of the list asked for ("every state" is none), in order. */
const askedStates = () => api.fetchRegistrations.mock.calls.map((call) => (call[1] as { status?: string }).status ?? "all");
const queueChoice = (name: RegExp) => screen.getByRole("radio", { name });

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
    expect(queueChoice(/^Waiting for a decision/).getAttribute("aria-checked")).toBe("true");
    expect(queueChoice(/^All/).getAttribute("aria-checked")).toBe("false");
    // Nothing was written to the address: it still says nothing, and the tab opens on the same again.
    expect(router.state.location.search).toBe("?tab=requests");
  });

  it("is every state when staff decide by hand and none waits", async () => {
    api.fetchRegistrationCounts.mockResolvedValue(counts({ pending: 0, accepted: 5 }));
    api.fetchRegistrations.mockResolvedValue(answer([request("r1", { status: "accepted" })]));
    renderTab();

    await screen.findByRole("table", { name: "Requests" });

    expect(askedStates()).toEqual(["all"]);
    expect(queueChoice(/^All/).getAttribute("aria-checked")).toBe("true");
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
    expect(queueChoice(/^All/).getAttribute("aria-checked")).toBe("true");
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

    // The numbers changed under it, and every read, before and after, was for the queue.
    expect(queueChoice(/^Waiting for a decision/).textContent).toBe("Waiting for a decision (0)");
    expect(new Set(askedStates())).toEqual(new Set(["pending"]));
  });
});

describe("the shortcut to the queue", () => {
  beforeEach(() => {
    api.fetchRegistrationCounts.mockResolvedValue(counts({ pending: 4, waitlist: 3, accepted: 120, rejected: 2, awaiting_email: 11 }));
    api.fetchRegistrations.mockResolvedValue(answer([request("r1")]));
  });

  it("says how many wait and how many there are in all", async () => {
    renderTab();
    await screen.findByRole("table", { name: "Requests" });

    expect(queueChoice(/^Waiting for a decision/).textContent).toBe("Waiting for a decision (4)");
    expect(queueChoice(/^All/).textContent).toBe("All (140)");
    expect(screen.getByRole("radiogroup", { name: "Requests to show" })).toBeTruthy();
  });

  it("says nothing of the numbers until they are known", async () => {
    api.fetchRegistrationCounts.mockRejectedValue(new ApiError(500, "internal_error", "internal_error"));
    renderTab();
    await screen.findByRole("table", { name: "Requests" });

    expect(queueChoice(/^Waiting for a decision/).textContent).toBe("Waiting for a decision");
    expect(queueChoice(/^All/).textContent).toBe("All");
  });

  it("shows every state, and writes it to the address, when All is chosen", async () => {
    const { router } = renderTab();
    await screen.findByRole("table", { name: "Requests" });

    fireEvent.click(queueChoice(/^All/));

    await waitFor(() => expect(askedStates().at(-1)).toBe("all"));
    expect(router.state.location.search).toBe("?tab=requests&status=all");
    expect(queueChoice(/^All/).getAttribute("aria-checked")).toBe("true");
  });

  it("shows what waits again, and writes it to the address, when it is chosen after another state", async () => {
    const { router } = renderTab({ search: "?tab=requests&status=accepted" });
    await screen.findByRole("table", { name: "Requests" });

    fireEvent.click(queueChoice(/^Waiting for a decision/));

    await waitFor(() => expect(askedStates().at(-1)).toBe("pending"));
    expect(router.state.location.search).toBe("?tab=requests&status=pending");
  });

  it("has neither choice on while another state is shown, which only the Filters choose", async () => {
    renderTab({ search: "?tab=requests&status=waitlist" });
    await screen.findByRole("table", { name: "Requests" });

    expect(queueChoice(/^Waiting for a decision/).getAttribute("aria-checked")).toBe("false");
    expect(queueChoice(/^All/).getAttribute("aria-checked")).toBe("false");
  });

  it("starts again at the first page when it is chosen", async () => {
    api.fetchRegistrations.mockImplementation(async (_event: string, params: { page: number; pageSize: number }) => answer([request(`p${params.page}`)], 60, params.page, params.pageSize));
    renderTab({ search: "?tab=requests&status=all" });
    await screen.findByRole("table", { name: "Requests" });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Page 2 of 3")).toBeTruthy());

    fireEvent.click(queueChoice(/^Waiting for a decision/));

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
    expect(document.activeElement).toBe(cardPanel());
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
  it("reads the requests that wait for the Overview link and shows them checked on the queue", async () => {
    api.fetchRegistrationCounts.mockResolvedValue(counts({ pending: 3 }));
    api.fetchRegistrations.mockResolvedValue(answer([request("r1"), request("r2")]));
    renderTab({ search: "?tab=requests&status=pending" });

    await screen.findByRole("table", { name: "Requests" });

    expect(openIds()).toEqual(["r1", "r2"]);
    expect(within(requestsPanel()).getByRole("radio", { name: /^Waiting for a decision/ }).getAttribute("aria-checked")).toBe("true");
  });
});
