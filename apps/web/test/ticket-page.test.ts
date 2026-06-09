import { describe, expect, it } from "vitest";
import {
  getTicketPageSecurityHeaders,
  renderRevoked,
  renderServerError,
  renderTicket,
} from "../src/ticket-page.js";

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

describe("renderTicket", () => {
  it("maps unexpected status values to a safe fallback CSS class", () => {
    const html = renderTicket(
      {
        mode: "internal",
        attendee: {
          id: "attendee-1",
          event_id: "event-1",
          email: "x@example.com",
          name: "Example User",
          status: '"><style>boom</style>',
          token_hash: null,
          qr_payload: null,
          external_uuid: null,
          ticket_type: null,
        },
        event: {
          id: "event-1",
          title: "Launch Event",
          date: new Date("2026-09-01T09:00:00Z"),
          location: null,
        },
      },
      "data:image/png;base64,abc",
    );

    expect(html).toContain('class="badge badge-unknown"');
    expect(html).not.toContain("badge-\"><style>boom</style>");
  });
});

describe("getTicketPageSecurityHeaders", () => {
  it("returns CSP and related hardening headers", () => {
    const headers = getTicketPageSecurityHeaders();
    expect(headers["Content-Security-Policy"]).toContain("default-src 'none'");
    expect(headers["Content-Security-Policy"]).toContain("img-src 'self' data:");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });
});
