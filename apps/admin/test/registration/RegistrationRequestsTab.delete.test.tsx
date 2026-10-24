// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { EventDto } from "../../src/api/types.js";
import { reportApiError } from "../../src/connection/ConnectionStateProvider.js";
import { deferred, mockMatchMedia } from "../test-utils.js";
import { FakeServer, api, resetApi } from "./requestsApi.js";
import { EVENT, answer, cardPanel, named, openButton, openIds, renderTab, requestsPanel } from "./requestsFixtures.js";

vi.mock("../../src/api/client.js", async () => (await import("./requestsApi.js")).mockedClient());
vi.mock("../../src/connection/ConnectionStateProvider.js");
vi.mock("../../src/auth/login-navigation.js", async () => (await import("./requestsApi.js")).loginNavigationModule());
vi.mock("../../src/registration/RegistrationFieldsTab.js", async () => (await import("./requestsApi.js")).fieldsTabModule());
vi.mock("../../src/registration/RegistrationLegalTab.js", async () => (await import("./requestsApi.js")).legalTabModule());

const EVERY_STATE = "?tab=requests&status=all";
const REJECTED = "?tab=requests&status=rejected";
const ARCHIVED = { ...EVENT, archived_at: "2026-10-01T00:00:00.000Z" } as EventDto;

const mix = () => [
  named("r1", "Ann", "Kowalska"),
  named("r2", "Bo", "Lee", { status: "accepted" }),
  named("r3", "Cy", "Park", { status: "rejected" }),
  named("r4", "Di", "Quinn", { status: "rejected" }),
  named("r5", "Ed", "Ross", { status: "rejected" }),
];

const checkbox = (name: string) => screen.getByRole("checkbox", { name: `Select ${name}` });
const tick = (...names: string[]) => names.forEach((name) => fireEvent.click(checkbox(name)));
const bulkBar = () => requestsPanel().querySelector<HTMLElement>(".attendees-bulkbar");
const loaded = () => screen.findByRole("table", { name: "Requests" });
const dialogNamed = (name: string | RegExp) => screen.findByRole("dialog", { name });
const press = (dialog: HTMLElement, name: string) => fireEvent.click(within(dialog).getByRole("button", { name }));
const deleteAllButton = () => screen.queryByRole("button", { name: /^Delete all matching/ });
/** The button that deletes what the filter selects, once the list that names it is in. */
const deleteAllReady = () => screen.findByRole("button", { name: /^Delete all matching/ });

/** Ticks the requests and asks to delete them from the menu of the bulk bar. */
function askToDelete(...names: string[]) {
  tick(...names);
  fireEvent.click(within(bulkBar() as HTMLElement).getByRole("button", { name: /^More/ }));
  fireEvent.click(screen.getByRole("menuitem", { name: /^Delete requests/ }));
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

describe("deleting the selected requests", () => {
  it("asks first, says what is removed and that it cannot be undone, then deletes them and applies it at once", async () => {
    new FakeServer(mix());
    const refreshEvent = vi.fn().mockResolvedValue(true);
    renderTab({ search: EVERY_STATE, refreshEvent });
    await loaded();

    askToDelete("Ann Kowalska", "Cy Park");

    const dialog = await dialogNamed("Delete 2 requests?");
    expect(dialog.textContent).toContain("The requests and their emails are removed for good. This cannot be undone. A guest can register again with the same address.");
    expect(within(dialog).queryByText(/Erase personal data/)).toBeNull();
    expect(api.deleteRegistrations).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "Delete" }).classList.contains("at-btn--danger")).toBe(true);
    press(dialog, "Delete");

    expect(await screen.findByText("2 requests deleted.")).toBeTruthy();
    expect(api.deleteRegistrations).toHaveBeenCalledWith("evt-1", ["r1", "r3"]);
    await waitFor(() => expect(openIds()).toEqual(["r2", "r4", "r5"]));
    expect(bulkBar()).toBeNull();
    // Nobody was an attendee, so no seat was freed and the event is not read again.
    await act(async () => {});
    expect(refreshEvent).not.toHaveBeenCalled();
  });

  it("asks about one request as this request", async () => {
    new FakeServer(mix());
    renderTab({ search: EVERY_STATE });
    await loaded();

    askToDelete("Ann Kowalska");

    const dialog = await dialogNamed("Delete this request?");
    expect(dialog.textContent).toContain("The request and its emails are removed for good.");
  });

  it("says plainly that an accepted request is an attendee, and that deleting it erases the attendee too, and what that means", async () => {
    new FakeServer(mix());
    renderTab({ search: EVERY_STATE });
    await loaded();

    askToDelete("Bo Lee");

    const dialog = await dialogNamed("Delete this request?");
    const warning = within(dialog).getByText(/This request is accepted, so the guest is an attendee/).closest(".at-notice") as HTMLElement;
    expect(warning.textContent).toContain("Deleting it also erases the attendee.");
    expect(warning.textContent).toContain("The ticket stops working, the wallet pass is removed and the personal data is erased, as with Erase personal data.");
    expect(warning.textContent).toContain("Reports keep an anonymous entry.");
    expect(warning.textContent).toContain("The seat is freed, unless the guest was checked in already or the event is archived.");
  });

  it("counts the accepted ones among several, in the singular and the plural", async () => {
    new FakeServer([...mix(), named("r6", "Fay", "Stone", { status: "accepted" })]);
    renderTab({ search: EVERY_STATE });
    await loaded();

    askToDelete("Ann Kowalska", "Bo Lee");
    expect((await dialogNamed("Delete 2 requests?")).textContent).toContain("1 of these requests is accepted. Deleting an accepted request also erases the attendee.");
    press(await dialogNamed("Delete 2 requests?"), "Cancel");

    tick("Fay Stone");
    fireEvent.click(within(bulkBar() as HTMLElement).getByRole("button", { name: /^More/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Delete requests/ }));
    expect((await dialogNamed("Delete 3 requests?")).textContent).toContain("2 of these requests are accepted. Deleting an accepted request also erases the attendee.");
  });

  it("tells how many attendees were erased with the requests, and reads the event again, as the seats they held are free", async () => {
    new FakeServer(mix());
    const refreshEvent = vi.fn().mockResolvedValue(true);
    renderTab({ search: EVERY_STATE, refreshEvent });
    await loaded();

    askToDelete("Ann Kowalska", "Bo Lee");
    press(await dialogNamed("Delete 2 requests?"), "Delete");

    expect(await screen.findByText("2 requests deleted. 1 attendee erased too.")).toBeTruthy();
    await waitFor(() => expect(refreshEvent).toHaveBeenCalledTimes(1));
  });

  it("is possible on an archived event: a request to delete personal data does not expire with the event", async () => {
    new FakeServer(mix());
    renderTab({ search: EVERY_STATE, event: ARCHIVED });
    await loaded();

    askToDelete("Cy Park");
    press(await dialogNamed("Delete this request?"), "Delete");

    expect(await screen.findByText("1 request deleted.")).toBeTruthy();
    expect(api.deleteRegistrations).toHaveBeenCalledWith("evt-1", ["r3"]);
  });

  it("says that nothing was deleted when the requests were gone already", async () => {
    const server = new FakeServer(mix());
    renderTab({ search: EVERY_STATE });
    await loaded();
    server.rows = server.rows.filter((row) => row.id !== "r1");

    askToDelete("Ann Kowalska");
    press(await dialogNamed("Delete this request?"), "Delete");

    expect(await screen.findByText("Nothing was deleted. The requests were already gone.")).toBeTruthy();
    await waitFor(() => expect(openIds()).not.toContain("r1"));
  });

  it("shows the words of the app when it fails, and keeps the dialog, for the server's text is not for the screen", async () => {
    new FakeServer(mix());
    api.deleteRegistrations.mockRejectedValue(new ApiError(500, "DELETE FROM registration", "internal_error"));
    renderTab({ search: EVERY_STATE });
    await loaded();

    askToDelete("Ann Kowalska");
    press(await dialogNamed("Delete this request?"), "Delete");

    const alert = await within(await dialogNamed("Delete this request?")).findByRole("alert");
    expect(alert.textContent).toBe("Something went wrong. Try again. If it keeps happening, check System logs.");
    expect(document.body.textContent).not.toContain("DELETE FROM");
    expect(reportApiError).toHaveBeenCalledWith(500);
    expect(openIds()).toContain("r1");
  });

  it("deletes once however often the button is pressed", async () => {
    new FakeServer(mix());
    const reply = deferred<ReturnType<FakeServer["remove"]>>();
    api.deleteRegistrations.mockReturnValue(reply.promise);
    renderTab({ search: EVERY_STATE });
    await loaded();

    askToDelete("Ann Kowalska");
    const dialog = await dialogNamed("Delete this request?");
    const confirm = within(dialog).getByRole("button", { name: "Delete" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(api.deleteRegistrations).toHaveBeenCalledTimes(1);
    expect(confirm.getAttribute("aria-busy")).toBe("true");
    await act(async () => reply.resolve({ results: [{ id: "r1", outcome: "deleted" }], deleted: 1, attendees_erased: 0, wallet_pending: 0 }));
    expect(await screen.findByText("1 request deleted.")).toBeTruthy();
  });

  it("puts the keyboard on the request that took the place of the one that was deleted", async () => {
    new FakeServer(mix());
    renderTab({ search: EVERY_STATE });
    await loaded();
    tick("Ann Kowalska");
    fireEvent.click(within(bulkBar() as HTMLElement).getByRole("button", { name: /^More/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Delete requests/ }));
    const confirm = within(await dialogNamed("Delete this request?")).getByRole("button", { name: "Delete" });
    confirm.focus();
    fireEvent.click(confirm);

    await waitFor(() => expect(openIds()).toEqual(["r2", "r3", "r4", "r5"]));
    await waitFor(() => expect(document.activeElement).toBe(openButton("r2")));
  });
});

describe("a wallet pass that is still at the provider", () => {
  const erased = {
    results: [{ id: "r2", outcome: "deleted" as const, attendee_id: "att-2" }],
    deleted: 1,
    attendees_erased: 1,
    wallet_pending: 1,
  };

  async function deleteTheAcceptedOne() {
    new FakeServer(mix());
    api.deleteRegistrations.mockResolvedValue(erased);
    renderTab({ search: EVERY_STATE });
    await loaded();
    askToDelete("Bo Lee");
    press(await dialogNamed("Delete this request?"), "Delete");
    return dialogNamed("Personal data erased");
  }

  it("says so in a dialog of its own, besides the toast that tells what was deleted", async () => {
    const dialog = await deleteTheAcceptedOne();

    expect(dialog.textContent).toContain("Everything personal inside Admitto is gone.");
    expect(dialog.textContent).toContain("The wallet pass is still at the provider.");
    expect(await screen.findByText("1 request deleted. 1 attendee erased too.")).toBeTruthy();
  });

  it("tries again through the erasure of the attendee that was erased, and closes when it worked", async () => {
    const dialog = await deleteTheAcceptedOne();
    api.bulkEraseAttendees.mockResolvedValue({ erased: 0, already_erased: 1, not_found: 0, wallet_pending: 0, wallet_removed_ids: ["att-2"] });

    press(dialog, "Try again");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Personal data erased" })).toBeNull());
    expect(api.bulkEraseAttendees).toHaveBeenCalledWith("evt-1", ["att-2"]);
    expect(await screen.findByText("Wallet pass deleted")).toBeTruthy();
  });

  it("stays open, with the number that is left, when the pass is still there", async () => {
    const dialog = await deleteTheAcceptedOne();
    api.bulkEraseAttendees.mockResolvedValue({ erased: 0, already_erased: 1, not_found: 0, wallet_pending: 1, wallet_removed_ids: [] });

    press(dialog, "Try again");

    await waitFor(() => expect(api.bulkEraseAttendees).toHaveBeenCalledTimes(1));
    expect((await dialogNamed("Personal data erased")).textContent).toContain("The wallet pass is still at the provider.");
  });

  it("says in the words of the app that it could not try again, and keeps the dialog", async () => {
    const dialog = await deleteTheAcceptedOne();
    api.bulkEraseAttendees.mockRejectedValue(new ApiError(500, "boom", "internal_error"));

    press(dialog, "Try again");

    const alert = await within(await dialogNamed("Personal data erased")).findByRole("alert");
    expect(alert.textContent).toBe("Something went wrong. Try again. If it keeps happening, check System logs.");
  });
});

describe("deleting everything a filter selects", () => {
  it("is not offered while no filter is set, and a list of every state has none", async () => {
    new FakeServer(mix());
    renderTab({ search: EVERY_STATE });
    await loaded();

    expect(deleteAllButton()).toBeNull();
  });

  it("is offered with how many it takes once a state is chosen, and with a search as well", async () => {
    new FakeServer(mix());
    renderTab({ search: REJECTED });
    await loaded();

    expect(deleteAllButton()?.textContent).toBe("Delete all matching (3)");

    fireEvent.change(screen.getByRole("textbox", { name: "Search requests by name or email" }), { target: { value: "cy" } });
    await waitFor(() => expect(deleteAllButton()?.textContent).toBe("Delete all matching (1)"));
  });

  it("is not offered when nothing matches, and not when the server did not name the requests because too many match", async () => {
    api.fetchRegistrations.mockResolvedValue(answer([named("r1", "Ann", "Kowalska", { status: "rejected" })], 600, 1, 25, { selection_digest: null }));
    renderTab({ search: REJECTED });
    await loaded();

    expect(deleteAllButton()).toBeNull();

    cleanup();
    api.fetchRegistrations.mockResolvedValue(answer([], 0, 1, 25, { selection_digest: "a".repeat(64) }));
    renderTab({ search: REJECTED });
    await screen.findByText("No matches");

    expect(deleteAllButton()).toBeNull();
  });

  it("asks first, with the numbers and the filter in the words of the list, and never the words of a search", async () => {
    new FakeServer(mix());
    renderTab({ search: REJECTED });
    await loaded();
    fireEvent.change(screen.getByRole("textbox", { name: "Search requests by name or email" }), { target: { value: "park" } });
    await waitFor(() => expect(deleteAllButton()?.textContent).toBe("Delete all matching (1)"));

    fireEvent.click(await deleteAllReady());

    const dialog = await dialogNamed("Delete the request that matches?");
    expect(dialog.textContent).toContain("Every request that matches your filter is removed for good, on every page and not only the ones you see. This cannot be undone.");
    expect(within(dialog).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["State: Rejected", "Matching your search"]);
    expect(dialog.textContent).not.toContain("park");
    expect(within(dialog).getByRole("button", { name: "Delete 1" }).classList.contains("at-btn--danger")).toBe(true);
  });

  it("sends the filter of the list with its total and the name the list gave the requests, then empties the list, tells how many went and hands the keyboard to the card", async () => {
    const server = new FakeServer(mix());
    renderTab({ search: REJECTED });
    await loaded();
    const named3 = server.page({ page: 1, pageSize: 25, status: "rejected" }).selection_digest;

    fireEvent.click(await deleteAllReady());
    const dialog = await dialogNamed("Delete all 3 requests that match?");
    expect(within(dialog).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["State: Rejected"]);
    const confirm = within(dialog).getByRole("button", { name: "Delete 3" });
    confirm.focus();
    fireEvent.click(confirm);

    expect(await screen.findByText("3 requests deleted.")).toBeTruthy();
    expect(api.deleteRegistrationsByFilter).toHaveBeenCalledWith("evt-1", { status: "rejected", expected: 3, selectionDigest: named3 });
    expect(await screen.findByText("No matches")).toBeTruthy();
    expect(openIds()).toEqual([]);
    await waitFor(() => expect(document.activeElement).toBe(cardPanel()));
    expect(deleteAllButton()).toBeNull();
  });

  it("reads the event again when it erased attendees, as their seats are free, and not when it erased none", async () => {
    new FakeServer(mix());
    const refreshEvent = vi.fn().mockResolvedValue(true);
    renderTab({ search: "?tab=requests&status=accepted", refreshEvent });
    await loaded();
    fireEvent.click(await deleteAllReady());
    press(await dialogNamed("Delete the request that matches?"), "Delete 1");

    expect(await screen.findByText("1 request deleted. 1 attendee erased too.")).toBeTruthy();
    await waitFor(() => expect(refreshEvent).toHaveBeenCalledTimes(1));

    cleanup();
    refreshEvent.mockClear();
    renderTab({ search: REJECTED, refreshEvent });
    await loaded();
    fireEvent.click(await deleteAllReady());
    press(await dialogNamed("Delete all 3 requests that match?"), "Delete 3");

    expect(await screen.findByText("3 requests deleted.")).toBeTruthy();
    await act(async () => {});
    expect(refreshEvent).not.toHaveBeenCalled();
  });

  it("says that accepted requests among them are attendees too when no state is set, and that all are when the state is Accepted, and nothing of it for a state without them", async () => {
    new FakeServer(mix());
    renderTab({ search: EVERY_STATE });
    await loaded();
    fireEvent.change(screen.getByRole("textbox", { name: "Search requests by name or email" }), { target: { value: "o" } });
    await waitFor(() => expect(deleteAllButton()).not.toBeNull());
    fireEvent.click(await deleteAllReady());
    expect((await dialogNamed(/^Delete (all \d+ requests that match|the request that matches)\?/)).textContent).toContain(
      "Some of these requests may be accepted. Deleting an accepted request also erases the attendee.",
    );
    cleanup();

    renderTab({ search: "?tab=requests&status=accepted" });
    await loaded();
    fireEvent.click(await deleteAllReady());
    expect((await dialogNamed("Delete the request that matches?")).textContent).toContain("All of these requests are accepted. Deleting them also erases their attendees.");
    cleanup();

    renderTab({ search: REJECTED });
    await loaded();
    fireEvent.click(await deleteAllReady());
    expect((await dialogNamed("Delete all 3 requests that match?")).textContent).not.toContain("Erase personal data");
  });

  it("is refused when the number is not the one the list showed: nothing is deleted, the words say so, the list is read again and the dialog shows what it is now", async () => {
    const server = new FakeServer(mix());
    renderTab({ search: REJECTED });
    await loaded();
    fireEvent.click(await deleteAllReady());
    const dialog = await dialogNamed("Delete all 3 requests that match?");
    // Someone else's request was rejected after the list was read.
    server.rows = [...server.rows, named("r6", "Fay", "Stone", { status: "rejected" })];

    press(dialog, "Delete 3");

    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toBe("The list changed since you looked at it, so nothing was deleted. Reload the list and check what is selected.");
    expect(server.rows.filter((row) => row.status === "rejected")).toHaveLength(4);
    await dialogNamed("Delete all 4 requests that match?");
    expect(deleteAllButton()?.textContent).toBe("Delete all matching (4)");
    // It can be confirmed again, now that it names what is there.
    press(await dialogNamed("Delete all 4 requests that match?"), "Delete 4");
    expect(await screen.findByText("4 requests deleted.")).toBeTruthy();
  });

  it("is refused when the same number is other requests, with the same words", async () => {
    const server = new FakeServer(mix());
    renderTab({ search: REJECTED });
    await loaded();
    fireEvent.click(await deleteAllReady());
    const dialog = await dialogNamed("Delete all 3 requests that match?");
    // One left the filter and another joined it: the number stays at three.
    server.rows = [...server.rows.filter((row) => row.id !== "r3"), named("r6", "Fay", "Stone", { status: "rejected" })];

    press(dialog, "Delete 3");

    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("The list changed since you looked at it, so nothing was deleted.");
    expect(server.rows.filter((row) => row.status === "rejected")).toHaveLength(3);
    await waitFor(() => expect(api.fetchRegistrations.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("closes by itself, leaving the list to say so, when the list that was read again has nothing that matches, and does not come back when requests match again", async () => {
    const server = new FakeServer(mix());
    renderTab({ search: REJECTED });
    await loaded();
    fireEvent.click(await deleteAllReady());
    const dialog = await dialogNamed("Delete all 3 requests that match?");
    const rejected = server.rows.filter((row) => row.status === "rejected");
    server.rows = server.rows.filter((row) => row.status !== "rejected");

    press(dialog, "Delete 3");

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("No matches")).toBeTruthy();

    // Requests that match are there again, and the next read brings them: nobody asked for a deletion, so nothing opens.
    server.rows = [...server.rows, ...rejected];
    fireEvent.change(screen.getByRole("textbox", { name: "Search requests by name or email" }), { target: { value: "cy" } });
    await waitFor(() => expect(deleteAllButton()?.textContent).toBe("Delete all matching (1)"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows nothing of the failure of a dialog that was closed when the next one opens", async () => {
    const server = new FakeServer(mix());
    renderTab({ search: REJECTED });
    await loaded();
    fireEvent.click(await deleteAllReady());
    const first = await dialogNamed("Delete all 3 requests that match?");
    server.rows = [...server.rows, named("r6", "Fay", "Stone", { status: "rejected" })];
    press(first, "Delete 3");
    await within(first).findByRole("alert");

    press(await dialogNamed("Delete all 4 requests that match?"), "Cancel");
    fireEvent.click(await deleteAllReady());

    expect(within(await dialogNamed("Delete all 4 requests that match?")).queryByRole("alert")).toBeNull();
  });

  it.each([
    ["too_many_registrations", 422, "Too many registrations match to delete them at once. Narrow the filter, or select fewer, and try again."],
    [
      "too_many_accepted",
      422,
      "Too many accepted guests are selected to delete at once while wallet passes are in use. Select fewer accepted guests and try again.",
    ],
  ])("says %s in the words of the app, and keeps the dialog", async (code, status, words) => {
    new FakeServer(mix());
    api.deleteRegistrationsByFilter.mockRejectedValue(new ApiError(status, code, code));
    renderTab({ search: REJECTED });
    await loaded();
    fireEvent.click(await deleteAllReady());
    press(await dialogNamed("Delete all 3 requests that match?"), "Delete 3");

    const alert = await within(await dialogNamed("Delete all 3 requests that match?")).findByRole("alert");
    expect(alert.textContent).toBe(words);
  });

  it("is hidden while the list is read again for another filter, so that it never names a filter the list no longer shows", async () => {
    new FakeServer(mix());
    renderTab({ search: REJECTED });
    await loaded();
    expect(deleteAllButton()).not.toBeNull();
    const next = deferred<ReturnType<FakeServer["page"]>>();
    api.fetchRegistrations.mockImplementationOnce(() => next.promise);

    fireEvent.click(screen.getByRole("radio", { name: /^Waiting for a decision/ }));

    await waitFor(() => expect(api.fetchRegistrations).toHaveBeenCalledTimes(2));
    expect(deleteAllButton()).toBeNull();
    await act(async () => next.resolve(answer([named("r1", "Ann", "Kowalska")], 1, 1, 25, { selection_digest: "b".repeat(64) })));
    await waitFor(() => expect(deleteAllButton()?.textContent).toBe("Delete all matching (1)"));
  });

  it("is hidden once an action changed what the filter selects, until the list that is read again brings its new name", async () => {
    const server = new FakeServer([named("r1", "Ann", "Kowalska"), named("r2", "Bo", "Lee"), named("r3", "Cy", "Park")]);
    renderTab({ search: "?tab=requests&status=pending" });
    await loaded();
    expect(deleteAllButton()?.textContent).toBe("Delete all matching (3)");
    const next = deferred<ReturnType<FakeServer["page"]>>();
    api.fetchRegistrations.mockImplementationOnce(() => next.promise);
    tick("Ann Kowalska");
    fireEvent.click(within(bulkBar() as HTMLElement).getByRole("button", { name: "Accept" }));
    press(await dialogNamed("Accept this request?"), "Accept");

    await waitFor(() => expect(openIds()).toEqual(["r2", "r3"]));
    // What the filter selects is two now, and the name the list gave was of three: nothing can be deleted by it yet.
    expect(deleteAllButton()).toBeNull();
    await act(async () => next.resolve(server.page({ page: 1, pageSize: 25, status: "pending" })));
    await waitFor(() => expect(deleteAllButton()?.textContent).toBe("Delete all matching (2)"));
  });
});
