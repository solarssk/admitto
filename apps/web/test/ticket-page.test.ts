import { describe, expect, it } from "vitest";
import { renderRevoked } from "../src/ticket-page.js";

describe("renderRevoked", () => {
  it("renders cancelled tickets with cancelled wording", () => {
    const html = renderRevoked("Alice Example", "Launch Event", "cancelled");
    expect(html).toContain("Ticket cancelled");
    expect(html).toContain("has been cancelled");
    expect(html).not.toContain("Ticket revoked");
  });

  it("renders revoked tickets with revoked wording", () => {
    const html = renderRevoked("Bob Example", "Launch Event", "revoked");
    expect(html).toContain("Ticket revoked");
    expect(html).toContain("has been revoked");
  });
});
