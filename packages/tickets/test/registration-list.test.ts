import { describe, expect, it } from "vitest";
import * as tickets from "../src/index.js";
import {
  MAX_REGISTRATION_BULK_IDS,
  REGISTRATION_AGE_FILTERS,
  REGISTRATION_SEARCH_MAX_LENGTH,
  REGISTRATION_SEARCH_MAX_WORDS,
  canRetryRegistrationMail,
  isRegistrationAgeFilter,
  isRegistrationStatus,
  parseRegistrationFilter,
  parseRegistrationSearch,
  registrationAgeCutoff,
  registrationListWhere,
} from "../src/registration-list.js";

const NOW = new Date("2026-10-21T12:00:00.000Z");
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

describe("the limits", () => {
  it("allows 500 ids in one bulk request, and the package exports that number", () => {
    expect(MAX_REGISTRATION_BULK_IDS).toBe(500);
    expect(tickets.MAX_REGISTRATION_BULK_IDS).toBe(MAX_REGISTRATION_BULK_IDS);
  });

  it("searches for at most a whole address, in at most eight words", () => {
    expect(REGISTRATION_SEARCH_MAX_LENGTH).toBe(254);
    expect(REGISTRATION_SEARCH_MAX_WORDS).toBe(8);
  });
});

describe("parseRegistrationSearch", () => {
  it("gives no words for an empty text", () => {
    expect(parseRegistrationSearch("")).toEqual([]);
    expect(parseRegistrationSearch("   ")).toEqual([]);
  });

  it("trims, and splits on any run of white space", () => {
    expect(parseRegistrationSearch("  anna   kowalska  ")).toEqual(["anna", "kowalska"]);
    expect(parseRegistrationSearch("anna\u00a0kowalska\u3000nowak")).toEqual(["anna", "kowalska", "nowak"]);
  });

  it("composes the text to NFC, as the form stores names", () => {
    expect(parseRegistrationSearch("Zoe\u0301")).toEqual(["Zo\u00e9"]);
  });

  it("keeps an address in one word, with its punctuation", () => {
    expect(parseRegistrationSearch("anna.kowalska+test@example.com")).toEqual(["anna.kowalska+test@example.com"]);
  });

  it.each([
    ["NUL", "anna\u0000"],
    ["a line break", "anna\nkowalska"],
    ["a tab", "anna\tkowalska"],
    ["a zero-width space", "an\u200bna"],
    ["a right-to-left override", "anna\u202etxt"],
    ["a lone surrogate", "an\ud800na"],
  ])("refuses %s, which no registration can hold", (_name, text) => {
    expect(parseRegistrationSearch(text)).toBeNull();
  });

  it("allows a text of 254 characters and refuses one of 255", () => {
    expect(parseRegistrationSearch("a".repeat(REGISTRATION_SEARCH_MAX_LENGTH))).toEqual([
      "a".repeat(REGISTRATION_SEARCH_MAX_LENGTH),
    ]);
    expect(parseRegistrationSearch("a".repeat(REGISTRATION_SEARCH_MAX_LENGTH + 1))).toBeNull();
  });

  it("counts characters, not the units a character takes in memory", () => {
    const grinning = "\u{1F600}";
    expect(parseRegistrationSearch(grinning.repeat(REGISTRATION_SEARCH_MAX_LENGTH))).toHaveLength(1);
    expect(parseRegistrationSearch(grinning.repeat(REGISTRATION_SEARCH_MAX_LENGTH + 1))).toBeNull();
  });

  it("refuses a very long text without reading it", () => {
    expect(parseRegistrationSearch("a".repeat(100_000))).toBeNull();
  });

  it("allows eight words and refuses nine", () => {
    const eight = Array.from({ length: REGISTRATION_SEARCH_MAX_WORDS }, (_, i) => `w${i}`);
    expect(parseRegistrationSearch(eight.join(" "))).toEqual(eight);
    expect(parseRegistrationSearch([...eight, "extra"].join(" "))).toBeNull();
  });
});

describe("the age filters", () => {
  it("is a closed list that holds hours and days", () => {
    expect(REGISTRATION_AGE_FILTERS).toEqual(["1h", "24h", "3d", "7d", "14d", "30d", "90d", "180d", "365d"]);
  });

  it.each(REGISTRATION_AGE_FILTERS)("%s is a filter", (age) => {
    expect(isRegistrationAgeFilter(age)).toBe(true);
  });

  it.each(["", "7", "7D", "7 d", "7days", "0d", "-1d", "2d", "1e3h", "NaN", "__proto__", "constructor"])(
    "%j is not a filter",
    (value) => {
      expect(isRegistrationAgeFilter(value)).toBe(false);
    },
  );

  it.each([
    ["1h", HOUR_MS],
    ["24h", 24 * HOUR_MS],
    ["3d", 3 * DAY_MS],
    ["7d", 7 * DAY_MS],
    ["14d", 14 * DAY_MS],
    ["30d", 30 * DAY_MS],
    ["90d", 90 * DAY_MS],
    ["180d", 180 * DAY_MS],
    ["365d", 365 * DAY_MS],
  ] as const)("%s is before the moment that many milliseconds ago", (age, ms) => {
    expect(registrationAgeCutoff(age, NOW).getTime()).toBe(NOW.getTime() - ms);
  });
});

describe("isRegistrationStatus", () => {
  it.each(["awaiting_email", "pending", "waitlist", "accepted", "rejected"])("%s is a state", (status) => {
    expect(isRegistrationStatus(status)).toBe(true);
  });

  it.each(["", "Pending", "approved", "deleted", "__proto__"])("%j is not a state", (status) => {
    expect(isRegistrationStatus(status)).toBe(false);
  });
});

describe("parseRegistrationFilter", () => {
  it("selects everything when nothing is asked for", () => {
    expect(parseRegistrationFilter({})).toEqual({
      ok: true,
      filter: { status: undefined, olderThan: undefined, words: [] },
    });
  });

  it("reads blank values as left out, because a form sends an empty field", () => {
    expect(parseRegistrationFilter({ status: "  ", olderThan: "", q: "   " })).toEqual({
      ok: true,
      filter: { status: undefined, olderThan: undefined, words: [] },
    });
  });

  it("reads every part of a valid filter", () => {
    expect(parseRegistrationFilter({ status: " rejected ", olderThan: "30d", q: " Anna  Kowalska " })).toEqual({
      ok: true,
      filter: { status: "rejected", olderThan: "30d", words: ["Anna", "Kowalska"] },
    });
  });

  it.each([
    [{ status: "approved" }, ["status"]],
    [{ status: "PENDING" }, ["status"]],
    [{ olderThan: "7" }, ["older_than"]],
    [{ olderThan: "2d" }, ["older_than"]],
    [{ q: "a\u0000b" }, ["q"]],
    [{ q: "a".repeat(255) }, ["q"]],
    [{ status: "x", olderThan: "y", q: "a\nb" }, ["status", "older_than", "q"]],
  ])("refuses %j and names %j", (input, fields) => {
    expect(parseRegistrationFilter(input)).toEqual({ ok: false, invalid: fields });
  });

  it("never puts a refused value in its answer", () => {
    const result = parseRegistrationFilter({ status: "anna@example.com", olderThan: "secret-value" });
    expect(JSON.stringify(result)).not.toMatch(/anna@example\.com|secret-value/);
  });
});

describe("registrationListWhere", () => {
  it("is always limited to the event", () => {
    expect(registrationListWhere("evt-1", {}, NOW)).toEqual({ event_id: "evt-1" });
    expect(registrationListWhere("evt-2", { status: "pending", olderThan: "7d", words: ["x"] }, NOW)).toMatchObject({
      event_id: "evt-2",
    });
  });

  it("selects one state", () => {
    expect(registrationListWhere("evt-1", { status: "waitlist" }, NOW)).toEqual({
      event_id: "evt-1",
      status: "waitlist",
    });
  });

  it("selects the registrations made before the cutoff of the age", () => {
    expect(registrationListWhere("evt-1", { olderThan: "7d" }, NOW)).toEqual({
      event_id: "evt-1",
      created_at: { lt: new Date(NOW.getTime() - 7 * DAY_MS) },
    });
  });

  it("asks for every word in the first name, the last name or the address, in any case", () => {
    expect(registrationListWhere("evt-1", { words: ["anna", "kow"] }, NOW)).toEqual({
      event_id: "evt-1",
      AND: [
        {
          OR: [
            { first_name: { contains: "anna", mode: "insensitive" } },
            { last_name: { contains: "anna", mode: "insensitive" } },
            { email: { contains: "anna", mode: "insensitive" } },
          ],
        },
        {
          OR: [
            { first_name: { contains: "kow", mode: "insensitive" } },
            { last_name: { contains: "kow", mode: "insensitive" } },
            { email: { contains: "kow", mode: "insensitive" } },
          ],
        },
      ],
    });
  });

  it("escapes the characters of a pattern, so that a word is searched for as it was typed", () => {
    const where = registrationListWhere("evt-1", { words: ["a%b_c\\d"] }, NOW);
    expect(where.AND).toEqual([
      {
        OR: [
          { first_name: { contains: "a\\%b\\_c\\\\d", mode: "insensitive" } },
          { last_name: { contains: "a\\%b\\_c\\\\d", mode: "insensitive" } },
          { email: { contains: "a\\%b\\_c\\\\d", mode: "insensitive" } },
        ],
      },
    ]);
  });

  it("does not search the answers, the company or the department", () => {
    const where = JSON.stringify(registrationListWhere("evt-1", { words: ["x"] }, NOW));
    expect(where).not.toMatch(/custom_data|company|department|companions/);
  });

  it("adds no condition for an empty list of words", () => {
    expect(registrationListWhere("evt-1", { words: [] }, NOW)).toEqual({ event_id: "evt-1" });
  });
});

describe("canRetryRegistrationMail", () => {
  const NOW = Date.parse("2026-10-23T10:00:00Z");
  const pending = { status: "pending", confirm_expires_at: null };

  it.each([
    ["failed", false, true],
    ["failed", null, true],
    ["failed", true, false],
    ["queued", null, false],
    ["queued", false, false],
    ["accepted", null, false],
    ["sent", null, false],
    ["delivered", null, false],
    ["cancelled", false, false],
  ] as const)("%s with retryable %s: %s", (status, retryable, expected) => {
    expect(canRetryRegistrationMail({ template_name: "registration-received", status, retryable }, pending, NOW)).toBe(expected);
  });

  describe("for a mail that failed for good", () => {
    const failed = { status: "failed", retryable: false };

    it("is never offered for a ticket row: the ticket is sent again from the attendee", () => {
      const accepted = { status: "accepted", confirm_expires_at: null };
      expect(canRetryRegistrationMail({ template_name: "ticket", ...failed }, accepted, NOW)).toBe(false);
      expect(canRetryRegistrationMail({ template_name: "ticket", status: "failed", retryable: null }, accepted, NOW)).toBe(false);
    });

    it("is not offered once the registration has moved on without a newer mail: the worker would cancel it", () => {
      // A rejection with no notice leaves the failed "received" mail behind.
      const rejected = { status: "rejected", confirm_expires_at: null };
      expect(canRetryRegistrationMail({ template_name: "registration-received", ...failed }, rejected, NOW)).toBe(false);
      expect(canRetryRegistrationMail({ template_name: "registration-received", ...failed }, pending, NOW)).toBe(true);
    });

    it("is not offered for a confirmation whose link has expired, the moment of the expiry included", () => {
      const awaiting = (expiry: number) => ({ status: "awaiting_email", confirm_expires_at: new Date(expiry) });
      const confirm = { template_name: "registration-confirm", ...failed };
      expect(canRetryRegistrationMail(confirm, awaiting(NOW + 1), NOW)).toBe(true);
      expect(canRetryRegistrationMail(confirm, awaiting(NOW), NOW)).toBe(false);
      expect(canRetryRegistrationMail(confirm, awaiting(NOW - 1), NOW)).toBe(false);
    });
  });
});
