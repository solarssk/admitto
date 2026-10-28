// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { EventDto, RegistrationListDto, RejectRegistrationsDto } from "../../src/api/types.js";
import { reportApiError } from "../../src/connection/ConnectionStateProvider.js";
import { deferred, getTooltipText, isOff, mockMatchMedia } from "../test-utils.js";
import { FakeServer, api, resetApi } from "./requestsApi.js";
import { EVENT, FAILED_MAIL, cardPanel, named, openButton, openIds, renderTab, requestsPanel } from "./requestsFixtures.js";

vi.mock("../../src/api/client.js", async () => (await import("./requestsApi.js")).mockedClient());
vi.mock("../../src/connection/ConnectionStateProvider.js");
vi.mock("../../src/auth/login-navigation.js", async () => (await import("./requestsApi.js")).loginNavigationModule());
vi.mock("../../src/registration/RegistrationFieldsTab.js", async () => (await import("./requestsApi.js")).fieldsTabModule());
vi.mock("../../src/registration/RegistrationLegalTab.js", async () => (await import("./requestsApi.js")).legalTabModule());

const QUEUE = "?tab=requests&status=pending";
const EVERY_STATE = "?tab=requests&status=all";
const ARCHIVED = { ...EVENT, archived_at: "2026-10-01T00:00:00.000Z" } as EventDto;

const three = () => [named("r1", "Ann", "Kowalska"), named("r2", "Bo", "Lee"), named("r3", "Cy", "Park")];

const checkbox = (name: string) => screen.getByRole("checkbox", { name: `Select ${name}` }) as HTMLInputElement;
const tick = (...names: string[]) => names.forEach((name) => fireEvent.click(checkbox(name)));
const bulkBar = () => requestsPanel().querySelector<HTMLElement>(".attendees-bulkbar");
const barButton = (name: string | RegExp) => within(bulkBar() as HTMLElement).getByRole("button", { name });
const loaded = () => screen.findByRole("table", { name: "Requests" });
const dialogNamed = (name: string | RegExp) => screen.findByRole("dialog", { name });
const press = (dialog: HTMLElement, name: string) => fireEvent.click(within(dialog).getByRole("button", { name }));
const menuItem = (name: RegExp) => screen.getByRole("menuitem", { name });
const queueLabel = () => screen.getByRole("radio", { name: /^Waiting for a decision/ }).textContent;

/** Opens the menu of the bulk bar. */
const openMenu = () => fireEvent.click(barButton(/^More/));

/** Ticks the requests, asks for the action in the bar and confirms it from the keyboard, with the focus on the confirmation's button, as a person does. */
async function decide(names: string[], action: "Accept" | "Reject", title: string | RegExp) {
  tick(...names);
  fireEvent.click(barButton(action));
  const dialog = await dialogNamed(title);
  const confirm = within(dialog).getByRole("button", { name: action });
  confirm.focus();
  fireEvent.click(confirm);
}

beforeEach(() => {
  mockMatchMedia(true);
  resetApi();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the selection and the bulk bar", () => {
  beforeEach(() => {
    new FakeServer([...three(), named("r4", "Di", "Quinn", { status: "accepted" })]);
  });

  it("puts the bar in the place of the toolbar when a request is ticked, with how many, and gives the toolbar back when none is", async () => {
    renderTab({ search: EVERY_STATE });
    await loaded();
    expect(bulkBar()).toBeNull();
    expect(screen.getByRole("textbox", { name: "Search requests by name or email" })).toBeTruthy();

    tick("Ann Kowalska");

    expect(bulkBar()?.textContent).toContain("1 selected");
    expect(screen.queryByRole("textbox", { name: "Search requests by name or email" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));

    expect(bulkBar()).toBeNull();
    expect(screen.getByRole("textbox", { name: "Search requests by name or email" })).toBeTruthy();
  });

  it("ticks and unticks a request, and counts those that are ticked", async () => {
    renderTab({ search: EVERY_STATE });
    await loaded();

    tick("Ann Kowalska", "Bo Lee");
    expect(bulkBar()?.textContent).toContain("2 selected");
    expect(checkbox("Cy Park").checked).toBe(false);

    tick("Ann Kowalska");
    expect(bulkBar()?.textContent).toContain("1 selected");
    expect(checkbox("Ann Kowalska").checked).toBe(false);
    expect(checkbox("Bo Lee").checked).toBe(true);
  });

  it("selects the whole page with the box in the heading, and takes the whole selection away with it again", async () => {
    renderTab({ search: EVERY_STATE });
    await loaded();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(bulkBar()?.textContent).toContain("4 selected");
    expect((screen.getByRole("checkbox", { name: "Select all" }) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(bulkBar()).toBeNull();
  });

  it("tints the rows that are ticked", async () => {
    renderTab({ search: EVERY_STATE });
    await loaded();

    tick("Bo Lee");

    const rows = within(requestsPanel()).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.classList.contains("attendees-table-v2__row--selected"))).toEqual([false, true, false, false]);
  });

  it("is made of cards on a narrow screen, with its Select all in a strip of its own, and keeps Reject in the menu, where it fits", async () => {
    mockMatchMedia(false);
    renderTab({ search: EVERY_STATE });
    const list = await screen.findByRole("list", { name: "Requests" });
    expect(within(requestsPanel()).getByRole("checkbox", { name: "Select all" })).toBeTruthy();

    tick("Ann Kowalska");

    expect(within(list).getAllByRole("listitem")[0]?.classList.contains("registration-requests__card--selected")).toBe(true);
    expect(bulkBar()?.textContent).toContain("1 selected");
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
    openMenu();
    expect(menuItem(/^Reject/)).toBeTruthy();
    expect(menuItem(/^Send email again/)).toBeTruthy();
    expect(menuItem(/^Delete requests/)).toBeTruthy();
  });

  it("asks to confirm the rejection from the menu on a narrow screen, and closes the menu", async () => {
    mockMatchMedia(false);
    renderTab({ search: EVERY_STATE });
    await screen.findByRole("list", { name: "Requests" });

    tick("Ann Kowalska");
    openMenu();
    fireEvent.click(menuItem(/^Reject/));

    expect(await dialogNamed("Reject this request?")).toBeTruthy();
    // An open dialog hides the page from the role queries, so the menu is looked for among the hidden elements too.
    expect(screen.queryByRole("menu", { hidden: true })).toBeNull();
  });

  it("offers Accept and Reject as buttons, and Send email again and Delete in the menu, on a wide screen", async () => {
    renderTab({ search: EVERY_STATE });
    await loaded();

    tick("Ann Kowalska");

    expect(barButton("Accept")).toBeTruthy();
    expect(barButton("Reject")).toBeTruthy();
    openMenu();
    expect(screen.queryByRole("menuitem", { name: /^Reject/ })).toBeNull();
    expect(menuItem(/^Send email again/)).toBeTruthy();
    expect(menuItem(/^Delete requests/)).toBeTruthy();
  });

  it("turns Accept off, with its reason, when none of the selected can be accepted, and Reject when none can be rejected", async () => {
    renderTab({ search: EVERY_STATE });
    await loaded();

    tick("Di Quinn");

    expect(isOff(barButton("Accept"))).toBe(true);
    expect(getTooltipText(barButton("Accept"))).toBe(
      "None of the selected requests can be accepted: they are accepted already, or wait for the guest to confirm the address.",
    );
    expect(isOff(barButton("Reject"))).toBe(true);
    expect(getTooltipText(barButton("Reject"))).toContain("None of the selected requests can be rejected");

    tick("Ann Kowalska");

    expect(isOff(barButton("Accept"))).toBe(false);
    expect(isOff(barButton("Reject"))).toBe(false);
  });

  it("starts again with nothing ticked on another page, in another state, with another search and with another page size", async () => {
    const many = Array.from({ length: 30 }, (_, index) => named(`m${index + 1}`, `Guest${index + 1}`, "Lee"));
    new FakeServer(many);
    renderTab({ search: EVERY_STATE });
    await loaded();

    tick("Guest1 Lee");
    expect(bulkBar()).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(bulkBar()).toBeNull());
    await waitFor(() => expect(screen.getByText("Page 2 of 2")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(screen.getByText("Page 1 of 2")).toBeTruthy());
    tick("Guest1 Lee");
    fireEvent.click(screen.getByRole("radio", { name: /^Waiting for a decision/ }));
    await waitFor(() => expect(bulkBar()).toBeNull());

    await waitFor(() => expect(openButton("m1")).not.toBeNull());
    tick("Guest1 Lee");
    fireEvent.click(screen.getByRole("button", { name: "Rows per page, 25" }));
    fireEvent.click(screen.getByRole("button", { name: "50" }));
    await waitFor(() => expect(bulkBar()).toBeNull());
  });

  it("takes the ticks away in the very moment another page is asked for, while the rows of this one are still on screen", async () => {
    const many = Array.from({ length: 30 }, (_, index) => named(`m${index + 1}`, `Guest${index + 1}`, "Lee"));
    const server = new FakeServer(many);
    renderTab({ search: EVERY_STATE });
    await loaded();
    const nextPage = deferred<RegistrationListDto>();
    api.fetchRegistrations.mockReturnValueOnce(nextPage.promise);

    tick("Guest1 Lee");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // The answer is not in: the rows are the ones of the first page, and nothing can be done to them on a page that is no longer asked for.
    expect(openButton("m1")).not.toBeNull();
    expect(bulkBar()).toBeNull();
    await act(async () => nextPage.resolve(server.page({ page: 2, pageSize: 25 })));
    await waitFor(() => expect(openButton("m26")).not.toBeNull());
  });

  it("starts again with nothing ticked when a search is made, which is other requests", async () => {
    renderTab({ search: EVERY_STATE });
    await loaded();
    fireEvent.change(screen.getByRole("textbox", { name: "Search requests by name or email" }), { target: { value: "" } });

    tick("Ann Kowalska");
    expect(bulkBar()).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search requests by name or email" }), { target: { value: "bo" } });
    tick("Bo Lee");
    expect(bulkBar()).not.toBeNull();
    // The words are sent after a pause; the selection is of the requests the earlier words found.
    await waitFor(() => expect(api.fetchRegistrations.mock.calls.at(-1)?.[1]).toMatchObject({ q: "bo" }));
    await waitFor(() => expect(bulkBar()).toBeNull());
  });

  it("turns the two decisions off on an archived event, with the reason, and leaves Delete as it is: a request to delete personal data does not expire", async () => {
    renderTab({ search: EVERY_STATE, event: ARCHIVED });
    await loaded();

    tick("Ann Kowalska");

    expect(isOff(barButton("Accept"))).toBe(true);
    expect(isOff(barButton("Reject"))).toBe(true);
    expect(getTooltipText(barButton("Accept"))).toBe("This event is archived. Editing is disabled.");
    openMenu();
    expect(isOff(menuItem(/^Send email again/))).toBe(true);
    expect(isOff(menuItem(/^Delete requests/))).toBe(false);
  });
});

describe("accepting", () => {
  it("asks first, says what it does, and when the server has confirmed it applies the change at once and reads the list and the numbers again", async () => {
    new FakeServer(three());
    const refreshEvent = vi.fn().mockResolvedValue(true);
    renderTab({ search: QUEUE, refreshEvent });
    await loaded();
    expect(queueLabel()).toBe("Waiting for a decision (3)");

    tick("Ann Kowalska", "Bo Lee");
    fireEvent.click(barButton("Accept"));
    const dialog = await dialogNamed("Accept 2 requests?");
    expect(dialog.textContent).toContain("Each guest becomes an attendee and gets a ticket by email.");
    expect(api.acceptRegistrations).not.toHaveBeenCalled();
    press(dialog, "Accept");

    expect(await screen.findByText("2 requests accepted.")).toBeTruthy();
    expect(api.acceptRegistrations).toHaveBeenCalledWith("evt-1", ["r1", "r2"]);
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(openIds()).toEqual(["r3"]));
    // The queue, the tab and the Filters read the numbers again; the list is read again too, without a sign of it.
    await waitFor(() => expect(queueLabel()).toBe("Waiting for a decision (1)"));
    await waitFor(() => expect(screen.getByRole("tab", { name: /Requests/ }).textContent).toBe("Requests1"));
    expect(api.fetchRegistrations.mock.calls.length).toBeGreaterThanOrEqual(2);
    // The seats of the event changed, so the layout reads it again; the selection is gone with the requests.
    await waitFor(() => expect(refreshEvent).toHaveBeenCalledTimes(1));
    expect(bulkBar()).toBeNull();
  });

  it("says that the guests take more seats than they are when some bring someone", async () => {
    new FakeServer([named("r1", "Ann", "Kowalska", { companions_count: 1 }), named("r2", "Bo", "Lee"), named("r3", "Cy", "Park", { companions_count: 1 })]);
    renderTab({ search: QUEUE });
    await loaded();

    tick("Ann Kowalska", "Bo Lee");
    fireEvent.click(barButton("Accept"));

    const dialog = await dialogNamed("Accept 2 requests?");
    expect(dialog.textContent).toContain("They take 3 seats, counting the people they bring.");
  });

  it("does not mention seats when every guest comes alone", async () => {
    new FakeServer(three());
    renderTab({ search: QUEUE });
    await loaded();

    tick("Ann Kowalska", "Bo Lee");
    fireEvent.click(barButton("Accept"));

    expect((await dialogNamed("Accept 2 requests?")).textContent).not.toContain("seats");
  });

  it("says nothing of left-out requests when every selected request can be accepted", async () => {
    new FakeServer(three());
    renderTab({ search: QUEUE });
    await loaded();

    tick("Ann Kowalska", "Bo Lee");
    fireEvent.click(barButton("Accept"));

    expect((await dialogNamed("Accept 2 requests?")).textContent).not.toContain("left out");
  });

  it("asks about one request as this request", async () => {
    new FakeServer(three());
    renderTab({ search: QUEUE });
    await loaded();

    tick("Ann Kowalska");
    fireEvent.click(barButton("Accept"));

    const dialog = await dialogNamed("Accept this request?");
    expect(dialog.textContent).toContain("The guest becomes an attendee and gets a ticket by email.");
  });

  it("sends only the requests that can be accepted, and says how many are left out and why", async () => {
    new FakeServer([...three(), named("r4", "Di", "Quinn", { status: "accepted" }), named("r5", "Ed", "Ross", { status: "awaiting_email" }), named("r6", "Fay", "Stone", { status: "rejected" })]);
    renderTab({ search: EVERY_STATE });
    await loaded();

    tick("Ann Kowalska", "Di Quinn", "Ed Ross", "Fay Stone");
    fireEvent.click(barButton("Accept"));

    const dialog = await dialogNamed("Accept 2 requests?");
    expect(dialog.textContent).toContain("2 of the selected requests are left out.");
    expect(dialog.textContent).toContain("A request that is accepted already, or waits for the guest to confirm the address, cannot be accepted.");
    press(dialog, "Accept");
    await screen.findByText("2 requests accepted.");
    expect(api.acceptRegistrations).toHaveBeenCalledWith("evt-1", ["r1", "r6"]);
    // The left-out ones leave the selection with the others: the action was asked of all four.
    expect(bulkBar()).toBeNull();
  });

  it("says one left-out request in the singular", async () => {
    new FakeServer([...three(), named("r4", "Di", "Quinn", { status: "accepted" })]);
    renderTab({ search: EVERY_STATE });
    await loaded();

    tick("Ann Kowalska", "Di Quinn");
    fireEvent.click(barButton("Accept"));

    expect((await dialogNamed("Accept this request?")).textContent).toContain("1 of the selected requests is left out.");
  });

  it("is refused with the numbers when the guests do not fit: nothing changes, nothing is said as done, and the dialog stays with the words", async () => {
    new FakeServer(three(), { freeSeats: 1 });
    const refreshEvent = vi.fn().mockResolvedValue(true);
    renderTab({ search: QUEUE, refreshEvent });
    await loaded();
    const readsBefore = api.fetchRegistrations.mock.calls.length;

    await decide(["Ann Kowalska", "Bo Lee"], "Accept", "Accept 2 requests?");

    const dialog = await dialogNamed("Accept 2 requests?");
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toBe(
      "Only 1 seat is free, and the guests you chose need 2 (a companion takes a seat too). Nobody was accepted. Choose fewer guests, or raise the event's capacity first.",
    );
    expect(openIds()).toEqual(["r1", "r2", "r3"]);
    // No toast says that something was done.
    expect(screen.queryByText(/requests? accepted\./)).toBeNull();
    expect(refreshEvent).not.toHaveBeenCalled();
    expect(api.fetchRegistrations.mock.calls).toHaveLength(readsBefore);
    expect(bulkBar()?.textContent).toContain("2 selected");
    // It can be tried again with fewer guests: Cancel, untick one, ask again.
    press(dialog, "Cancel");
    expect(screen.queryByRole("dialog")).toBeNull();
    tick("Bo Lee");
    fireEvent.click(barButton("Accept"));
    press(await dialogNamed("Accept this request?"), "Accept");
    expect(await screen.findByText("1 request accepted.")).toBeTruthy();
  });

  it("says no seats are free in those words", async () => {
    new FakeServer(three(), { freeSeats: 0 });
    renderTab({ search: QUEUE });
    await loaded();

    await decide(["Ann Kowalska"], "Accept", "Accept this request?");

    const alert = await within(await dialogNamed("Accept this request?")).findByRole("alert");
    expect(alert.textContent).toContain("No seats are free, and the guests you chose need 1");
  });

  it("shows the words of the app for a failure, never the text of the server, and keeps the dialog", async () => {
    new FakeServer(three());
    api.acceptRegistrations.mockRejectedValue(new ApiError(500, "SELECT secret FROM users", "internal_error"));
    renderTab({ search: QUEUE });
    await loaded();

    await decide(["Ann Kowalska"], "Accept", "Accept this request?");

    const alert = await within(await dialogNamed("Accept this request?")).findByRole("alert");
    expect(alert.textContent).toBe("Something went wrong. Try again. If it keeps happening, check System logs.");
    expect(document.body.textContent).not.toContain("SELECT");
    expect(reportApiError).toHaveBeenCalledWith(500);
    expect(openIds()).toEqual(["r1", "r2", "r3"]);
  });

  it("says it could not, in its own words, when nothing answered", async () => {
    new FakeServer(three());
    api.acceptRegistrations.mockRejectedValue(new Error("network down"));
    renderTab({ search: QUEUE });
    await loaded();

    await decide(["Ann Kowalska"], "Accept", "Accept this request?");

    const alert = await within(await dialogNamed("Accept this request?")).findByRole("alert");
    expect(alert.textContent).toBe("Could not accept the requests. Try again.");
  });

  it("says that the event is archived when it was archived after the page was read", async () => {
    new FakeServer(three());
    api.acceptRegistrations.mockRejectedValue(new ApiError(403, "event_archived", "event_archived"));
    renderTab({ search: QUEUE });
    await loaded();

    await decide(["Ann Kowalska"], "Accept", "Accept this request?");

    const alert = await within(await dialogNamed("Accept this request?")).findByRole("alert");
    expect(alert.textContent).toBe("This event is archived.");
  });

  it("hands the browser to the login page on a 401, and shows no error", async () => {
    new FakeServer(three());
    api.acceptRegistrations.mockRejectedValue(new ApiError(401, "authentication_required"));
    renderTab({ search: QUEUE });
    await loaded();

    await decide(["Ann Kowalska"], "Accept", "Accept this request?");

    await waitFor(() => expect(api.goToLogin).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?next=/)));
    expect(reportApiError).toHaveBeenCalledWith(401);
    expect(within(await dialogNamed("Accept this request?")).queryByRole("alert")).toBeNull();
  });

  it("sends the request once however often the button is pressed, and shows that it works", async () => {
    new FakeServer(three());
    const reply = deferred<{ results: { id: string; outcome: "accepted"; attendee_id: string }[] }>();
    api.acceptRegistrations.mockReturnValue(reply.promise);
    renderTab({ search: QUEUE });
    await loaded();

    tick("Ann Kowalska");
    fireEvent.click(barButton("Accept"));
    const dialog = await dialogNamed("Accept this request?");
    const confirm = within(dialog).getByRole("button", { name: "Accept" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(api.acceptRegistrations).toHaveBeenCalledTimes(1);
    expect(confirm.getAttribute("aria-busy")).toBe("true");
    expect(within(dialog).getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
    await act(async () => reply.resolve({ results: [{ id: "r1", outcome: "accepted", attendee_id: "at-r1" }] }));
    expect(await screen.findByText("1 request accepted.")).toBeTruthy();
  });

  it("tells that a request was decided meanwhile, shows it as it is now, and says so in a warning", async () => {
    const server = new FakeServer(three());
    renderTab({ search: EVERY_STATE });
    await loaded();
    // Another organiser accepted Bo while this page was open.
    server.rows = server.rows.map((row) => (row.id === "r2" ? { ...row, status: "accepted" as const } : row));

    await decide(["Ann Kowalska", "Bo Lee"], "Accept", "Accept 2 requests?");

    expect(await screen.findByText("1 request accepted. Skipped: 1 already accepted.")).toBeTruthy();
  });

  it("moves a request that is accepted to Accepted when the list shows every state, and keeps it on the page", async () => {
    new FakeServer(three());
    renderTab({ search: EVERY_STATE });
    await loaded();

    await decide(["Ann Kowalska"], "Accept", "Accept this request?");

    await screen.findByText("1 request accepted.");
    expect(openIds()).toEqual(["r1", "r2", "r3"]);
    const first = within(requestsPanel()).getAllByRole("row")[1] as HTMLElement;
    expect(within(first).getByText("Accepted")).toBeTruthy();
  });
});

describe("rejecting", () => {
  it("asks whether the guest is to be told, and does not tell by default: the message is off", async () => {
    new FakeServer(three());
    renderTab({ search: QUEUE });
    await loaded();

    tick("Ann Kowalska", "Bo Lee");
    fireEvent.click(barButton("Reject"));

    const dialog = await dialogNamed("Reject 2 requests?");
    const message = within(dialog).getByRole("checkbox", { name: "Send a message to the guests" }) as HTMLInputElement;
    expect(message.checked).toBe(false);
    expect(dialog.textContent).toContain("They stay on the list as rejected.");
    expect(dialog.textContent).toContain("Off: the guests are not told. On: the guests get the decline email.");
    expect(dialog.textContent).not.toContain("left out");
    press(dialog, "Reject");

    expect(await screen.findByText("2 requests rejected.")).toBeTruthy();
    expect(api.rejectRegistrations).toHaveBeenCalledWith("evt-1", ["r1", "r2"], false);
    await waitFor(() => expect(openIds()).toEqual(["r3"]));
  });

  it("tells the guests, and says so, when the message is on", async () => {
    new FakeServer(three());
    renderTab({ search: QUEUE });
    await loaded();

    tick("Ann Kowalska");
    fireEvent.click(barButton("Reject"));
    const dialog = await dialogNamed("Reject this request?");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Send a message to the guest" }));
    expect(dialog.textContent).toContain("Off: the guest is not told. On: the guest gets the decline email.");
    press(dialog, "Reject");

    expect(await screen.findByText("1 request rejected. The guests are emailed.")).toBeTruthy();
    expect(api.rejectRegistrations).toHaveBeenCalledWith("evt-1", ["r1"], true);
  });

  it("is off again every time the dialog opens, whatever it was left at", async () => {
    new FakeServer(three());
    renderTab({ search: QUEUE });
    await loaded();
    tick("Ann Kowalska");

    fireEvent.click(barButton("Reject"));
    let dialog = await dialogNamed("Reject this request?");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Send a message to the guest" }));
    expect((within(dialog).getByRole("checkbox", { name: "Send a message to the guest" }) as HTMLInputElement).checked).toBe(true);
    press(dialog, "Cancel");

    fireEvent.click(barButton("Reject"));
    dialog = await dialogNamed("Reject this request?");
    expect((within(dialog).getByRole("checkbox", { name: "Send a message to the guest" }) as HTMLInputElement).checked).toBe(false);
  });

  it("leaves a rejected request on the page, as Rejected, when the list shows every state", async () => {
    new FakeServer(three());
    renderTab({ search: EVERY_STATE });
    await loaded();

    await decide(["Bo Lee"], "Reject", "Reject this request?");

    await screen.findByText("1 request rejected.");
    expect(openIds()).toEqual(["r1", "r2", "r3"]);
    expect(within(within(requestsPanel()).getAllByRole("row")[2] as HTMLElement).getByText("Rejected")).toBeTruthy();
  });

  it("says which requests are left out, and sends only the others", async () => {
    new FakeServer([...three(), named("r4", "Di", "Quinn", { status: "accepted" }), named("r5", "Ed", "Ross", { status: "rejected" })]);
    renderTab({ search: EVERY_STATE });
    await loaded();

    tick("Ann Kowalska", "Di Quinn", "Ed Ross");
    fireEvent.click(barButton("Reject"));

    const dialog = await dialogNamed("Reject this request?");
    expect(dialog.textContent).toContain("2 of the selected requests are left out.");
    expect(dialog.textContent).toContain("A request that is decided already, or waits for the guest to confirm the address, cannot be rejected.");
    press(dialog, "Reject");
    await screen.findByText("1 request rejected.");
    expect(api.rejectRegistrations).toHaveBeenCalledWith("evt-1", ["r1"], false);
    // The left-out ones leave the selection with the one that was rejected: the action was asked of all three.
    expect(bulkBar()).toBeNull();
  });

  it("keeps the message to the guest as it was for as long as the rejection runs", async () => {
    new FakeServer(three());
    const reply = deferred<RejectRegistrationsDto>();
    api.rejectRegistrations.mockReturnValue(reply.promise);
    renderTab({ search: QUEUE });
    await loaded();

    await decide(["Ann Kowalska"], "Reject", "Reject this request?");

    const dialog = await dialogNamed("Reject this request?");
    expect(isOff(within(dialog).getByRole("checkbox", { name: "Send a message to the guest" }))).toBe(true);
    await act(async () => reply.resolve({ results: [{ id: "r1", outcome: "rejected" }] }));
    expect(await screen.findByText("1 request rejected.")).toBeTruthy();
  });

  it("does not take or free a seat, so the event is not read again", async () => {
    new FakeServer(three());
    const refreshEvent = vi.fn().mockResolvedValue(true);
    renderTab({ search: QUEUE, refreshEvent });
    await loaded();

    await decide(["Ann Kowalska"], "Reject", "Reject this request?");

    await screen.findByText("1 request rejected.");
    await act(async () => {});
    expect(refreshEvent).not.toHaveBeenCalled();
  });

  it("keeps the dialog with the words of the app when it fails", async () => {
    new FakeServer(three());
    api.rejectRegistrations.mockRejectedValue(new ApiError(500, "boom", "internal_error"));
    renderTab({ search: QUEUE });
    await loaded();

    await decide(["Ann Kowalska"], "Reject", "Reject this request?");

    const alert = await within(await dialogNamed("Reject this request?")).findByRole("alert");
    expect(alert.textContent).toBe("Something went wrong. Try again. If it keeps happening, check System logs.");
  });
});

describe("sending an email again", () => {
  const withMails = () => [
    named("r1", "Ann", "Kowalska", { last_mail: FAILED_MAIL }),
    named("r2", "Bo", "Lee", { status: "accepted", last_mail: { template_name: "ticket", status: "failed", retryable: false, can_retry: false } }),
    named("r3", "Cy", "Park"),
  ];

  it("is offered for the requests whose last email can be sent again, counts them, and sends it for those only", async () => {
    new FakeServer(withMails());
    renderTab({ search: EVERY_STATE });
    await loaded();

    tick("Ann Kowalska", "Bo Lee");
    openMenu();
    const item = menuItem(/^Send email again/);
    expect(item.textContent).toContain("The last email failed for 1 request");
    fireEvent.click(item);

    expect(await screen.findByText("1 email will be sent again.")).toBeTruthy();
    expect(api.retryRegistrationMails).toHaveBeenCalledWith("evt-1", ["r1"]);
    // The email is waiting now, with nothing left to send again; the selection (both of them were asked) is gone.
    const first = within(requestsPanel()).getAllByRole("row")[1] as HTMLElement;
    await waitFor(() => expect(within(first).getByText("Pending")).toBeTruthy());
    expect(bulkBar()).toBeNull();
  });

  it("is off, with its reason, when no selected request has an email that can be sent again: the ticket email is sent again from the attendee, not from here", async () => {
    new FakeServer(withMails());
    renderTab({ search: EVERY_STATE });
    await loaded();

    tick("Bo Lee");
    openMenu();

    const item = menuItem(/^Send email again/);
    expect(isOff(item)).toBe(true);
    expect(item.textContent).toContain("No failed email among the selected");
    expect(getTooltipText(item)).toBe("None of the selected requests has an email that failed for good.");
  });

  it("shows how it went in a toast, and the words of the app when it fails", async () => {
    new FakeServer(withMails());
    api.retryRegistrationMails.mockRejectedValue(new ApiError(500, "boom", "internal_error"));
    renderTab({ search: EVERY_STATE });
    await loaded();

    tick("Ann Kowalska");
    openMenu();
    fireEvent.click(menuItem(/^Send email again/));

    expect(await screen.findByText("Something went wrong. Try again. If it keeps happening, check System logs.")).toBeTruthy();
    expect(bulkBar()?.textContent).toContain("1 selected");
  });

  it("is a row of the menu that works for as long as the server takes, and is not started twice", async () => {
    new FakeServer(withMails());
    const reply = deferred<{ results: { id: string; outcome: "retried" }[] }>();
    api.retryRegistrationMails.mockReturnValue(reply.promise);
    renderTab({ search: EVERY_STATE });
    await loaded();

    tick("Ann Kowalska");
    openMenu();
    const item = menuItem(/^Send email again/);
    fireEvent.click(item);
    fireEvent.click(item);

    expect(api.retryRegistrationMails).toHaveBeenCalledTimes(1);
    await act(async () => reply.resolve({ results: [{ id: "r1", outcome: "retried" }] }));
    expect(await screen.findByText("1 email will be sent again.")).toBeTruthy();
  });

  it("is off on an archived event", async () => {
    new FakeServer(withMails());
    renderTab({ search: EVERY_STATE, event: ARCHIVED });
    await loaded();

    tick("Ann Kowalska");
    openMenu();

    expect(isOff(menuItem(/^Send email again/))).toBe(true);
    expect(getTooltipText(menuItem(/^Send email again/))).toBe("This event is archived. Editing is disabled.");
  });
});

describe("where the keyboard goes when a request leaves the page", () => {
  it("is the request that took the place of the one that was accepted: the first goes, and the next is where the keyboard is", async () => {
    new FakeServer(three());
    renderTab({ search: QUEUE });
    await loaded();

    await decide(["Ann Kowalska"], "Accept", "Accept this request?");

    await waitFor(() => expect(openIds()).toEqual(["r2", "r3"]));
    await waitFor(() => expect(document.activeElement).toBe(openButton("r2")));
  });

  it("is the one that took the place of one in the middle", async () => {
    new FakeServer(three());
    renderTab({ search: QUEUE });
    await loaded();

    await decide(["Bo Lee"], "Accept", "Accept this request?");

    await waitFor(() => expect(openIds()).toEqual(["r1", "r3"]));
    await waitFor(() => expect(document.activeElement).toBe(openButton("r3")));
  });

  it("is the one before when the last request goes, as there is no one after it", async () => {
    new FakeServer(three());
    renderTab({ search: QUEUE });
    await loaded();

    await decide(["Cy Park"], "Reject", "Reject this request?");

    await waitFor(() => expect(openIds()).toEqual(["r1", "r2"]));
    await waitFor(() => expect(document.activeElement).toBe(openButton("r2")));
  });

  it("is the place of the first of several that go", async () => {
    new FakeServer([...three(), named("r4", "Di", "Quinn")]);
    renderTab({ search: QUEUE });
    await loaded();

    await decide(["Bo Lee", "Cy Park"], "Accept", "Accept 2 requests?");

    await waitFor(() => expect(openIds()).toEqual(["r1", "r4"]));
    await waitFor(() => expect(document.activeElement).toBe(openButton("r4")));
  });

  it("is the card when the only request goes, so the next Tab goes on from there and never from the top of the page", async () => {
    new FakeServer([named("r1", "Ann", "Kowalska")]);
    renderTab({ search: QUEUE });
    await loaded();

    await decide(["Ann Kowalska"], "Accept", "Accept this request?");

    expect(await screen.findByText("Nothing is waiting for a decision")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(cardPanel()));
  });

  it("is the place of the request that was acted on when it stays on the page, as the list shows every state", async () => {
    new FakeServer(three());
    renderTab({ search: EVERY_STATE });
    await loaded();

    await decide(["Bo Lee"], "Accept", "Accept this request?");

    await screen.findByText("1 request accepted.");
    await waitFor(() => expect(document.activeElement).toBe(openButton("r2")));
  });

  it("is left where the person put it when they moved on before the answer came", async () => {
    new FakeServer(three());
    const reply = deferred<{ results: { id: string; outcome: "accepted"; attendee_id: string }[] }>();
    api.acceptRegistrations.mockReturnValue(reply.promise);
    renderTab({ search: QUEUE });
    await loaded();
    await decide(["Ann Kowalska"], "Accept", "Accept this request?");
    await waitFor(() => expect(api.acceptRegistrations).toHaveBeenCalled());

    const elsewhere = openButton("r3") as HTMLElement;
    await act(async () => {
      elsewhere.focus();
      reply.resolve({ results: [{ id: "r1", outcome: "accepted", attendee_id: "at-r1" }] });
    });

    await screen.findByText("1 request accepted.");
    expect(document.activeElement).toBe(elsewhere);
  });
});

describe("a decision never stops the work", () => {
  it("does not block or dim the list while it is read again, and the next decision can be started at once", async () => {
    const server = new FakeServer(three());
    renderTab({ search: QUEUE });
    await loaded();
    const nextRead = deferred<ReturnType<FakeServer["page"]>>();
    api.fetchRegistrations.mockImplementationOnce(() => nextRead.promise);

    await decide(["Ann Kowalska"], "Accept", "Accept this request?");

    await waitFor(() => expect(openIds()).toEqual(["r2", "r3"]));
    expect(api.fetchRegistrations).toHaveBeenCalledTimes(2);
    expect(requestsPanel().querySelector('[aria-busy="true"]')).toBeNull();
    expect(requestsPanel().querySelector(".attendees-table-wrap--loading")).toBeNull();
    tick("Bo Lee");
    expect(bulkBar()?.textContent).toContain("1 selected");
    expect(isOff(barButton("Accept"))).toBe(false);
    await act(async () => nextRead.resolve(server.page({ page: 1, pageSize: 25, status: "pending" })));
    expect(openIds()).toEqual(["r2", "r3"]);
  });

  it("drops the read that an earlier decision started when the next one has gone through: the request that was decided does not come back", async () => {
    const server = new FakeServer(three());
    renderTab({ search: QUEUE });
    await loaded();
    // The read after the first decision is slow, and saw the queue as it was before the second one.
    const slowRead = deferred<ReturnType<FakeServer["page"]>>();
    api.fetchRegistrations.mockImplementationOnce(() => slowRead.promise);

    await decide(["Ann Kowalska"], "Accept", "Accept this request?");
    await waitFor(() => expect(openIds()).toEqual(["r2", "r3"]));
    const queueBeforeTheSecond = server.page({ page: 1, pageSize: 25, status: "pending" });

    await decide(["Bo Lee"], "Accept", "Accept this request?");
    await waitFor(() => expect(openIds()).toEqual(["r3"]));
    await waitFor(() => expect(api.fetchRegistrations).toHaveBeenCalledTimes(3));

    await act(async () => slowRead.resolve(queueBeforeTheSecond));
    expect(openIds()).toEqual(["r3"]);
  });

  it("says nothing, and does not go to the login page, when the read that follows a decision fails: the change that was confirmed stays", async () => {
    new FakeServer(three());
    renderTab({ search: QUEUE });
    await loaded();
    api.fetchRegistrations.mockRejectedValueOnce(new ApiError(401, "authentication_required"));

    await decide(["Ann Kowalska"], "Accept", "Accept this request?");

    await waitFor(() => expect(api.fetchRegistrations).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(openIds()).toEqual(["r2", "r3"]);
    expect(api.goToLogin).not.toHaveBeenCalled();
    expect(reportApiError).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the server's version once it has answered: a request that arrived meanwhile is on the page", async () => {
    const server = new FakeServer(three());
    renderTab({ search: QUEUE });
    await loaded();
    server.rows = [...server.rows, named("r9", "Zed", "New")];

    await decide(["Ann Kowalska"], "Accept", "Accept this request?");

    await waitFor(() => expect(openIds()).toEqual(["r2", "r3", "r9"]));
  });
});

describe("the event of the layout", () => {
  it("is read again after an acceptance that took seats, and not after one that took none", async () => {
    const server = new FakeServer(three());
    const refreshEvent = vi.fn().mockResolvedValue(true);
    renderTab({ search: EVERY_STATE, refreshEvent });
    await loaded();
    // Everyone is accepted already, by another organiser, so nothing is taken.
    server.rows = server.rows.map((row) => ({ ...row, status: "accepted" as const }));

    await decide(["Ann Kowalska"], "Accept", "Accept this request?");

    await screen.findByText("Nobody was accepted. Skipped: 1 already accepted.");
    await act(async () => {});
    expect(refreshEvent).not.toHaveBeenCalled();
  });

  it("is not needed to decide: a page that was given no way to read it again decides all the same", async () => {
    new FakeServer(three());
    renderTab({ search: QUEUE });
    await loaded();

    await decide(["Ann Kowalska"], "Accept", "Accept this request?");

    expect(await screen.findByText("1 request accepted.")).toBeTruthy();
  });
});
