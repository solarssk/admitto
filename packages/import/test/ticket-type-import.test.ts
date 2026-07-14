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

  it("uses the key match when it agrees with the only label match (no rename has happened)", () => {
    // Re-importing an exported ticket_type column value ("vip", the raw key) round-trips
    // correctly when nothing about the catalog has changed since export.
    expect(resolveImportTicketType("vip", catalog)).toEqual({ key: "vip", label: "VIP" });
  });

  it("rejects a key match when a *different* type's current label collides with the same raw value (Codex review)", () => {
    // key is immutable and admins only ever see/edit label - "vip" was renamed to "Staff", then a
    // later "VIP" type got the auto-generated key "vip_2". A CSV row saying "VIP" must not
    // silently resolve to the renamed-away "Staff" type just because its old key still spells
    // "vip"; the raw value is genuinely ambiguous between "the type currently called VIP" and
    // "the type whose (stale, invisible) key happens to be vip".
    const renamed = [
      { key: "vip", label: "Staff" },
      { key: "vip_2", label: "VIP" },
    ];
    expect(resolveImportTicketType("VIP", renamed)).toBeNull();
  });

  it("still resolves a key match when the colliding label belongs to that same type", () => {
    // The common case: a type's key still matches its own current label (e.g. "vip"/"VIP") -
    // that's not a collision with a *different* type, so it must still resolve normally.
    const notRenamed = [{ key: "vip", label: "VIP" }];
    expect(resolveImportTicketType("VIP", notRenamed)).toEqual({ key: "vip", label: "VIP" });
  });

  it("rejects an ambiguous label shared by two catalog entries instead of picking the first", () => {
    const ambiguous = [
      { key: "vip-a", label: "VIP" },
      { key: "vip-b", label: "VIP" },
    ];
    expect(resolveImportTicketType("vip", ambiguous)).toBeNull();
  });
});
