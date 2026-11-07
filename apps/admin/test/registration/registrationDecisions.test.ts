import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { AcceptRegistrationResultDto, RegistrationListItemDto } from "../../src/api/types.js";
import {
  ACCEPTABLE_STATUSES,
  REJECTABLE_STATUSES,
  acceptChange,
  acceptToast,
  acceptedAmong,
  canAccept,
  canReject,
  canRetryMail,
  decisionErrorMessage,
  deleteChange,
  deleteToast,
  describeFilter,
  firstActedIndex,
  hasFilter,
  matchingTarget,
  notEnoughSeatsMessage,
  rejectChange,
  rejectToast,
  retryChange,
  retryToast,
  seatsNeeded,
  selectionActions,
  withMatchingDeleted,
  withRowsChanged,
} from "../../src/registration/registrationDecisions.js";
import { REQUEST_PAGE_SIZE_OPTIONS, type RequestsAnswer } from "../../src/registration/useRegistrationRequests.js";
import { FAILED_MAIL, request } from "./requestsFixtures.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** The quoted words of the list a server file writes as `new Set([...])`. */
function serverSet(file: string, name: string): string[] {
  const source = readFileSync(join(ROOT, file), "utf8");
  const found = new RegExp(`const ${name}: ReadonlySet<string> = new Set\\(\\[([^\\]]*)\\]\\)`).exec(source);
  expect(found, `${name} in ${file}`).not.toBeNull();
  return [...(found?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((match) => match[1] as string);
}

function listAnswer(items: RegistrationListItemDto[], over: Partial<RequestsAnswer> = {}): RequestsAnswer {
  return { items, total: items.length, page: 1, filtersActive: false, pastTheEnd: false, query: {}, selectionDigest: null, ...over };
}

describe("what the screen may offer is what the server accepts", () => {
  it("accepts a request from the states the server admits, and rejects from the ones it turns down", () => {
    expect([...ACCEPTABLE_STATUSES].sort()).toEqual(serverSet("packages/tickets/src/registration-decisions.ts", "admittableStatuses").sort());
    expect([...REJECTABLE_STATUSES].sort()).toEqual(serverSet("packages/tickets/src/registration-decisions.ts", "rejectableStatuses").sort());
  });

  it("never asks for more requests at once than the server takes: a whole page of the biggest size is one action", () => {
    const source = readFileSync(join(ROOT, "packages/tickets/src/registration-list.ts"), "utf8");
    const cap = Number(/export const MAX_REGISTRATION_BULK_IDS = (\d+);/.exec(source)?.[1]);
    expect(Number.isInteger(cap)).toBe(true);
    expect(Math.max(...REQUEST_PAGE_SIZE_OPTIONS)).toBeLessThanOrEqual(cap);
  });

  it("offers a decision for exactly the states that can take it", () => {
    const states = ["awaiting_email", "pending", "waitlist", "accepted", "rejected"] as const;
    expect(states.filter((status) => canAccept({ status }))).toEqual(["pending", "waitlist", "rejected"]);
    expect(states.filter((status) => canReject({ status }))).toEqual(["pending", "waitlist"]);
  });

  it("sends an email again only where the server says it can, and never guesses it", () => {
    expect(canRetryMail(request("a", { last_mail: FAILED_MAIL }))).toBe(true);
    expect(canRetryMail(request("b", { last_mail: { ...FAILED_MAIL, can_retry: false } }))).toBe(false);
    expect(canRetryMail(request("c"))).toBe(false);
  });
});

describe("a selection", () => {
  const rows = [
    request("p", { status: "pending", last_mail: FAILED_MAIL }),
    request("w", { status: "waitlist" }),
    request("r", { status: "rejected" }),
    request("a", { status: "accepted" }),
    request("e", { status: "awaiting_email" }),
  ];

  it("is sorted into the requests each action applies to", () => {
    const actions = selectionActions(rows);

    expect(actions.accept.map((row) => row.id)).toEqual(["p", "w", "r"]);
    expect(actions.reject.map((row) => row.id)).toEqual(["p", "w"]);
    expect(actions.retry.map((row) => row.id)).toEqual(["p"]);
  });

  it("counts the seats the guests take: each one and each person they bring", () => {
    expect(seatsNeeded([])).toBe(0);
    expect(seatsNeeded([request("a"), request("b")])).toBe(2);
    expect(seatsNeeded([request("a", { companions_count: 1 }), request("b"), request("c", { companions_count: 2 })])).toBe(6);
  });

  it("counts the accepted ones, whose attendees a deletion erases", () => {
    expect(acceptedAmong(rows)).toBe(1);
    expect(acceptedAmong([])).toBe(0);
  });
});

describe("the words of a refusal for seats", () => {
  it("names the seats that are free and the seats that are needed", () => {
    expect(notEnoughSeatsMessage({ free: 2, needed: 10 })).toBe(
      "Only 2 seats are free, and the guests you chose need 10 (a companion takes a seat too). Nobody was accepted. Choose fewer guests, or raise the event's capacity first.",
    );
  });

  it("says one seat in the singular, and no seat as none", () => {
    expect(notEnoughSeatsMessage({ free: 1, needed: 3 })).toContain("Only 1 seat is free,");
    expect(notEnoughSeatsMessage({ free: 0, needed: 3 })).toContain("No seats are free,");
  });

  it("uses the numbers of a 409 from the server, and the words of the app when it gave none", () => {
    const withSeats = new ApiError(409, "not_enough_seats", "not_enough_seats", undefined, undefined, undefined, { free: 2, needed: 5 });
    expect(decisionErrorMessage(withSeats, "fallback")).toContain("Only 2 seats are free, and the guests you chose need 5");

    const withoutSeats = new ApiError(409, "not_enough_seats", "not_enough_seats");
    expect(decisionErrorMessage(withoutSeats, "fallback")).toContain("not enough free seats");
  });

  it("shows the words of the app for a code it knows, and the fallback for what it must not show: an exception, or something that is not an API error", () => {
    expect(decisionErrorMessage(new ApiError(409, "registration_count_changed", "registration_count_changed"), "fallback")).toContain("nothing was deleted");
    expect(decisionErrorMessage(new ApiError(500, "PrismaClientKnownRequestError at src/db.ts:12:3", undefined), "Could not do it.")).toBe("Could not do it.");
    expect(decisionErrorMessage(new Error("boom"), "Could not do it.")).toBe("Could not do it.");
  });
});

describe("what a toast says after an action", () => {
  const accepted = (id: string): AcceptRegistrationResultDto => ({ id, outcome: "accepted", attendee_id: `at-${id}` });

  it("tells how many were accepted, as a success when all were", () => {
    expect(acceptToast([accepted("a")])).toEqual({ message: "1 request accepted.", variant: "success" });
    expect(acceptToast([accepted("a"), accepted("b")])).toEqual({ message: "2 requests accepted.", variant: "success" });
  });

  it("says why some were left out, each reason in its own words, and warns", () => {
    const toast = acceptToast([
      accepted("a"),
      { id: "b", outcome: "already_decided" },
      { id: "c", outcome: "awaiting_email" },
      { id: "d", outcome: "already_attendee" },
      { id: "e", outcome: "gone" },
    ]);

    expect(toast.variant).toBe("warning");
    expect(toast.message).toBe(
      "1 request accepted. Skipped: 1 already accepted, 1 not confirmed by the guest yet, 1 removed because an attendee has the address, 1 no longer there.",
    );
  });

  it("says that nobody was accepted when none was", () => {
    expect(acceptToast([{ id: "a", outcome: "already_decided" }])).toEqual({
      message: "Nobody was accepted. Skipped: 1 already accepted.",
      variant: "warning",
    });
  });

  it("tells how many were rejected, and that the guests are emailed only when they are", () => {
    const results = [{ id: "a", outcome: "rejected" as const }];

    expect(rejectToast(results, false)).toEqual({ message: "1 request rejected.", variant: "success" });
    expect(rejectToast(results, true).message).toBe("1 request rejected. The guests are emailed.");
  });

  it("says why some were not rejected", () => {
    const toast = rejectToast(
      [
        { id: "a", outcome: "rejected" },
        { id: "b", outcome: "already_decided" },
        { id: "c", outcome: "awaiting_email" },
        { id: "d", outcome: "gone" },
      ],
      false,
    );

    expect(toast).toEqual({
      message: "1 request rejected. Skipped: 1 already decided, 1 not confirmed by the guest yet, 1 no longer there.",
      variant: "warning",
    });
    expect(rejectToast([{ id: "b", outcome: "already_decided" }], false)).toEqual({
      message: "Nobody was rejected. Skipped: 1 already decided.",
      variant: "warning",
    });
  });

  it("tells how many emails will be sent again, and why some will not", () => {
    expect(retryToast([{ id: "a", outcome: "retried" }])).toEqual({ message: "1 email will be sent again.", variant: "success" });
    expect(retryToast([{ id: "a", outcome: "retried" }, { id: "b", outcome: "retried" }]).message).toBe("2 emails will be sent again.");
    expect(retryToast([{ id: "a", outcome: "retried" }, { id: "b", outcome: "not_retryable" }, { id: "c", outcome: "gone" }])).toEqual({
      message: "1 email will be sent again. Skipped: 1 cannot be sent again, 1 no longer there.",
      variant: "warning",
    });
    expect(retryToast([{ id: "b", outcome: "not_retryable" }])).toEqual({ message: "No email was sent again. Skipped: 1 cannot be sent again.", variant: "warning" });
  });

  it("tells how many were deleted, and how many attendees went with them", () => {
    expect(deleteToast({ deleted: 1, attendees_erased: 0 })).toEqual({ message: "1 request deleted.", variant: "success" });
    expect(deleteToast({ deleted: 3, attendees_erased: 1 }).message).toBe("3 requests deleted. 1 attendee erased too.");
    expect(deleteToast({ deleted: 3, attendees_erased: 2 }).message).toBe("3 requests deleted. 2 attendees erased too.");
    expect(deleteToast({ deleted: 0, attendees_erased: 0 })).toEqual({ message: "Nothing was deleted. The requests were already gone.", variant: "info" });
  });

  it("never carries a name or an address: only counts", () => {
    const every = [
      acceptToast([accepted("ann@example.com")]),
      rejectToast([{ id: "ann@example.com", outcome: "rejected" }], true),
      retryToast([{ id: "ann@example.com", outcome: "retried" }]),
      deleteToast({ deleted: 1, attendees_erased: 1 }),
    ];
    for (const toast of every) expect(toast.message).not.toMatch(/ann|@|example/i);
  });
});

describe("what an action confirmed changes on the page", () => {
  const items = [
    request("r1", { last_mail: FAILED_MAIL }),
    request("r2", { status: "waitlist" }),
    request("r3"),
    request("r4", { status: "rejected" }),
  ];

  it("takes an accepted request to accepted, and a request that is gone or replaced by an attendee off the page", () => {
    const change = acceptChange([
      { id: "r1", outcome: "accepted", attendee_id: "at1" },
      { id: "r2", outcome: "already_decided" },
      { id: "r3", outcome: "gone" },
      { id: "r4", outcome: "already_attendee" },
      { id: "r9", outcome: "awaiting_email" },
    ]);

    expect([...change.moved]).toEqual([["r1", "accepted"], ["r2", "accepted"]]);
    expect([...change.removed].sort()).toEqual(["r3", "r4"]);
    expect(change.retried.size).toBe(0);
  });

  it("takes a rejected request to rejected, and leaves one that was decided already as it is: it does not say which way", () => {
    const change = rejectChange([
      { id: "r1", outcome: "rejected" },
      { id: "r2", outcome: "already_decided" },
      { id: "r3", outcome: "gone" },
      { id: "r4", outcome: "awaiting_email" },
    ]);

    expect([...change.moved]).toEqual([["r1", "rejected"]]);
    expect([...change.removed]).toEqual(["r3"]);
  });

  it("takes a deleted request, and one that was gone already, off the page", () => {
    expect([...deleteChange([{ id: "r1", outcome: "deleted" }, { id: "r2", outcome: "gone" }, { id: "r3", outcome: "deleted", attendee_id: "at" }]).removed]).toEqual(["r1", "r2", "r3"]);
  });

  it("marks an email that was queued again, and takes a request that is gone off the page", () => {
    const change = retryChange([{ id: "r1", outcome: "retried" }, { id: "r2", outcome: "not_retryable" }, { id: "r3", outcome: "gone" }]);

    expect([...change.retried]).toEqual(["r1"]);
    expect([...change.removed]).toEqual(["r3"]);
  });

  it("removes the requests that left, and counts one fewer in all for each", () => {
    const next = withRowsChanged(listAnswer(items, { total: 40 }), { removed: new Set(["r2", "r3"]), moved: new Map(), retried: new Set() });

    expect(next.items.map((row) => row.id)).toEqual(["r1", "r4"]);
    expect(next.total).toBe(38);
  });

  it("keeps a request that moved to another state when the list shows every state, with its new state", () => {
    const next = withRowsChanged(listAnswer(items), { removed: new Set(), moved: new Map([["r3", "accepted" as const]]), retried: new Set() });

    expect(next.items.find((row) => row.id === "r3")?.status).toBe("accepted");
    expect(next.total).toBe(4);
  });

  it("takes a request that moved to another state off a list that shows one state only, as the server's next answer would", () => {
    const pending = listAnswer([request("r1"), request("r2")], { total: 2, filtersActive: true, query: { status: "pending" } });

    const next = withRowsChanged(pending, { removed: new Set(), moved: new Map([["r1", "accepted" as const]]), retried: new Set() });

    expect(next.items.map((row) => row.id)).toEqual(["r2"]);
    expect(next.total).toBe(1);
  });

  it("keeps a request that moved into the state the list shows", () => {
    const rejected = listAnswer([request("r1", { status: "rejected" })], { query: { status: "rejected" } });

    const next = withRowsChanged(rejected, { removed: new Set(), moved: new Map([["r1", "rejected" as const]]), retried: new Set() });

    expect(next.items).toHaveLength(1);
  });

  it("drops the name of the requests a filter selects once the selection changed, and keeps it when only an email was queued again", () => {
    const named = listAnswer(items, { selectionDigest: "a".repeat(64) });

    expect(withRowsChanged(named, { removed: new Set(["r1"]), moved: new Map(), retried: new Set() }).selectionDigest).toBeNull();
    expect(withRowsChanged(named, { removed: new Set(), moved: new Map([["r1", "accepted" as const]]), retried: new Set() }).selectionDigest).toBeNull();
    expect(withRowsChanged(named, { removed: new Set(), moved: new Map(), retried: new Set(["r1"]) }).selectionDigest).toBe("a".repeat(64));
  });

  it("shows an email that was queued again as waiting, with nothing left to send again", () => {
    const next = withRowsChanged(listAnswer(items), { removed: new Set(), moved: new Map(), retried: new Set(["r1"]) });

    expect(next.items[0]?.last_mail).toEqual({ template_name: "registration-received", status: "queued", retryable: null, can_retry: false });
  });

  it("leaves a request without an email as it is when its email is said to be queued again", () => {
    const next = withRowsChanged(listAnswer([request("r3")]), { removed: new Set(), moved: new Map(), retried: new Set(["r3"]) });

    expect(next.items[0]?.last_mail).toBeNull();
  });

  it("is the same answer when none of its requests was touched", () => {
    const before = listAnswer(items);

    expect(withRowsChanged(before, { removed: new Set(["elsewhere"]), moved: new Map([["elsewhere", "accepted" as const]]), retried: new Set(["elsewhere"]) })).toBe(before);
  });

  it("says the page is gone when a later page lost all its requests, so that the list steps back", () => {
    const lastOfPage2 = listAnswer([request("r1")], { page: 2, total: 26 });

    const next = withRowsChanged(lastOfPage2, { removed: new Set(["r1"]), moved: new Map(), retried: new Set() });

    expect(next.items).toEqual([]);
    expect(next.total).toBe(25);
    expect(next.pastTheEnd).toBe(true);
  });

  it("does not say the first page is gone when it is empty", () => {
    const next = withRowsChanged(listAnswer([request("r1")]), { removed: new Set(["r1"]), moved: new Map(), retried: new Set() });

    expect(next.pastTheEnd).toBe(false);
    expect(next.total).toBe(0);
  });

  it("never counts below nothing", () => {
    const stale = listAnswer([request("r1"), request("r2")], { total: 1 });

    expect(withRowsChanged(stale, { removed: new Set(["r1", "r2"]), moved: new Map(), retried: new Set() }).total).toBe(0);
  });

  it("empties the page, and every page, when everything a filter selected was deleted", () => {
    const next = withMatchingDeleted(listAnswer(items, { total: 40, page: 2, selectionDigest: "a".repeat(64), query: { status: "rejected" } }));

    expect(next).toMatchObject({ items: [], total: 0, pastTheEnd: false, selectionDigest: null, query: { status: "rejected" } });
  });
});

describe("where the keyboard goes when requests leave the page", () => {
  const before = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("is the place of the first request the action was for", () => {
    expect(firstActedIndex(before, new Set(["b", "c"]))).toBe(1);
    expect(firstActedIndex(before, new Set(["a"]))).toBe(0);
  });

  it("is nowhere when none of them was on the page", () => {
    expect(firstActedIndex(before, new Set(["z"]))).toBeNull();
    expect(firstActedIndex([], new Set(["a"]))).toBeNull();
  });
});

describe("deleting everything a filter selects", () => {
  const named = "a".repeat(64);

  it("needs a filter: the server refuses one that selects everything", () => {
    expect(hasFilter({})).toBe(false);
    expect(hasFilter({ status: "rejected" })).toBe(true);
    expect(hasFilter({ olderThan: "90d" })).toBe(true);
    expect(hasFilter({ q: "ann" })).toBe(true);
  });

  it("is offered from the newest answer when a filter is set, something matches and the server named the requests", () => {
    const answer = listAnswer([request("a")], { total: 12, query: { status: "rejected", olderThan: "90d" }, selectionDigest: named });

    expect(matchingTarget(answer)).toEqual({ query: { status: "rejected", olderThan: "90d" }, total: 12, digest: named });
  });

  it("is not offered without an answer, without a filter, without the name, or when nothing matches", () => {
    expect(matchingTarget(null)).toBeNull();
    expect(matchingTarget(listAnswer([request("a")], { query: {}, selectionDigest: named }))).toBeNull();
    expect(matchingTarget(listAnswer([request("a")], { query: { status: "rejected" }, selectionDigest: null }))).toBeNull();
    expect(matchingTarget(listAnswer([], { total: 0, query: { status: "rejected" }, selectionDigest: named }))).toBeNull();
  });

  it("says what the filter selects, a line for each part, and never the words of a search", () => {
    expect(describeFilter({ status: "rejected", olderThan: "90d", q: "ann.kowalska@example.com" })).toEqual([
      "State: Rejected",
      "Registered more than 90 days ago",
      "Matching your search",
    ]);
    expect(describeFilter({ olderThan: "180d" })).toEqual(["Registered more than 6 months ago"]);
    expect(describeFilter({})).toEqual([]);
    expect(describeFilter({ q: "ann.kowalska@example.com" }).join(" ")).not.toContain("ann");
  });
});
