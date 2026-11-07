import { describe, expect, it } from "vitest";
import type { RegistrationCountsDto } from "../../src/api/types.js";
import { isOverLimit, registrationReadiness } from "../../src/registration/registrationReadiness.js";

const PATH = "/admin/events/evt-1";

function counts(over: { pending?: number; waitlist?: number; mode?: RegistrationCountsDto["mode"] } = {}): RegistrationCountsDto {
  const pending = over.pending ?? 0;
  return {
    mode: over.mode === undefined ? "approval" : over.mode,
    by_status: { awaiting_email: 4, pending, waitlist: over.waitlist ?? 0, accepted: 30, rejected: 1 },
    needs_decision: pending,
  };
}

describe("isOverLimit", () => {
  it("is true only when more seats are held than the limit allows (D-B7)", () => {
    expect(isOverLimit({ used: 51, capacity: 50 })).toBe(true);
    expect(isOverLimit({ used: 50, capacity: 50 })).toBe(false);
    expect(isOverLimit({ used: 49, capacity: 50 })).toBe(false);
  });

  it("is never true for an event without a limit", () => {
    expect(isOverLimit({ used: 5000, capacity: null })).toBe(false);
  });
});

describe("registrationReadiness: the Registrations row of the Overview checklist", () => {
  it("is not there while registration is off, or while the numbers are unknown", () => {
    expect(registrationReadiness(counts({ pending: 9, mode: null }), PATH, { used: 1, capacity: 50 })).toBeNull();
    expect(registrationReadiness(null, PATH, { used: 1, capacity: 50 })).toBeNull();
  });

  it("asks for attention when requests wait for a decision, and leads to those requests", () => {
    const row = registrationReadiness(counts({ pending: 3 }), PATH, { used: 10, capacity: 50 });

    expect(row).toEqual({
      label: "Registrations",
      status: "warn",
      detail: "3 requests waiting for a decision.",
      icon: "clipboard-check",
      to: "/admin/events/evt-1/registration?tab=requests&status=pending",
    });
  });

  it("says one request in the singular", () => {
    expect(registrationReadiness(counts({ pending: 1 }), PATH, { used: 0, capacity: null })?.detail).toBe("1 request waiting for a decision.");
  });

  it("is done when nothing waits, and leads to the tab", () => {
    const row = registrationReadiness(counts(), PATH, { used: 10, capacity: 50 });

    expect(row).toMatchObject({ status: "ok", detail: "No requests waiting for a decision.", to: "/admin/events/evt-1/registration" });
  });

  it("counts the waiting list beside the requests, without asking for attention for it", () => {
    expect(registrationReadiness(counts({ waitlist: 4 }), PATH, { used: 10, capacity: 50 })).toMatchObject({
      status: "ok",
      detail: "No requests waiting for a decision. 4 on the waiting list.",
    });
    expect(registrationReadiness(counts({ pending: 2, waitlist: 4 }), PATH, { used: 10, capacity: 50 })?.detail).toBe(
      "2 requests waiting for a decision. 4 on the waiting list.",
    );
  });

  it("says when the event holds more seats than its limit, and asks for attention even when no request waits", () => {
    const row = registrationReadiness(counts(), PATH, { used: 52, capacity: 50 });

    expect(row).toMatchObject({
      status: "warn",
      detail: "No requests waiting for a decision. Over the limit: 52 seats taken, limit 50.",
      to: "/admin/events/evt-1/registration",
    });
  });
});
