import { describe, expect, it } from "vitest";
import { resolveImportTicketType } from "../src/ticket-type-import.js";

describe("resolveImportTicketType", () => {
  const catalog = [
    { key: "vip", label: "VIP" },
    { key: "standard", label: "Standard" },
  ];

  it("matches an exact key case-insensitively", () => {
    expect(resolveImportTicketType("VIP", catalog)).toEqual({ key: "vip", label: "VIP" });
  });

  it("matches a label case-insensitively", () => {
    expect(resolveImportTicketType("standard", catalog)).toEqual({
      key: "standard",
      label: "Standard",
    });
  });

  it("returns null for no match", () => {
    expect(resolveImportTicketType("bogus", catalog)).toBeNull();
  });

  it("returns null for an empty/whitespace value", () => {
    expect(resolveImportTicketType("  ", catalog)).toBeNull();
  });

  it("prioritizes an exact key match over a conflicting label match on another entry (CodeRabbit review)", () => {
    // "vip" is entry A's key, and also entry B's label - a naive single `find` over
    // `key || label` would pick whichever entry happens to come first in catalog order.
    const ambiguous = [
      { key: "press", label: "VIP" },
      { key: "vip", label: "VIP Pass" },
    ];
    expect(resolveImportTicketType("vip", ambiguous)).toEqual({ key: "vip", label: "VIP Pass" });
  });

  it("rejects an ambiguous label shared by two catalog entries instead of picking the first", () => {
    const ambiguous = [
      { key: "vip-a", label: "VIP" },
      { key: "vip-b", label: "VIP" },
    ];
    expect(resolveImportTicketType("vip", ambiguous)).toBeNull();
  });
});
