/** The rules of registration that need no database: which mail a moment queues, where a guest goes, what a seat is. */
import { describe, expect, it } from "vitest";
import { REGISTRATION_MAIL_TEMPLATE_NAME, REGISTRATION_STATUS, type RegistrationStatus } from "@admitto/db/status";
import { attendeeCustomDataFromAnswers } from "../src/registration-attendee.js";
import { registrationMailFor, registrationMailMisfit, type RegistrationMailMoment } from "../src/registration-mail-queue.js";
import { decidePlacement, seatsNeeded } from "../src/registration-seats.js";

describe("registrationMailFor (D-D2)", () => {
  const cases: [RegistrationMailMoment, string | null][] = [
    // Link and password with confirmation: the confirmation first, and the click replaces "received".
    [{ to: "awaiting_email" }, "registration-confirm"],
    [{ to: "pending", afterConfirmation: true }, null],
    // Single sign-on, or confirmation switched off: "received" is the first mail of an event with approval.
    [{ to: "pending", afterConfirmation: false }, "registration-received"],
    [{ to: "waitlist" }, "registration-waitlist"],
    [{ to: "accepted" }, "ticket"],
    [{ to: "rejected", notify: true }, "registration-rejected"],
    // A rejection is mailed only when the organiser asked to inform the guest (D-B8).
    [{ to: "rejected", notify: false }, null],
  ];
  it.each(cases)("%j queues %s", (moment, template) => {
    expect(registrationMailFor(moment)).toBe(template);
  });

  it("reaches each of the five templates of D-D1 and no other (the database holds the same list)", () => {
    const queued = new Set(cases.flatMap(([moment]) => registrationMailFor(moment) ?? []));
    expect([...queued].sort()).toEqual([...REGISTRATION_MAIL_TEMPLATE_NAME].sort());
  });
});

describe("registrationMailMisfit (D-D2)", () => {
  const NOW = Date.parse("2026-10-23T10:00:00Z");
  const LATER = new Date(NOW + 60_000);

  // The status a registration has when each moment happens: the mail of the moment is for it, and for no other.
  const reached: [RegistrationMailMoment, RegistrationStatus][] = [
    [{ to: "awaiting_email" }, "awaiting_email"],
    [{ to: "pending", afterConfirmation: false }, "pending"],
    [{ to: "waitlist" }, "waitlist"],
    [{ to: "accepted" }, "accepted"],
    [{ to: "rejected", notify: true }, "rejected"],
  ];
  it.each(reached)("%j: the mail fits a registration that is %s, and one in any other status does not", (moment, status) => {
    const template = registrationMailFor(moment);
    expect(template).not.toBeNull();
    expect(registrationMailMisfit(template!, { status, confirm_expires_at: LATER }, NOW)).toBeNull();
    for (const other of REGISTRATION_STATUS.filter((candidate) => candidate !== status)) {
      expect(registrationMailMisfit(template!, { status: other, confirm_expires_at: null }, NOW)).toBe("registration_changed");
    }
  });

  it("covers the five templates the database holds, and no other", () => {
    const covered = reached.flatMap(([moment]) => registrationMailFor(moment) ?? []);
    expect(covered.sort()).toEqual([...REGISTRATION_MAIL_TEMPLATE_NAME].sort());
  });

  it("lets a confirmation go only until its link expires, the moment of the expiry included", () => {
    const status = "awaiting_email";
    expect(registrationMailMisfit("registration-confirm", { status, confirm_expires_at: new Date(NOW + 1) }, NOW)).toBeNull();
    expect(registrationMailMisfit("registration-confirm", { status, confirm_expires_at: new Date(NOW) }, NOW)).toBe("confirmation_expired");
    expect(registrationMailMisfit("registration-confirm", { status, confirm_expires_at: new Date(NOW - 1) }, NOW)).toBe("confirmation_expired");
  });

  it("names a changed registration before an expired link, and takes an unknown template for a changed registration", () => {
    const expired = new Date(NOW - 1);
    expect(registrationMailMisfit("registration-confirm", { status: "pending", confirm_expires_at: expired }, NOW)).toBe("registration_changed");
    expect(registrationMailMisfit("a-mail-nobody-queues", { status: "pending", confirm_expires_at: null }, NOW)).toBe("registration_changed");
  });
});

describe("decidePlacement", () => {
  const settings = (mode: "automatic" | "approval", waitlist_enabled = true) => ({ mode, waitlist_enabled });
  // [mode, waiting list on, free seats, guests waiting, seats needed, expected]
  const cases: ["automatic" | "approval", boolean, number, number, number, string][] = [
    ["automatic", true, 1, 0, 1, "accepted"],
    ["automatic", true, 0, 0, 1, "waitlist"],
    // D-B16: guests wait, a seat is free, and a new guest of an automatic event queues behind them.
    ["automatic", true, 1, 2, 1, "waitlist"],
    ["automatic", true, Number.POSITIVE_INFINITY, 1, 1, "waitlist"],
    // A waiting list that was switched off is ignored, and a full event with none is full (D-B6).
    ["automatic", false, 1, 2, 1, "accepted"],
    ["automatic", false, 0, 0, 1, "full"],
    // Approval: every guest waits for the organiser, so waiting guests change nothing; a full event has a list or is full.
    ["approval", true, 1, 0, 1, "pending"],
    ["approval", true, 1, 3, 1, "pending"],
    ["approval", true, 0, 0, 1, "waitlist"],
    ["approval", false, 0, 0, 1, "full"],
    ["approval", false, 1, 0, 1, "pending"],
    // A guest with a companion needs two seats (D-B17: one is not enough, the guest is not asked).
    ["automatic", true, 1, 0, 2, "waitlist"],
    ["automatic", true, 2, 0, 2, "accepted"],
    ["automatic", false, 1, 0, 2, "full"],
    ["automatic", true, Number.POSITIVE_INFINITY, 0, 9, "accepted"],
  ];
  it.each(cases)("%s, waiting list %s, %s free, %s waiting, %s needed: %s", (mode, waitlist, free, waitlisted, needed, expected) => {
    expect(decidePlacement(settings(mode, waitlist), { free, waitlisted }, needed)).toBe(expected);
  });
});

describe("seatsNeeded", () => {
  it("counts the guest and each companion", () => {
    expect(seatsNeeded([])).toBe(1);
    expect(seatsNeeded([{ name: "Companion", custom_data: {} }])).toBe(2);
    expect(seatsNeeded(null)).toBe(1);
  });
});

describe("attendeeCustomDataFromAnswers", () => {
  const fields = [
    { label: "Diet", source_field: "diet", type: "select" as const, options: ["vegan", "none"] },
    { label: "Parking", source_field: "parking", type: "boolean" as const },
    { label: "Plate", source_field: "plate" },
  ];

  it("keeps the answers to the fields the event has, as those fields take a value", () => {
    expect(attendeeCustomDataFromAnswers(fields, { diet: "vegan", parking: "yes", plate: "  AB 123  " })).toEqual({
      diet: "vegan",
      parking: "true",
      plate: "AB 123",
    });
  });

  it("leaves out the answer to a field that is gone, and to one whose options changed so that it no longer fits", () => {
    expect(attendeeCustomDataFromAnswers(fields, { diet: "pescatarian", shoe_size: "42", plate: "AB 123" })).toEqual({
      plate: "AB 123",
    });
  });

  it("does not require a field that became required since: the organiser's decision comes first", () => {
    expect(attendeeCustomDataFromAnswers([{ ...fields[2], required: true }], {})).toBeUndefined();
  });

  it("ignores empty answers, and answers of a shape it does not know", () => {
    expect(attendeeCustomDataFromAnswers(fields, { diet: "", plate: 12 })).toBeUndefined();
    expect(attendeeCustomDataFromAnswers(fields, null)).toBeUndefined();
    expect(attendeeCustomDataFromAnswers(fields, ["vegan"])).toBeUndefined();
  });
});
