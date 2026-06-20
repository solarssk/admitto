import { describe, expect, it } from "vitest";
import {
  buildTicketFontSrc,
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

    expect(html).toContain('class="at-badge at-badge--neutral at-badge--dot"');
    expect(html).toContain("--primary");
    expect(html).toContain("ticket-page");
    expect(html).toContain("Apple Wallet");
    expect(html).not.toContain("badge-\"><style>boom</style>");
  });
});

describe("getTicketPageSecurityHeaders", () => {
  it("returns CSP and related hardening headers", () => {
    const headers = getTicketPageSecurityHeaders();
    expect(headers["Content-Security-Policy"]).toContain("default-src 'none'");
    expect(headers["Content-Security-Policy"]).toContain("img-src 'self' data:");
    expect(headers["Content-Security-Policy"]).toContain("font-src 'self'");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("allows custom font origin in CSP when theme provides HTTPS font URL", () => {
    const fontUrl = "https://cdn.example.com/fonts/brand.woff2";
    const headers = getTicketPageSecurityHeaders({
      font_family_url: fontUrl,
      font_family_name: "Brand Sans",
    });
    const csp = headers["Content-Security-Policy"] ?? "";
    expect(csp).toContain("font-src 'self' https://cdn.example.com");
    expect(csp).not.toContain("font-src 'none'");

    const html = renderTicket(
      {
        mode: "internal",
        attendee: {
          id: "a1",
          event_id: "e1",
          email: "x@example.com",
          name: "Guest",
          status: "confirmed",
          token_hash: null,
          qr_payload: null,
          external_uuid: null,
          ticket_type: null,
        },
        event: {
          id: "e1",
          title: "Launch",
          date: new Date("2026-09-01T09:00:00Z"),
          location: null,
        },
      },
      "data:image/png;base64,abc",
      { font_family_url: fontUrl, font_family_name: "Brand Sans" },
    );
    expect(html).toContain("@font-face");
    expect(html).toContain(fontUrl);
  });

  it("does not break out of the ticket style block via font family name", () => {
    const fontUrl = "https://cdn.example.com/fonts/brand.woff2";
    const html = renderTicket(
      {
        mode: "internal",
        attendee: {
          id: "a1",
          event_id: "e1",
          email: "x@example.com",
          name: "Guest",
          status: "confirmed",
          token_hash: null,
          qr_payload: null,
          external_uuid: null,
          ticket_type: null,
        },
        event: {
          id: "e1",
          title: "Launch",
          date: new Date("2026-09-01T09:00:00Z"),
          location: null,
        },
      },
      "data:image/png;base64,abc",
      {
        font_family_url: fontUrl,
        font_family_name: 'test</style><script>document.location="https://evil.example"</script><style>',
      },
    );
    expect(html).not.toContain("</style><script");
    expect(html).not.toContain("<script");
    expect(html).toMatch(/<style>[\s\S]*<\/style>/);
  });
});

describe("buildTicketFontSrc", () => {
  it("rejects non-https font origins", () => {
    expect(buildTicketFontSrc({ font_family_url: "http://evil.example/x.woff2" })).toBe("'self'");
  });
});
