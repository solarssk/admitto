import { describe, expect, it } from "vitest";
import { compareByOperatorRow } from "../src/admin/reports-routes.js";

const named = (id: string, label: string, count: number) => ({
  operator_user_id: id,
  operator_display_name: label,
  operator_email: null,
  count,
});
const noOperator = (count: number) => ({
  operator_user_id: null,
  operator_display_name: null,
  operator_email: null,
  count,
});

describe("compareByOperatorRow", () => {
  it("ranks a higher count first regardless of operator identity", () => {
    expect(compareByOperatorRow(named("a", "Zebra", 5), named("b", "Alpha", 1))).toBeLessThan(0);
    expect(compareByOperatorRow(named("a", "Alpha", 1), named("b", "Zebra", 5))).toBeGreaterThan(0);
  });

  it("sorts the no-operator bucket after a named operator on a tied count, from either comparator side", () => {
    // Both directions matter here: a real, unordered DB query could hand the comparator these
    // two rows in either order, and Array.prototype.sort's exact call pattern for a given
    // pre-sort order isn't something application code controls - both must independently put
    // the null bucket last.
    expect(compareByOperatorRow(noOperator(3), named("a", "Alpha", 3))).toBeGreaterThan(0);
    expect(compareByOperatorRow(named("a", "Alpha", 3), noOperator(3))).toBeLessThan(0);
  });

  it("breaks a tie between two named operators alphabetically by resolved label", () => {
    expect(compareByOperatorRow(named("a", "Alpha", 2), named("b", "Zebra", 2))).toBeLessThan(0);
    expect(compareByOperatorRow(named("a", "Zebra", 2), named("b", "Alpha", 2))).toBeGreaterThan(0);
  });

  it("falls back to email, then to an empty label, when display_name is unresolved", () => {
    const emailOnly = { operator_user_id: "a", operator_display_name: null, operator_email: "z@example.com", count: 1 };
    const deleted = { operator_user_id: "b", operator_display_name: null, operator_email: null, count: 1 };
    expect(compareByOperatorRow(deleted, emailOnly)).toBeLessThan(0);
  });
});
