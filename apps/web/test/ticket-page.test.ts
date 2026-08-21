import { describe, expect, it } from "vitest";
import {
  buildTicketFontSrc,
  buildTicketImgSrc,
  getTicketPageSecurityHeaders,
  renderNotFound,
  renderRevoked,
  renderServerError,
  renderTicket,
  resolveDisplayToken,
} from "../src/ticket-page.js";

const EMPTY_EVENT_LOCATION = {
  eventHoursStart: null,
  eventHoursEnd: null,
  walletEnabled: true,
  walletTemplateId: null,
  walletApiKeyEnc: null,
  walletAppleEnabled: true,
  walletGoogleEnabled: true,
  walletSemanticTagsEnabled: false,
  walletFieldMapping: null,
  formattedAddress: null,
  addressComponents: null,
  latitude: null,
  longitude: null,
  mapZoom: null,
  directionsText: null,
  accessibilityText: null,
  googleMapsUrlOverride: null,
  appleMapsUrlOverride: null,
} as const;

/** Shared by the logo-rendering tests below - only `event.logoUrl`/`event.title` ever vary. */
function ticketFor(logoUrl: string | null) {
  return {
    mode: "internal" as const,
    attendee: {
      id: "a1",
      event_id: "e1",
      email: "x@example.com",
      name: "Guest",
      status: "confirmed",
      first_name: null,
      last_name: null,
      company: null,
      department: null,
      token_hash: null,
      qr_payload: null,
      external_uuid: null,
      ticket_type: null,
    },
    event: {
      id: "e1",
      title: "Launch Event",
      slug: "launch-event",
      date: new Date("2026-09-01T09:00:00Z"),
      timezone: "UTC",
      location: null,
      logoUrl,
      ...EMPTY_EVENT_LOCATION,
    },
  };
}

describe("renderRevoked", () => {
  function revokedTicket(overrides?: {
    name?: string;
    title?: string;
    location?: string | null;
    ticket_type?: string | null;
  }) {
    return {
      mode: "internal" as const,
      attendee: {
        id: "a1",
        event_id: "e1",
        email: "x@example.com",
        name: overrides?.name ?? "Bob Example",
        status: "revoked",
        first_name: null,
        last_name: null,
        company: null,
        department: null,
        token_hash: null,
        qr_payload: null,
        external_uuid: null,
        ticket_type: overrides?.ticket_type ?? "Standard",
      },
      event: {
        id: "e1",
        title: overrides?.title ?? "Launch Event",
        slug: "launch-event",
        date: new Date("2026-09-01T09:00:00Z"),
        timezone: "UTC",
        ...EMPTY_EVENT_LOCATION,
        // After the empty-location spread so defaults/overrides are not wiped if EMPTY gains `location`.
        location: overrides?.location ?? "Main Hall",
        logoUrl: null,
      },
    };
  }

  it("renders cancelled tickets with cancelled wording in the ticket card", () => {
    const html = renderRevoked(revokedTicket({ name: "Alice Example" }), null, "cancelled");
    expect(html).toContain("Ticket cancelled");
    expect(html).toContain("ticket-page");
    expect(html).toContain("ticket__event-name");
    expect(html).toContain("Alice Example");
    expect(html).toContain("Launch Event");
    expect(html).toContain("no longer valid for entry");
    expect(html).toContain("contact the organisers");
    expect(html).not.toContain("Ticket revoked");
    expect(html).not.toContain('class="ticket__qr"');
    expect(html).not.toContain("Present this QR code");
    expect(html).not.toContain("apple-wallet-badge");
    expect(html).not.toContain("Getting there");
    expect(html).toContain("ticket__status-notice");
  });

  it("renders revoked tickets with revoked wording in the ticket card", () => {
    const html = renderRevoked(revokedTicket(), null, "revoked");
    expect(html).toContain("Ticket revoked");
    expect(html).toContain("ticket__status-notice");
    expect(html).toContain("Bob Example");
    expect(html).toContain("Main Hall");
    expect(html).toContain("Standard");
    expect(html).not.toContain("has been revoked");
    expect(html).not.toContain('class="ticket__qr"');
    expect(html).not.toContain('class="ticket__wallets"');
    expect(html).not.toContain("apple-wallet-badge.svg");
  });

  it("escapes attendee and event names in the revoked card", () => {
    const html = renderRevoked(
      revokedTicket({ name: `<script>x</script>`, title: `A & B <Event>` }),
      null,
      "revoked",
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("A &amp; B &lt;Event&gt;");
  });
});

describe("renderPublicErrorPage (404 / 500)", () => {
  it("renders a branded 500 with status code and generic copy", () => {
    const html = renderServerError();
    expect(html).toContain("ticket-page");
    expect(html).toContain("at-public-error");
    expect(html).toContain('class="at-public-error__code">500<');
    expect(html).toContain("Something went wrong");
    expect(html).toContain("Unable to load this page right now. Please try again later.");
    expect(html).toContain(">Admitto<");
    expect(html).not.toContain("Event ticket");
    expect(html).not.toContain("Server error");
    expect(html).not.toContain("Unable to render this ticket");
  });

  it("renders a branded 404 with status code and generic copy", () => {
    const html = renderNotFound();
    expect(html).toContain("ticket-page");
    expect(html).toContain("at-public-error");
    expect(html).toContain('class="at-public-error__code">404<');
    expect(html).toContain("Not found");
    expect(html).toContain("This link is invalid or the page no longer exists.");
    expect(html).toContain(">Admitto<");
    expect(html).not.toContain("Event ticket");
    expect(html).not.toContain("Ticket not found");
    expect(html).not.toContain("This ticket link");
  });
});

describe("renderTicket", () => {
  it("escapes unexpected status values and does not show a registration status badge", () => {
    const html = renderTicket(
      {
        mode: "internal",
        attendee: {
          id: "attendee-1",
          event_id: "event-1",
          email: "x@example.com",
          name: "Example User",
          status: '"><style>boom</style>',
          first_name: null,
          last_name: null,
          company: null,
          department: null,
          token_hash: null,
          qr_payload: null,
          external_uuid: null,
          ticket_type: "Standard",
        },
        event: {
          id: "event-1",
          title: "Launch Event",
          slug: "launch-event",
          date: new Date("2026-09-01T09:00:00Z"),
      timezone: "UTC",
          location: null,
          logoUrl: null,
          ...EMPTY_EVENT_LOCATION,
        },
      },
      "data:image/png;base64,abc",
      undefined,
      { walletAppleHref: "/t/token/wallet/apple", walletGoogleHref: "/t/token/wallet/google" },
    );

    expect(html).toContain("Standard");
    expect(html).not.toContain("at-badge");
    expect(html).not.toContain("Registered");
    expect(html).toContain("--primary");
    expect(html).toContain("ticket-page");
    expect(html).toContain('src="/assets/apple-wallet-badge.svg"');
    expect(html).toContain("wallet-badge-frame");
    expect(html).toContain("wallet-badge--apple");
    expect(html).toContain("How do I add this to my phone?");
    expect(html).not.toContain("coming soon");
    expect(html).not.toContain("aria-disabled");
    expect(html).not.toContain("badge-\"><style>boom</style>");
    expect(html).not.toContain("<style>boom</style>");
  });

  it("omits the wallet badges and help text entirely when no wallet hrefs are provided", () => {
    const html = renderTicket(ticketFor(null), "data:image/png;base64,abc");
    // The stylesheet unconditionally defines .wallet-badge-frame/.ticket__wallets rules - check
    // the markup itself (img src, help copy) rather than class names that also appear in CSS.
    expect(html).not.toContain("apple-wallet-badge.svg");
    expect(html).not.toContain("google-wallet-badge.svg");
    expect(html).not.toContain("How do I add this to my phone?");
  });

  it("renders only the configured wallet badge when just one platform has an href", () => {
    const html = renderTicket(ticketFor(null), "data:image/png;base64,abc", undefined, {
      walletAppleHref: "/t/token/wallet/apple",
    });
    expect(html).toContain("apple-wallet-badge.svg");
    expect(html).not.toContain("google-wallet-badge.svg");
  });

  it("does not show the wallet retry notice when the wallet badges are hidden", () => {
    const html = renderTicket(ticketFor(null), "data:image/png;base64,abc", undefined, {
      walletError: true,
    });
    expect(html).not.toContain("Could not add this ticket to your wallet");
  });

  it("renders the event hours range in the meta row when both are set", () => {
    const html = renderTicket(
      {
        ...ticketFor(null),
        event: { ...ticketFor(null).event, eventHoursStart: "18:00", eventHoursEnd: "22:00" },
      },
      "data:image/png;base64,abc",
    );
    expect(html).toContain("18:00 - 22:00");
  });

  it("renders an open-ended hours label when only one side of the range is set", () => {
    const startOnly = renderTicket(
      { ...ticketFor(null), event: { ...ticketFor(null).event, eventHoursStart: "18:00" } },
      "data:image/png;base64,abc",
    );
    expect(startOnly).toContain("from 18:00");

    const endOnly = renderTicket(
      { ...ticketFor(null), event: { ...ticketFor(null).event, eventHoursEnd: "22:00" } },
      "data:image/png;base64,abc",
    );
    expect(endOnly).toContain("until 22:00");
  });

  it("omits the time stat (and its divider) when neither start nor end is set", () => {
    const html = renderTicket(ticketFor(null), "data:image/png;base64,abc");
    expect(html).not.toContain('class="ticket__stat-divider"');
    expect(html).not.toContain(">Time<");
  });

  it("renders the event date in en-GB long-month text when the event has no country set", () => {
    const html = renderTicket(ticketFor(null), "data:image/png;base64,abc");
    expect(html).toContain("1 September 2026");
  });

  it("renders the event date and hours in the event's own regional convention (US-style)", () => {
    const html = renderTicket(
      {
        ...ticketFor(null),
        event: {
          ...ticketFor(null).event,
          eventHoursStart: "18:00",
          eventHoursEnd: "22:00",
          addressComponents: {
            object_name: null,
            street: null,
            postcode: null,
            city: "New York",
            region: "NY",
            country: "United States",
          },
        },
      },
      "data:image/png;base64,abc",
    );
    expect(html).toContain("September 1, 2026");
    expect(html).toContain("6:00 pm - 10:00 pm");
  });

  it("appends the event timezone's abbreviation to the hours range", () => {
    const html = renderTicket(
      {
        ...ticketFor(null),
        event: {
          ...ticketFor(null).event,
          eventHoursStart: "10:00",
          eventHoursEnd: "18:05",
          timezone: "Asia/Kolkata",
          addressComponents: {
            object_name: null,
            street: null,
            postcode: null,
            city: null,
            region: null,
            country: "India",
          },
        },
      },
      "data:image/png;base64,abc",
    );
    expect(html).toContain('10:00 am - 6:05 pm<span class="ticket__stat-tz"> IST</span>');
  });

  it("resolves the timezone abbreviation for the event's own date, not a stale standard-time label", () => {
    // ticketFor(null)'s event.date is 2026-09-01, which is inside US daylight saving time -
    // America/New_York must show "EDT" here, not the zone's standard-time "EST".
    const html = renderTicket(
      {
        ...ticketFor(null),
        event: { ...ticketFor(null).event, eventHoursStart: "09:00", eventHoursEnd: "17:00", timezone: "America/New_York" },
      },
      "data:image/png;base64,abc",
    );
    expect(html).toContain('<span class="ticket__stat-tz"> EDT</span>');
    expect(html).not.toContain("EST");
  });

  it("renders Getting there with a static map and navigation links (attribution is burned into the PNG)", () => {
    const html = renderTicket(
      {
        ...ticketFor(null),
        event: {
          ...ticketFor(null).event,
          location: "Convention Centre",
          formattedAddress: "1 Example Street, Exampletown",
          addressComponents: {
            object_name: "Convention Centre",
            street: "1 Example Street",
            postcode: null,
            city: "Exampletown",
            region: null,
            country: "Poland",
          },
          latitude: 50.061947,
          longitude: 19.936856,
          mapZoom: 16,
          directionsText: "Enter through the east gate.",
          accessibilityText: "Step-free entrance on the south side.",
          googleMapsUrlOverride: null,
          appleMapsUrlOverride: null,
        },
      },
      "data:image/png;base64,abc",
      undefined,
      {
        displayToken: "abcdefgh…wxyz",
      },
    );

    expect(html).toContain("Getting there");
    expect(html).toContain("1 Example Street");
    expect(html).toContain("Exampletown, Poland");
    expect(html).toContain('data="/m/e1.png?v=9_50.061947_19.936856_z16"');
    expect(html).toContain('aria-label="Map of event location"');
    expect(html).toContain("Map unavailable");
    expect(html).toContain("Google Maps");
    expect(html).toContain("Apple Maps");
    expect(html).toContain("Enter through the east gate.");
    expect(html).toContain("Step-free entrance on the south side.");
    expect(html).toContain("abcdefgh…wxyz");
    expect(html).not.toContain('class="ticket__map-attribution"');
    expect(html).not.toContain("openstreetmap.org/copyright");
  });

  it("uses manual Maps URL overrides on the ticket when set", () => {
    const html = renderTicket(
      {
        ...ticketFor(null),
        event: {
          ...ticketFor(null).event,
          location: "Hall",
          latitude: 50.06,
          longitude: 19.94,
          mapZoom: 15,
          googleMapsUrlOverride: "https://www.google.com/maps/place/Custom",
          appleMapsUrlOverride: "https://maps.apple.com/?address=Custom",
        },
      },
      "data:image/png;base64,abc",
    );
    expect(html).toContain('href="https://www.google.com/maps/place/Custom"');
    expect(html).toContain('href="https://maps.apple.com/?address=Custom"');
  });

  it("strips HTML from the venue name so tags are not shown as text", () => {
    const html = renderTicket(
      {
        ...ticketFor(null),
        event: {
          ...ticketFor(null).event,
          location: 'Hall <b>Main</b>',
          formattedAddress: "1 Example Street",
          latitude: null,
          longitude: null,
        },
      },
      "data:image/png;base64,abc",
    );
    expect(html).toContain("Hall Main");
    expect(html).not.toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>Main</b>");
  });

  it("keeps Google/Apple links but omits the static map image when maps are disabled", () => {
    const html = renderTicket(
      {
        ...ticketFor(null),
        event: {
          ...ticketFor(null).event,
          location: "Convention Centre",
          formattedAddress: "1 Example Street, Exampletown",
          latitude: 50.061947,
          longitude: 19.936856,
          mapZoom: 16,
        },
      },
      "data:image/png;base64,abc",
      undefined,
      { staticMapEnabled: false },
    );

    expect(html).toContain("Getting there");
    expect(html).toContain("Google Maps");
    expect(html).toContain("Apple Maps");
    expect(html).not.toContain('src="/m/e1.png');
    expect(html).not.toContain('data="/m/e1.png');
    expect(html).not.toContain('class="ticket__map-attribution"');
  });

  it("renders location notes without a map when coordinates are unavailable", () => {
    const html = renderTicket(
      {
        ...ticketFor(null),
        event: {
          ...ticketFor(null).event,
          formattedAddress: "1 Example Street, Exampletown",
          directionsText: "Use the main entrance.",
        },
      },
      "data:image/png;base64,abc",
    );

    expect(html).toContain("Getting there");
    expect(html).toContain("1 Example Street, Exampletown");
    expect(html).toContain("Use the main entrance.");
    expect(html).not.toContain('src="/m/e1.png"');
    expect(html).not.toContain('data="/m/e1.png"');
    expect(html).not.toContain("Google Maps");
  });

  it("keeps street-only addresses on one line and omits HTML map attribution", () => {
    const html = renderTicket(
      {
        ...ticketFor(null),
        event: {
          ...ticketFor(null).event,
          addressComponents: {
            object_name: null,
            street: "12 Example Road",
            postcode: null,
            city: null,
            region: null,
            country: null,
          },
          latitude: 50.06,
          longitude: 19.93,
          mapZoom: 15,
        },
      },
      "data:image/png;base64,abc",
    );

    expect(html).toContain("12 Example Road");
    expect(html).not.toContain("ticket__map-attribution");
    expect(html).not.toContain("Map data attribution unavailable");
  });

  it("renders Getting there from coordinates alone without an address block", () => {
    const html = renderTicket(
      {
        ...ticketFor(null),
        event: {
          ...ticketFor(null).event,
          location: null,
          formattedAddress: null,
          addressComponents: null,
          latitude: 50.06,
          longitude: 19.93,
          mapZoom: 15,
        },
      },
      "data:image/png;base64,abc",
    );
    expect(html).toContain("Getting there");
    expect(html).toContain("Google Maps");
    expect(html).not.toContain('<p class="ticket__address">');
  });

  it("renders the branded not-found page", () => {
    expect(renderNotFound()).toContain("Not found");
  });

  it("omits Getting there when no attendee-facing location details exist", () => {
    const html = renderTicket(ticketFor(null), "data:image/png;base64,abc");

    expect(html).not.toContain("Getting there");
    expect(html).not.toContain('src="/m/e1.png"');
    expect(html).not.toContain('data="/m/e1.png"');
  });

  it("shows the configured logo instead of the Admitto wordmark (#419)", () => {
    const html = renderTicket(ticketFor("https://cdn.example.com/logo.png"), "data:image/png;base64,abc");
    expect(html).toContain('<img class="ticket__brand-logo" src="https://cdn.example.com/logo.png"');
    expect(html).not.toContain('src="/assets/admitto-mark.svg"');
    expect(html).not.toContain(">Admitto<");
  });

  it("keeps the Admitto mark graphic when no logo is configured (#419)", () => {
    const html = renderTicket(ticketFor(null), "data:image/png;base64,abc");
    expect(html).toContain('src="/assets/admitto-mark.svg"');
    expect(html).toContain(">Admitto<");
    expect(html).not.toContain('<img class="ticket__brand-logo"');
  });

  it("escapes a logo URL so it can't break out of the img src attribute", () => {
    const html = renderTicket(
      ticketFor('https://evil.example/x.png"><script>alert(1)</script>'),
      "data:image/png;base64,abc",
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toMatch(/<img class="ticket__brand-logo" src="[^"]*"/);
  });
});

describe("getTicketPageSecurityHeaders", () => {
  it("returns CSP and related hardening headers", () => {
    const headers = getTicketPageSecurityHeaders();
    expect(headers["Content-Security-Policy"]).toContain("default-src 'none'");
    expect(headers["Content-Security-Policy"]).toContain("img-src 'self' data:");
    expect(headers["Content-Security-Policy"]).toContain("font-src 'self'");
    expect(headers["Content-Security-Policy"]).toContain("object-src 'self'");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("allows custom font origin in CSP when theme provides HTTPS font URL", () => {
    const fontUrl = "https://cdn.example.com/fonts/brand.woff2";
    const headers = getTicketPageSecurityHeaders({
      font_family_name: "Brand Sans",
      custom_font_families: [{ name: "Brand Sans", variants: [{ weight: 400, style: "normal", url: fontUrl }] }],
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
          first_name: null,
          last_name: null,
          company: null,
          department: null,
          token_hash: null,
          qr_payload: null,
          external_uuid: null,
          ticket_type: null,
        },
        event: {
          id: "e1",
          title: "Launch",
          slug: "launch",
          date: new Date("2026-09-01T09:00:00Z"),
      timezone: "UTC",
          location: null,
          logoUrl: null,
          ...EMPTY_EVENT_LOCATION,
        },
      },
      "data:image/png;base64,abc",
      {
        font_family_name: "Brand Sans",
        custom_font_families: [{ name: "Brand Sans", variants: [{ weight: 400, style: "normal", url: fontUrl }] }],
      },
    );
    expect(html).toContain("@font-face");
    expect(html).toContain(fontUrl);
  });

  it("allows the logo's origin in CSP img-src when an HTTPS logo is configured (#419)", () => {
    const headers = getTicketPageSecurityHeaders(null, "https://cdn.example.com/logo.png");
    const csp = headers["Content-Security-Policy"] ?? "";
    expect(csp).toContain("img-src 'self' data: https://cdn.example.com");
  });

  it("does not widen CSP img-src for a relative /uploads/... logo (already same-origin)", () => {
    const headers = getTicketPageSecurityHeaders(null, "/uploads/orgs/x/logo.png");
    const csp = headers["Content-Security-Policy"] ?? "";
    expect(csp).toContain("img-src 'self' data:;");
  });

  it("does not break out of the ticket style block via font family name", () => {
    const html = renderTicket(
      {
        mode: "internal",
        attendee: {
          id: "a1",
          event_id: "e1",
          email: "x@example.com",
          name: "Guest",
          status: "confirmed",
          first_name: null,
          last_name: null,
          company: null,
          department: null,
          token_hash: null,
          qr_payload: null,
          external_uuid: null,
          ticket_type: null,
        },
        event: {
          id: "e1",
          title: "Launch",
          slug: "launch",
          date: new Date("2026-09-01T09:00:00Z"),
      timezone: "UTC",
          location: null,
          logoUrl: null,
          ...EMPTY_EVENT_LOCATION,
        },
      },
      "data:image/png;base64,abc",
      {
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
    expect(
      buildTicketFontSrc({
        font_family_name: "Brand Sans",
        custom_font_families: [
          { name: "Brand Sans", variants: [{ weight: 400, style: "normal", url: "http://evil.example/x.woff2" }] },
        ],
      }),
    ).toBe("'self'");
  });

  it("ignores blank font URLs", () => {
    expect(
      buildTicketFontSrc({
        font_family_name: "Brand Sans",
        custom_font_families: [
          { name: "Brand Sans", variants: [{ weight: 400, style: "normal", url: "   " }] },
        ],
      }),
    ).toBe("'self'");
  });

  it("ignores unparseable font URLs", () => {
    expect(
      buildTicketFontSrc({
        font_family_name: "Brand Sans",
        custom_font_families: [
          { name: "Brand Sans", variants: [{ weight: 400, style: "normal", url: "not a url" }] },
        ],
      }),
    ).toBe("'self'");
  });

  it("only allowlists the active family's origin, ignoring other saved-but-unselected families", () => {
    expect(
      buildTicketFontSrc({
        font_family_name: "Active Sans",
        custom_font_families: [
          { name: "Active Sans", variants: [{ weight: 400, style: "normal", url: "https://active.example/a.woff2" }] },
          { name: "Other Sans", variants: [{ weight: 400, style: "normal", url: "https://other.example/b.woff2" }] },
        ],
      }),
    ).toBe("'self' https://active.example");
  });

  it("allowlists ticket_font_family_name's own origin, not font_family_name's, when both are set", () => {
    expect(
      buildTicketFontSrc({
        font_family_name: "Admin Sans",
        ticket_font_family_name: "Ticket Sans",
        custom_font_families: [
          { name: "Admin Sans", variants: [{ weight: 400, style: "normal", url: "https://admin.example/a.woff2" }] },
          { name: "Ticket Sans", variants: [{ weight: 400, style: "normal", url: "https://ticket.example/b.woff2" }] },
        ],
      }),
    ).toBe("'self' https://ticket.example");
  });
});

describe("buildTicketImgSrc", () => {
  it("returns just 'self' and data: when no logo is configured", () => {
    expect(buildTicketImgSrc(null)).toBe("'self' data:");
    expect(buildTicketImgSrc(undefined)).toBe("'self' data:");
  });

  it("adds the logo's origin for an HTTPS logo URL", () => {
    expect(buildTicketImgSrc("https://cdn.example.com/path/logo.png")).toBe(
      "'self' data: https://cdn.example.com",
    );
  });

  it("rejects non-https logo origins", () => {
    expect(buildTicketImgSrc("http://evil.example/x.png")).toBe("'self' data:");
  });

  it("rejects a logo URL carrying credentials", () => {
    expect(buildTicketImgSrc("https://user:pass@evil.example/x.png")).toBe("'self' data:");
  });

  it("ignores an unparseable logo URL", () => {
    expect(buildTicketImgSrc("not a url")).toBe("'self' data:");
  });
});

describe("resolveDisplayToken", () => {
  it("masks an internal token", () => {
    expect(resolveDisplayToken("abcdefghijklmnop", null)).toBe("abcdefgh…mnop");
  });

  it("falls back to a Mode B public ref", () => {
    expect(resolveDisplayToken(undefined, "agency-ref-1")).toBe("agency-ref-1");
  });

  it("returns null when neither token nor public ref is set", () => {
    expect(resolveDisplayToken(undefined, undefined)).toBeNull();
    expect(resolveDisplayToken(null, null)).toBeNull();
  });
});

describe("renderTicket weather", () => {
  const base = ticketFor(null);

  it("renders ok forecast under Getting there with clear copy", () => {
    const html = renderTicket(base, "data:image/png;base64,xx", null, {
      weather: {
        status: "ok",
        temp_c: 22,
        temp_min_c: 14,
        weather_code: 0,
        attribution: "Weather data by Open-Meteo.com",
        attribution_url: "https://open-meteo.com/",
      },
    });
    expect(html).toContain("ticket__weather-heading");
    expect(html).toContain("Weather on the day");
    expect(html).toContain("ticket__weather-icon");
    expect(html).toContain("Clear");
    expect(html).toContain("14-22°C");
    expect(html).toContain("ticket__weather-credit-row");
    expect(html).toContain("open-meteo.com");
  });

  it("renders too_far with horizon_days, not opens_in_days as the horizon", () => {
    const html = renderTicket(base, "data:image/png;base64,xx", null, {
      weather: {
        status: "too_far",
        opens_in_days: 13,
        horizon_days: 9,
        attribution: "Weather data by MET Norway",
        attribution_url: "https://www.met.no/en",
      },
    });
    expect(html).toContain("Weather on the day");
    expect(html).toContain("Forecast available 9 days");
    expect(html).toContain("before the event");
    expect(html).not.toContain("Forecast available 13 days");
    expect(html).toContain('href="https://www.met.no/en"');
    expect(html).toContain("ticket__weather-credit-row");
  });

  it("renders attribution as plain text when URL is missing", () => {
    const html = renderTicket(base, "data:image/png;base64,xx", null, {
      weather: {
        status: "too_far",
        horizon_days: 9,
        attribution: "Weather data by MET Norway",
      },
    });
    expect(html).toContain("Weather data by MET Norway");
    expect(html).toContain("<span class=\"ticket__weather-credit\">");
    expect(html).not.toContain("ticket__weather-credit\" href=");
  });

  it("omits weather when not provided", () => {
    const html = renderTicket(base, "data:image/png;base64,xx");
    expect(html).not.toContain("id=\"weather-heading\"");
    expect(html).not.toContain("Forecast available");
  });

  it("renders ok temp without min as a single °C", () => {
    const html = renderTicket(base, "data:image/png;base64,xx", null, {
      weather: {
        status: "ok",
        temp_c: 22,
        weather_code: 61,
        attribution: "Weather data by Open-Meteo.com",
      },
    });
    expect(html).toContain("22°C");
    expect(html).not.toContain("14-22°C");
  });

  it("renders too_far from opens_in_days when horizon is missing", () => {
    const html = renderTicket(base, "data:image/png;base64,xx", null, {
      weather: {
        status: "too_far",
        opens_in_days: 3,
        attribution: "Weather data by MET Norway",
      },
    });
    expect(html).toContain("Forecast available in 3 days");
  });

  it("omits the block for unavailable status", () => {
    const html = renderTicket(base, "data:image/png;base64,xx", null, {
      weather: { status: "unavailable", attribution: "Weather data by MET Norway" },
    });
    expect(html).not.toContain("id=\"weather-heading\"");
  });

  it("uses singular day wording for horizon_days=1", () => {
    const html = renderTicket(base, "data:image/png;base64,xx", null, {
      weather: {
        status: "too_far",
        horizon_days: 1,
        attribution: "Weather data by MET Norway",
      },
    });
    expect(html).toContain("Forecast available 1 day");
  });

  it("uses Forecast available soon when too_far has no horizon or opens-in", () => {
    const html = renderTicket(base, "data:image/png;base64,xx", null, {
      weather: {
        status: "too_far",
        attribution: "Weather data by MET Norway",
      },
    });
    expect(html).toContain("Forecast available soon");
    expect(html).toContain("before the event");
  });

  it("omits ok block when temp_c is missing", () => {
    const html = renderTicket(base, "data:image/png;base64,xx", null, {
      weather: {
        status: "ok",
        weather_code: 0,
        attribution: "Weather data by Open-Meteo.com",
      },
    });
    expect(html).not.toContain("id=\"weather-heading\"");
  });

  it("renders storm, snow, rain, and fog weather icons", () => {
    const cases: Array<{ code: number; unique: string }> = [
      { code: 95, unique: "m13 12-3 5h4l-3 5" },
      { code: 71, unique: "M8 20h.01M12 20h.01M16 20h.01" },
      { code: 61, unique: "m8 19-1 2m5-2-1 2m5-2-1 2" },
      { code: 45, unique: "M4 14h16M5 18h14M6 10h12" },
    ];
    for (const { code, unique } of cases) {
      const html = renderTicket(base, "data:image/png;base64,xx", null, {
        weather: {
          status: "ok",
          temp_c: 5,
          weather_code: code,
          attribution: "Weather data by Open-Meteo.com",
        },
      });
      expect(html).toContain(unique);
    }
  });
});
