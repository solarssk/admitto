import { describe, expect, it } from "vitest";
import { renderRevoked, renderServerError } from "../src/ticket-page.js";

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

describe("renderServerError", () => {
  it("renders a generic support-safe error page", () => {
    const html = renderServerError();
    expect(html).toContain("Server error");
    expect(html).toContain("Unable to render this ticket right now");
  });
});
