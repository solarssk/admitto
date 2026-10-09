import { describe, expect, it } from "vitest";
import {
  anonymousEntries,
  ERASED_ATTENDEE_LABEL,
  ERASED_NOT_SELECTABLE_LABEL,
  erasedCheckInParts,
  erasedOnLabel,
  erasedToast,
  erasedWalletChipLabel,
  erasureFreesPlace,
  freedPlacesLine,
  hiddenErasedLine,
  isOlderThanErasure,
  peopleCount,
  placesFreedBy,
  redactedAfterErasure,
  redactedRowsAfterErasure,
  rowIdentity,
  rowsWithPassesRemoved,
  selectRowLabel,
  shownErasedLine,
  withWalletOutcome,
} from "../../src/attendees/erasedAttendee.js";

/** What the answer of an erasure says about the pass of the person erased. */
const NOTHING_PENDING = { pending: false, removed: false } as const;
const STILL_PENDING = { pending: true, removed: false } as const;
const DELETED_NOW = { pending: false, removed: true } as const;

describe("counts in words", () => {
  it("uses the singular for one and the plural otherwise", () => {
    expect(peopleCount(1)).toBe("1 person");
    expect(peopleCount(12)).toBe("12 people");
    expect(anonymousEntries(1)).toBe("1 anonymous entry");
    expect(anonymousEntries(12)).toBe("12 anonymous entries");
  });

  it("words the line under the list for one hidden erased entry and for several, and for shown ones without a count", () => {
    expect(hiddenErasedLine(1)).toBe("1 erased entry is hidden. Reports still count it.");
    expect(hiddenErasedLine(2)).toBe("2 erased entries are hidden. Reports still count them.");
    expect(shownErasedLine()).toBe("Erased entries are included. Reports count them too.");
  });
});

describe("erasedToast", () => {
  it.each([
    [{ erased: 1, already_erased: 0 }, "Personal data erased"],
    [{ erased: 3, already_erased: 1 }, "Personal data of 3 people erased"],
    [{ erased: 0, already_erased: 2 }, "Already erased"],
    [{ erased: 0, already_erased: 0 }, "Nobody was erased"],
  ])("%j says %s", (result, message) => {
    expect(erasedToast(result)).toBe(message);
  });
});

describe("erasureFreesPlace", () => {
  it.each([
    ["registered", null, false, true],
    ["confirmed", null, false, true],
    ["cancelled", null, false, false],
    ["revoked", null, false, false],
    ["registered", "2026-09-01T10:00:00.000Z", false, false],
    ["registered", null, true, false],
  ] as const)("%s, admitted %s, archived %s: %s", (status, admittedAt, archived, expected) => {
    expect(erasureFreesPlace({ status, admitted_at: admittedAt }, archived)).toBe(expected);
  });
});

describe("list rows", () => {
  const live = { name: "Jane Doe", email: "jane@example.com", erased_at: null };
  const gone = { name: "Placeholder", email: "erased-x@erased.invalid", erased_at: "2026-10-08T12:00:00.000Z" };

  it("shows a live row as it is", () => {
    expect(rowIdentity(live, "UTC")).toEqual({ erased: false, name: "Jane Doe", detail: "jane@example.com" });
    expect(selectRowLabel(live)).toBe("Select Jane Doe");
  });

  it("never shows the placeholders of an erased row", () => {
    const identity = rowIdentity(gone, "UTC");
    expect(identity.erased).toBe(true);
    expect(identity.name).toBe(ERASED_ATTENDEE_LABEL);
    expect(identity.detail).toMatch(/^Erased on .*2026/);
    expect(identity.detail).toBe(erasedOnLabel(gone.erased_at, "UTC"));
    expect(selectRowLabel(gone)).toBe(ERASED_NOT_SELECTABLE_LABEL);
  });

  it("treats a row without the field, as older fixtures have it, as live", () => {
    expect(rowIdentity({ name: "A", email: "a@example.com" }, "UTC").erased).toBe(false);
  });
});

describe("erasedWalletChipLabel", () => {
  it.each([
    [{ wallet_pass: { provider_removed_at: "2026-10-08T12:00:00.000Z" }, wallet_pass_delete_pending: false }, "Pass removed"],
    [{ wallet_pass: { provider_removed_at: null }, wallet_pass_delete_pending: true }, "To be deleted"],
    [{ wallet_pass: { provider_removed_at: null }, wallet_pass_delete_pending: false }, "No pass"],
    [{ wallet_pass: null, wallet_pass_delete_pending: undefined }, "No pass"],
  ])("%j reads %s", (detail, label) => {
    expect(erasedWalletChipLabel(detail as never)).toBe(label);
  });
});

describe("erasedCheckInParts", () => {
  it("reads Around HH:MM in the event's zone, without the UTC offset", () => {
    const parts = erasedCheckInParts("2026-09-01T08:00:00.000Z", "Europe/Warsaw");

    expect(parts?.time).toMatch(/^Around 10:00/);
    expect(parts?.time).not.toMatch(/UTC/);
    expect(parts?.day).toMatch(/2026/);
  });

  it("has nothing to show for an attendee who was never admitted", () => {
    expect(erasedCheckInParts(null, "Europe/Warsaw")).toBeNull();
  });

  it("follows the event's zone: the same instant is another hour elsewhere", () => {
    expect(erasedCheckInParts("2026-09-01T08:00:00.000Z", "America/New_York")?.time).toMatch(/^Around 04:00/);
  });
});

describe("redactedAfterErasure", () => {
  const live = {
    id: "att-1",
    erased_at: null,
    name: "Anna Alpha",
    first_name: "Anna",
    last_name: "Alpha",
    email: "anna@example.com",
    company: "Acme",
    department: "Eng",
    ticket_type: "vip",
    status: "registered",
    check_in_status: "admitted",
    admitted_at: "2026-09-01T10:37:21.123Z",
    custom_data: { diet: "vegan" },
    deliveries: [
      {
        id: "d-1",
        attendee_name: "Anna Alpha",
        status: "sent",
        recipient_email: "anna@example.com",
        rendered_subject: "Your ticket, Anna",
        provider_message_id: "msg-1",
        error: "mailbox full for anna@example.com",
      },
    ],
    wallet_apple_link: "https://tickets.example.com/apple",
    wallet_google_link: "https://tickets.example.com/google",
    wallet_pass: { status: "active", apple_url: "a", android_url: "g", user_agent: "Safari", user_agent_captured_at: "2026-09-01T10:00:00.000Z", provider_removed_at: null },
    action_log: [{ id: "l-1" }],
    action_log_total: 1,
    action_log_first_action_type: "attendee_created_manual",
    action_log_snapshot: "snap",
    notes: [{ id: "n-1", body: "Private note" }],
    notes_total: 1,
  };

  const erasure = { at: "2026-10-09T12:00:00.000Z", timezone: "Europe/Warsaw", eventArchived: false };

  it("takes everything personal out and keeps what the entry keeps", () => {
    const redacted = redactedAfterErasure(live as never, erasure, NOTHING_PENDING);

    expect(redacted).toMatchObject({
      erased_at: "2026-10-09T12:00:00.000Z",
      name: ERASED_ATTENDEE_LABEL,
      first_name: null,
      last_name: null,
      email: "",
      company: null,
      department: null,
      custom_data: null,
      wallet_apple_link: null,
      wallet_google_link: null,
      action_log: [],
      action_log_total: 0,
      notes: [],
      notes_total: 0,
      // What the entry keeps stays.
      id: "att-1",
      ticket_type: "vip",
      status: "registered",
      check_in_status: "admitted",
    });
    expect(redacted.deliveries[0]).toMatchObject({
      status: "sent",
      attendee_name: ERASED_ATTENDEE_LABEL,
      recipient_email: null,
      rendered_subject: null,
      provider_message_id: null,
      error: null,
    });
    expect(redacted.wallet_pass).toMatchObject({ status: "active", apple_url: null, android_url: null, user_agent: null, user_agent_captured_at: null });
    expect(JSON.stringify(redacted)).not.toMatch(/anna|Anna|Private note|vegan/);
  });

  it("copes with an attendee who has no wallet pass and no deliveries", () => {
    const redacted = redactedAfterErasure({ ...live, wallet_pass: null, deliveries: [] } as never, erasure, NOTHING_PENDING);

    expect(redacted.wallet_pass).toBeNull();
    expect(redacted.deliveries).toEqual([]);
  });

  it("does not change the detail it was given", () => {
    const before = JSON.stringify(live);

    redactedAfterErasure(live as never, erasure, STILL_PENDING);

    expect(JSON.stringify(live)).toBe(before);
  });

  it("cuts the check-in time to the hour of the event's zone, as the server does", () => {
    expect(redactedAfterErasure(live as never, erasure, NOTHING_PENDING).admitted_at).toBe("2026-09-01T10:00:00.000Z");
    expect(redactedAfterErasure(live as never, { ...erasure, timezone: "Asia/Kolkata" }, NOTHING_PENDING).admitted_at).toBe(
      "2026-09-01T10:30:00.000Z",
    );
  });

  it("leaves a check-in time that is not there missing", () => {
    expect(redactedAfterErasure({ ...live, admitted_at: null, status: "cancelled" } as never, erasure, NOTHING_PENDING).admitted_at).toBeNull();
  });

  it.each([
    ["someone not checked in yet on a live event", { admitted_at: null }, false, "cancelled"],
    ["someone not checked in yet on an archived event", { admitted_at: null }, true, "registered"],
    ["someone already checked in", {}, false, "registered"],
    ["someone whose pass is already revoked", { admitted_at: null, status: "revoked" }, false, "revoked"],
  ])("%s: the status becomes %s", (_label, overrides, eventArchived, status) => {
    const redacted = redactedAfterErasure({ ...live, ...overrides } as never, { ...erasure, eventArchived }, NOTHING_PENDING);

    expect(redacted.status).toBe(status);
  });

  it("marks the pass as still at the provider when the answer said so", () => {
    const redacted = redactedAfterErasure(live as never, erasure, STILL_PENDING);

    expect(redacted.wallet_pass_delete_pending).toBe(true);
    expect(redacted.wallet_pass).toMatchObject({ provider_removed_at: null });
  });

  it("marks the pass as deleted now only when the answer said it deleted it", () => {
    const redacted = redactedAfterErasure(live as never, erasure, DELETED_NOW);

    expect(redacted.wallet_pass_delete_pending).toBe(false);
    expect(redacted.wallet_pass).toMatchObject({ provider_removed_at: erasure.at });
  });

  it("leaves the provider state of a pass alone when the answer did not delete it", () => {
    const neverRemoved = redactedAfterErasure(live as never, erasure, NOTHING_PENDING);
    const removedBefore = redactedAfterErasure(
      { ...live, wallet_pass: { ...live.wallet_pass, provider_removed_at: "2026-08-01T09:00:00.000Z" } } as never,
      erasure,
      NOTHING_PENDING,
    );

    expect(neverRemoved.wallet_pass_delete_pending).toBe(false);
    expect(neverRemoved.wallet_pass).toMatchObject({ provider_removed_at: null });
    expect(removedBefore.wallet_pass).toMatchObject({ provider_removed_at: "2026-08-01T09:00:00.000Z" });
  });

  it.each([
    ["queued", null, "cancelled", false],
    ["failed", true, "cancelled", false],
    ["failed", false, "failed", false],
    ["failed", null, "failed", null],
    ["sent", null, "sent", null],
  ])("mail that was %s (retryable %s) is %s afterwards, as the server leaves it", (status, retryable, expectedStatus, expectedRetryable) => {
    const redacted = redactedAfterErasure({ ...live, deliveries: [{ ...live.deliveries[0], status, retryable }] } as never, erasure, NOTHING_PENDING);

    expect(redacted.deliveries[0]).toMatchObject({ status: expectedStatus, retryable: expectedRetryable });
  });
});

describe("redactedRowsAfterErasure", () => {
  const row = (id: string) => ({
    id,
    erased_at: null,
    name: `Name ${id}`,
    email: `${id}@example.com`,
    company: "Acme",
    department: "Eng",
    ticket_type: "vip",
    status: "registered",
    admitted_at: null,
  });

  const erasure = { at: "2026-10-09T12:00:00.000Z", timezone: "UTC", eventArchived: false };

  it("redacts the erased rows in place and leaves the others as they are", () => {
    const items = [row("a"), row("b"), row("c")];

    const result = redactedRowsAfterErasure(items as never, new Set(["a", "c"]), erasure, new Set());

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ id: "a", erased_at: "2026-10-09T12:00:00.000Z", name: ERASED_ATTENDEE_LABEL, email: "", company: null, department: null, ticket_type: "vip" });
    expect(result[1]).toEqual(items[1]);
    expect(result[2]).toMatchObject({ id: "c", erased_at: "2026-10-09T12:00:00.000Z", name: ERASED_ATTENDEE_LABEL });
    expect(JSON.stringify(result[0])).not.toMatch(/Name a|a@example/);
  });

  it("does not change the rows it was given", () => {
    const items = [row("a")];
    const before = JSON.stringify(items);

    redactedRowsAfterErasure(items as never, new Set(["a"]), erasure, new Set());

    expect(JSON.stringify(items)).toBe(before);
  });

  it("cuts the check-in time of an erased row to the hour, and cancels who was not admitted", () => {
    const admitted = { ...row("a"), admitted_at: "2026-10-09T14:37:21.123Z", check_in_status: "admitted" };
    const waiting = row("b");

    const result = redactedRowsAfterErasure([admitted, waiting, admitted] as never, new Set(["a", "b"]), erasure, new Set());

    expect(result[0]).toMatchObject({ admitted_at: "2026-10-09T14:00:00.000Z", status: "registered" });
    expect(result[1]).toMatchObject({ admitted_at: null, status: "cancelled" });
  });

  describe("the wallet pass of an erased row", () => {
    const withPass = { ...row("a"), wallet_status: { apple_active_registrations: 1, apple_inactive_registrations: 0, provider_removed_at: null } };

    it("is marked removed at the provider only for the people whose pass the answer says it deleted", () => {
      const other = { ...row("b"), wallet_status: { apple_active_registrations: 1, apple_inactive_registrations: 0, provider_removed_at: null } };
      const third = { ...row("c"), wallet_status: { apple_active_registrations: 1, apple_inactive_registrations: 0, provider_removed_at: null } };

      const result = redactedRowsAfterErasure([withPass, other, third] as never, new Set(["a", "b"]), erasure, new Set(["a", "c"]));

      expect(result[0]?.wallet_status).toMatchObject({ apple_active_registrations: 1, provider_removed_at: erasure.at });
      // Erased, but the answer did not delete this pass (still at the provider, or never was there).
      expect(result[1]?.wallet_status).toMatchObject({ provider_removed_at: null });
      // Not part of this erasure at all.
      expect(result[2]?.wallet_status).toMatchObject({ provider_removed_at: null });
    });

    it("stays missing for someone who has no pass", () => {
      const [result] = redactedRowsAfterErasure([{ ...row("a"), wallet_status: null }] as never, new Set(["a"]), erasure, new Set(["a"]));

      expect(result?.wallet_status).toBeNull();
    });
  });

  it.each([
    ["queued", null, "cancelled", false],
    ["failed", true, "cancelled", false],
    ["failed", false, "failed", false],
    ["failed", null, "failed", null],
    ["sent", null, "sent", null],
    [null, null, null, null],
  ])("the last mail of a row that was %s (retryable %s) is %s afterwards, as the server leaves it", (status, retryable, expectedStatus, expectedRetryable) => {
    const [result] = redactedRowsAfterErasure(
      [{ ...row("a"), last_mail_status: status, last_mail_retryable: retryable }] as never,
      new Set(["a"]),
      erasure,
      new Set(),
    );

    expect(result).toMatchObject({ last_mail_status: expectedStatus, last_mail_retryable: expectedRetryable });
  });

  it("leaves the last mail of a row that is not erased alone", () => {
    const [result] = redactedRowsAfterErasure(
      [{ ...row("a"), last_mail_status: "queued", last_mail_retryable: null }] as never,
      new Set(["b"]),
      erasure,
      new Set(),
    );

    expect(result).toMatchObject({ last_mail_status: "queued" });
  });

  it("leaves everyone's status alone on an archived event", () => {
    const [result] = redactedRowsAfterErasure([row("a")] as never, new Set(["a"]), { ...erasure, eventArchived: true }, new Set());

    expect(result).toMatchObject({ status: "registered" });
  });
});

describe("isOlderThanErasure", () => {
  const erased = { id: "att-1", erased_at: "2026-10-09T12:00:00.000Z" };
  const live = { id: "att-1", erased_at: null };

  it("is true for an answer that shows the erased attendee as not erased", () => {
    expect(isOlderThanErasure(erased as never, live as never)).toBe(true);
    expect(isOlderThanErasure(erased as never, { id: "att-1" } as never)).toBe(true);
  });

  it("is false for an answer that is erased too", () => {
    expect(isOlderThanErasure(erased as never, { ...erased, erased_at: "2026-10-09T12:00:05.000Z" } as never)).toBe(false);
  });

  it("is false while the page holds nothing, or someone who is not erased", () => {
    expect(isOlderThanErasure(null, live as never)).toBe(false);
    expect(isOlderThanErasure(live as never, live as never)).toBe(false);
    expect(isOlderThanErasure(live as never, erased as never)).toBe(false);
  });

  it("is false for another attendee, so moving to one is not blocked", () => {
    expect(isOlderThanErasure(erased as never, { id: "att-2", erased_at: null } as never)).toBe(false);
  });
});

describe("withWalletOutcome", () => {
  const erased = {
    id: "att-1",
    erased_at: "2026-10-09T12:00:00.000Z",
    wallet_pass_delete_pending: true,
    wallet_pass: { status: "active", provider_removed_at: null, apple_url: null },
  };

  it("marks the pass as no longer to be deleted and removed now when the answer deleted it", () => {
    const result = withWalletOutcome(erased as never, { pending: false, removedAt: "2026-10-09T12:05:00.000Z" });

    expect(result.wallet_pass_delete_pending).toBe(false);
    expect(result.wallet_pass).toMatchObject({ status: "active", provider_removed_at: "2026-10-09T12:05:00.000Z" });
    expect(result.erased_at).toBe("2026-10-09T12:00:00.000Z");
  });

  it("keeps the provider state of a pass that the answer did not delete", () => {
    const removedBefore = { ...erased, wallet_pass_delete_pending: false, wallet_pass: { ...erased.wallet_pass, provider_removed_at: "2026-08-01T09:00:00.000Z" } };

    expect(withWalletOutcome(erased as never, { pending: false, removedAt: null })).toMatchObject({
      wallet_pass_delete_pending: false,
      wallet_pass: { provider_removed_at: null },
    });
    expect(withWalletOutcome(removedBefore as never, { pending: false, removedAt: null }).wallet_pass).toMatchObject({
      provider_removed_at: "2026-08-01T09:00:00.000Z",
    });
  });

  it("says the pass is still to be deleted when the answer says so", () => {
    expect(withWalletOutcome({ ...erased, wallet_pass_delete_pending: false } as never, { pending: true, removedAt: null }).wallet_pass_delete_pending).toBe(true);
  });

  it("copes with an attendee who has no pass", () => {
    expect(withWalletOutcome({ ...erased, wallet_pass: null } as never, { pending: false, removedAt: "2026-10-09T12:05:00.000Z" }).wallet_pass).toBeNull();
  });

  it("does not change the detail it was given", () => {
    const before = JSON.stringify(erased);

    withWalletOutcome(erased as never, { pending: false, removedAt: "2026-10-09T12:05:00.000Z" });

    expect(JSON.stringify(erased)).toBe(before);
  });
});

describe("places an erasure frees", () => {
  const row = (id: string, overrides: Record<string, unknown> = {}) => ({ id, status: "registered", admitted_at: null, ...overrides });

  it("counts only the selected people whose erasure cancels them", () => {
    const rows = [
      row("a"),
      row("b", { status: "confirmed" }),
      row("c", { admitted_at: "2026-10-09T10:00:00.000Z" }),
      row("d", { status: "cancelled" }),
      row("e"),
    ];

    expect(placesFreedBy(rows as never, new Set(["a", "b", "c", "d"]), false)).toBe(2);
  });

  it("counts nobody on an archived event", () => {
    expect(placesFreedBy([row("a"), row("b")] as never, new Set(["a", "b"]), true)).toBe(0);
  });

  it("says it in the singular and the plural", () => {
    expect(freedPlacesLine(1)).toBe("1 person is not checked in yet, so their place becomes free.");
    expect(freedPlacesLine(3)).toBe("3 people are not checked in yet, so their places become free.");
  });
});

describe("rowsWithPassesRemoved", () => {
  const status = { apple_active_registrations: 1, apple_inactive_registrations: 0, provider_removed_at: null };
  const row = (id: string, wallet_status: unknown = status) => ({ id, wallet_status });

  it("marks the pass removed for the people the answer lists, and leaves the other rows as they are", () => {
    const rows = [row("a"), row("b"), row("c", null)];

    const result = rowsWithPassesRemoved(rows as never, new Set(["a", "c"]), "2026-10-09T12:05:00.000Z");

    expect(result[0]?.wallet_status).toMatchObject({ apple_active_registrations: 1, provider_removed_at: "2026-10-09T12:05:00.000Z" });
    expect(result[1]).toBe(rows[1]);
    // Listed, but without a pass in the row: nothing to mark.
    expect(result[2]?.wallet_status).toBeNull();
  });

  it("does not change the rows it was given", () => {
    const rows = [row("a")];
    const before = JSON.stringify(rows);

    rowsWithPassesRemoved(rows as never, new Set(["a"]), "2026-10-09T12:05:00.000Z");

    expect(JSON.stringify(rows)).toBe(before);
  });
});
