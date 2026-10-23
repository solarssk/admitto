/** What names the registrations a filter selects, and what counts as a filter (no database). */
import { describe, expect, it } from "vitest";
import { isEmptyRegistrationFilter, registrationSelectionDigest } from "../src/registration-selection.js";

describe("registrationSelectionDigest", () => {
  it("is 64 lower-case hex digits, and the same for the same ids in any order", () => {
    const digest = registrationSelectionDigest(["reg-b", "reg-a", "reg-c"]);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(registrationSelectionDigest(["reg-a", "reg-b", "reg-c"])).toBe(digest);
    expect(registrationSelectionDigest(["reg-c", "reg-a", "reg-b"])).toBe(digest);
  });

  it("does not depend on the array it was given: it does not sort it in place", () => {
    const ids = ["reg-b", "reg-a"];
    registrationSelectionDigest(ids);
    expect(ids).toEqual(["reg-b", "reg-a"]);
  });

  it("tells one set from another, though they are as large: one id swapped, one added, one left out, none", () => {
    const base = registrationSelectionDigest(["reg-a", "reg-b", "reg-c"]);
    const others = [
      registrationSelectionDigest(["reg-a", "reg-b", "reg-d"]),
      registrationSelectionDigest(["reg-a", "reg-b", "reg-c", "reg-d"]),
      registrationSelectionDigest(["reg-a", "reg-b"]),
      registrationSelectionDigest([]),
    ];
    expect(new Set([base, ...others]).size).toBe(5);
  });

  it("names the empty set, which a filter that selects nothing is shown with", () => {
    expect(registrationSelectionDigest([])).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("isEmptyRegistrationFilter", () => {
  it.each([
    [{}, true],
    [{ words: [] }, true],
    [{ status: undefined, olderThan: undefined, words: [] }, true],
    [{ status: "rejected" }, false],
    [{ olderThan: "30d" }, false],
    [{ words: ["annabel"] }, false],
    [{ status: "rejected", olderThan: "30d", words: ["a", "b"] }, false],
  ] as const)("%j: %s", (filter, empty) => {
    expect(isEmptyRegistrationFilter(filter)).toBe(empty);
  });
});
