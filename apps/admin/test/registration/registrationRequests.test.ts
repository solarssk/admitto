import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REGISTRATION_MAIL_TEMPLATE_NAME, REGISTRATION_STATUS, EMAIL_DELIVERY_STATUS } from "@admitto/db/status";
import { describe, expect, it } from "vitest";
import type { RegistrationCountsDto } from "../../src/api/types.js";
import {
  REGISTRATION_AGE_OPTIONS,
  REQUEST_AGE_SELECT_OPTIONS,
  REQUEST_MAIL_KINDS,
  REQUEST_STATUS_ORDER,
  isRequestAge,
  defaultRequestStatus,
  isRequestStatus,
  requestAgeLabel,
  requestCompanionsLabel,
  requestGuestName,
  requestMailKind,
  requestMailTone,
  requestSearchText,
  requestStatusFromSearch,
  requestStatusLabel,
  requestStatusOptions,
  requestsTotal,
  withCount,
} from "../../src/registration/registrationRequests.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

function counts(byStatus: Partial<RegistrationCountsDto["by_status"]> = {}): RegistrationCountsDto {
  return {
    mode: "approval",
    by_status: { awaiting_email: 0, pending: 0, waitlist: 0, accepted: 0, rejected: 0, ...byStatus },
    needs_decision: byStatus.pending ?? 0,
  };
}

describe("the states the list can be limited to", () => {
  it("lists every state of the database, once, so none can be left out of the filter", () => {
    expect([...REQUEST_STATUS_ORDER].sort()).toEqual([...REGISTRATION_STATUS].sort());
  });

  it("starts with what waits for a decision and ends with the requests whose address is not confirmed", () => {
    expect(REQUEST_STATUS_ORDER[0]).toBe("pending");
    expect(REQUEST_STATUS_ORDER.at(-1)).toBe("awaiting_email");
  });

  it("names a state as the badge of a row does", () => {
    expect(requestStatusLabel("pending")).toBe("Waiting for a decision");
    expect(requestStatusLabel("awaiting_email")).toBe("Awaiting email");
  });

  it("reads the state from the address, every state only when it says so, and anything it does not know as nothing said", () => {
    expect(requestStatusFromSearch(new URLSearchParams("tab=requests&status=pending"))).toBe("pending");
    expect(requestStatusFromSearch(new URLSearchParams("status=waitlist"))).toBe("waitlist");
    expect(requestStatusFromSearch(new URLSearchParams("status=all"))).toBe("all");
    // Not a state: the tab opens on what it opens on (defaultRequestStatus), as for an address without one.
    expect(requestStatusFromSearch(new URLSearchParams("status=nope"))).toBeNull();
    expect(requestStatusFromSearch(new URLSearchParams("status="))).toBeNull();
    expect(requestStatusFromSearch(new URLSearchParams(""))).toBeNull();
    expect(isRequestStatus(null)).toBe(false);
    expect(isRequestStatus("accepted")).toBe(true);
  });

  it("offers every state with the number of requests in it once the numbers are known, and the sum for all", () => {
    const options = requestStatusOptions(counts({ pending: 4, waitlist: 3, accepted: 120, rejected: 2, awaiting_email: 11 }));

    expect(options.map((option) => [option.id, option.label])).toEqual([
      ["all", "All statuses (140)"],
      ["pending", "Waiting for a decision (4)"],
      ["waitlist", "Waiting list (3)"],
      ["accepted", "Accepted (120)"],
      ["rejected", "Rejected (2)"],
      ["awaiting_email", "Awaiting email (11)"],
    ]);
  });

  it("offers the states without numbers while the numbers are unknown", () => {
    expect(requestStatusOptions(null).map((option) => option.label)).toEqual([
      "All statuses",
      "Waiting for a decision",
      "Waiting list",
      "Accepted",
      "Rejected",
      "Awaiting email",
    ]);
  });
});

describe("the age filter", () => {
  /** The server's closed list, read from its source: the admin app may not import `@admitto/tickets`, whose root pulls Prisma into the browser bundle. */
  function serverAgeFilters(): string[] {
    const source = readFileSync(join(ROOT, "packages/tickets/src/registration-list.ts"), "utf8");
    const list = /export const REGISTRATION_AGE_FILTERS = \[([^\]]*)\] as const;/.exec(source)?.[1] ?? "";
    return [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
  }

  it("offers exactly the values the server accepts", () => {
    expect(serverAgeFilters().length).toBeGreaterThan(0);
    expect(REGISTRATION_AGE_OPTIONS.map((option) => option.id)).toEqual(serverAgeFilters());
  });

  it("puts any time first, and knows its own values", () => {
    expect(REQUEST_AGE_SELECT_OPTIONS[0]).toMatchObject({ id: "any", label: "Any time" });
    expect(REQUEST_AGE_SELECT_OPTIONS).toHaveLength(REGISTRATION_AGE_OPTIONS.length + 1);
    expect(isRequestAge("any")).toBe(true);
    expect(isRequestAge("7d")).toBe(true);
    expect(isRequestAge("2d")).toBe(false);
  });
});

describe("the search text", () => {
  it("is trimmed, and runs of white space become one space", () => {
    expect(requestSearchText("  ann   kowalska \n")).toBe("ann kowalska");
    expect(requestSearchText("")).toBe("");
  });

  it("loses what the server refuses: control characters, zero-width characters and direction marks", () => {
    // Built from code points: a literal zero-width or direction character in a source file is itself a finding (Sonar S6389).
    const zeroWidth = String.fromCodePoint(0x200b);
    const override = String.fromCodePoint(0x202e);
    const pop = String.fromCodePoint(0x202c);
    const nul = String.fromCodePoint(0);
    const bell = String.fromCodePoint(7);
    const noBreakSpace = String.fromCodePoint(0xa0);
    expect(requestSearchText(`ann${zeroWidth}@example.com`)).toBe("ann @example.com");
    expect(requestSearchText(`${override}ann${pop}`)).toBe("ann");
    expect(requestSearchText(`a${nul}b${bell}c`)).toBe("a b c");
    expect(requestSearchText(`ann${noBreakSpace}kowalska`)).toBe("ann kowalska");
  });

  it("keeps the first eight words and the first 254 characters, which is all the server reads", () => {
    expect(requestSearchText("a b c d e f g h i j")).toBe("a b c d e f g h");
    expect(requestSearchText("x".repeat(300))).toHaveLength(254);
    // A character outside the basic plane counts once, not as its two halves.
    expect(Array.from(requestSearchText("😀".repeat(300)))).toHaveLength(254);
  });
});

describe("what a row says", () => {
  it("names the guest, and nothing is left of an empty part", () => {
    expect(requestGuestName({ first_name: "Ann", last_name: "Kowalska" })).toBe("Ann Kowalska");
    expect(requestGuestName({ first_name: "Ann", last_name: "" })).toBe("Ann");
  });

  it("marks a guest who brings someone with +1, and a guest who comes alone with nothing", () => {
    expect(requestCompanionsLabel(0)).toBeNull();
    expect(requestCompanionsLabel(1)).toBe("+1");
    expect(requestCompanionsLabel(2)).toBe("+2");
  });

  it("names every mail the queue can hold, and a mail the list does not know is a build error", () => {
    expect([...REQUEST_MAIL_KINDS].sort()).toEqual([...REGISTRATION_MAIL_TEMPLATE_NAME].sort());
    expect(requestMailKind("ticket")).toBe("Ticket");
    expect(requestMailKind("registration-confirm")).toBe("Address confirmation");
  });

  it.each(EMAIL_DELIVERY_STATUS.map((status) => [status]))("draws a mail that is %s with a badge", (status) => {
    const tone = requestMailTone({ status, retryable: null });
    expect(tone.label.length).toBeGreaterThan(0);
    expect(["ok", "warn", "error", "neutral"]).toContain(tone.variant);
  });

  it("tells a mail that went out, one that waits and one that failed apart, and a failure the worker tries again from a final one", () => {
    expect(requestMailTone({ status: "sent", retryable: null })).toEqual({ label: "Sent", variant: "ok" });
    expect(requestMailTone({ status: "queued", retryable: null })).toEqual({ label: "Pending", variant: "warn" });
    expect(requestMailTone({ status: "failed", retryable: false })).toEqual({ label: "Failed", variant: "error" });
    expect(requestMailTone({ status: "failed", retryable: null })).toEqual({ label: "Failed", variant: "error" });
    expect(requestMailTone({ status: "failed", retryable: true })).toEqual({ label: "Retrying", variant: "warn" });
    expect(requestMailTone({ status: "bounced", retryable: null })).toEqual({ label: "Bounced", variant: "error" });
    expect(requestMailTone({ status: "cancelled", retryable: null })).toEqual({ label: "Cancelled", variant: "neutral" });
  });
});

describe("what the tab opens on", () => {
  it("is the requests that wait for a decision when staff decide by hand and some wait", () => {
    expect(defaultRequestStatus(counts({ pending: 3 }))).toBe("pending");
  });

  it("is every state when nothing waits, when requests are accepted by themselves, when registration is off, and when the numbers are not known", () => {
    expect(defaultRequestStatus(counts({ pending: 0, accepted: 9 }))).toBe("all");
    expect(defaultRequestStatus({ ...counts({ pending: 3 }), mode: "automatic" })).toBe("all");
    expect(defaultRequestStatus({ ...counts({ pending: 3 }), mode: null })).toBe("all");
    expect(defaultRequestStatus(null)).toBe("all");
  });
});

describe("the words and numbers around the list", () => {
  it("adds a number to a label once it is known, and leaves the label as it is until then", () => {
    expect(withCount("Accepted", 120)).toBe("Accepted (120)");
    expect(withCount("Accepted", 0)).toBe("Accepted (0)");
    expect(withCount("Accepted", null)).toBe("Accepted");
  });

  it("adds up the requests of every state, and has no total before the numbers are known", () => {
    expect(requestsTotal(counts({ pending: 4, waitlist: 3, accepted: 120, rejected: 2, awaiting_email: 11 }))).toBe(140);
    expect(requestsTotal(null)).toBeNull();
  });

  it("names an age as the filter does, and an age it does not know by itself", () => {
    expect(requestAgeLabel("90d")).toBe("90 days ago");
    expect(requestAgeLabel("180d")).toBe("6 months ago");
    expect(requestAgeLabel("2d")).toBe("2d");
  });
});
