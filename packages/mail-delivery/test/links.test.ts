import { describe, expect, it } from "vitest";
import { signRegistrationConfirm, verifyRegistrationConfirm } from "@admitto/crypto";
import { buildAttendeeMailLinks, buildConfirmUrl } from "../src/links.js";

const BASE = "https://tickets.example.com";
const EVENT = {
  slug: "summer-gala",
  registration_settings: null,
  wallet_enabled: false,
  wallet_template_id: null,
  wallet_api_key_enc: null,
  wallet_apple_enabled: true,
  wallet_google_enabled: true,
};
const EVENT_WITH_WALLET = {
  ...EVENT,
  wallet_enabled: true,
  wallet_template_id: "tmpl-1",
  wallet_api_key_enc: "encrypted-key",
};
const PUBLIC_REF = "tok_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";

describe("buildAttendeeMailLinks", () => {
  it("Mode A — internal token links", () => {
    const links = buildAttendeeMailLinks(
      { id: "att-1", public_ref: null, qr_payload: null, external_uuid: null },
      EVENT,
      BASE,
      "tok_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
    );
    expect(links.ticket_url).toBe(`${BASE}/t/tok_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij`);
    expect(links.qr_image_url).toBe(`${BASE}/q/tok_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij.png`);
    expect(links.ticket_url).not.toContain("att-1");
    expect(links.apple_wallet_url).toBe("");
    expect(links.google_wallet_url).toBe("");
  });

  it("Mode A — wallet URLs populated when the event has wallet configured", () => {
    const links = buildAttendeeMailLinks(
      { id: "att-1", public_ref: null, qr_payload: null, external_uuid: null },
      EVENT_WITH_WALLET,
      BASE,
      "tok_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
    );
    expect(links.apple_wallet_url).toBe(
      `${BASE}/t/tok_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij/wallet/apple`,
    );
    expect(links.google_wallet_url).toBe(
      `${BASE}/t/tok_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij/wallet/google`,
    );
  });

  it("Mode A — omits a platform's wallet URL when only that platform is disabled", () => {
    const links = buildAttendeeMailLinks(
      { id: "att-1", public_ref: null, qr_payload: null, external_uuid: null },
      { ...EVENT_WITH_WALLET, wallet_google_enabled: false },
      BASE,
      "tok_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
    );
    expect(links.apple_wallet_url).not.toBe("");
    expect(links.google_wallet_url).toBe("");
  });

  it("Mode B — wallet URL uses our own /t/:slug/a/:ref path, never the external ticket_url override", () => {
    const links = buildAttendeeMailLinks(
      {
        id: "att-agency",
        public_ref: PUBLIC_REF,
        qr_payload: "https://agency.example.com/ticket/123",
        external_uuid: null,
      },
      EVENT_WITH_WALLET,
      BASE,
    );
    expect(links.ticket_url).toBe("https://agency.example.com/ticket/123");
    expect(links.apple_wallet_url).toBe(`${BASE}/t/summer-gala/a/${PUBLIC_REF}/wallet/apple`);
  });

  it("Mode B — agency URL payload uses external ticket_url and hosted qr", () => {
    const links = buildAttendeeMailLinks(
      {
        id: "att-agency",
        public_ref: PUBLIC_REF,
        qr_payload: "https://agency.example.com/ticket/123",
        external_uuid: null,
      },
      EVENT,
      BASE,
    );
    expect(links.ticket_url).toBe("https://agency.example.com/ticket/123");
    expect(links.qr_image_url).toBe(`${BASE}/q/summer-gala/a/${PUBLIC_REF}.png`);
    expect(links.qr_image_url).not.toContain("att-agency");
  });

  it("Mode B — non-URL payload uses Admitto routes with public_ref", () => {
    const links = buildAttendeeMailLinks(
      {
        id: "att-b2",
        public_ref: PUBLIC_REF,
        qr_payload: "AGENCY-QR-001",
        external_uuid: null,
      },
      EVENT,
      BASE,
    );
    expect(links.ticket_url).toBe(`${BASE}/t/summer-gala/a/${PUBLIC_REF}`);
    expect(links.qr_image_url).toBe(`${BASE}/q/summer-gala/a/${PUBLIC_REF}.png`);
    expect(links.ticket_url).not.toContain("att-b2");
  });

  it("Mode B — throws when public_ref missing", () => {
    expect(() =>
      buildAttendeeMailLinks(
        { id: "att-b2", public_ref: null, qr_payload: "X", external_uuid: null },
        EVENT,
        BASE,
      ),
    ).toThrow("missing public_ref");
  });
});

describe("buildAttendeeMailLinks - the event's own address (D-C6)", () => {
  const OWN = "https://summit.acme.example";
  const VERIFIED_AT = new Date("2026-11-11T10:00:00Z");
  const withDomain = (verifiedAt: Date | null, extra: object = {}) => ({
    ...EVENT_WITH_WALLET,
    ...extra,
    registration_settings: { custom_domain: "summit.acme.example", custom_domain_verified_at: verifiedAt },
  });
  const INTERNAL = { id: "att-1", public_ref: null, qr_payload: null, external_uuid: null };
  const TOKEN = "tok_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
  const AGENCY = { id: "att-b", public_ref: PUBLIC_REF, qr_payload: "AGENCY-QR-001", external_uuid: null };

  it("sends the ticket page and the QR image to the event's address once it is verified, and the wallet to the instance", () => {
    const links = buildAttendeeMailLinks(INTERNAL, withDomain(VERIFIED_AT), BASE, TOKEN);
    expect(links.ticket_url).toBe(`${OWN}/t/${TOKEN}`);
    expect(links.qr_image_url).toBe(`${OWN}/q/${TOKEN}.png`);
    expect(links.apple_wallet_url).toBe(`${BASE}/t/${TOKEN}/wallet/apple`);
    expect(links.google_wallet_url).toBe(`${BASE}/t/${TOKEN}/wallet/google`);
  });

  it("does the same for a ticket that has a reference (agency) and no token", () => {
    const links = buildAttendeeMailLinks(AGENCY, withDomain(VERIFIED_AT), BASE);
    expect(links.ticket_url).toBe(`${OWN}/t/summer-gala/a/${PUBLIC_REF}`);
    expect(links.qr_image_url).toBe(`${OWN}/q/summer-gala/a/${PUBLIC_REF}.png`);
    expect(links.apple_wallet_url).toBe(`${BASE}/t/summer-gala/a/${PUBLIC_REF}/wallet/apple`);
  });

  it("keeps an agency's own ticket address as it is, and still hosts the QR image on the event's address", () => {
    const agency = { ...AGENCY, qr_payload: "https://agency.example.com/ticket/123" };
    const links = buildAttendeeMailLinks(agency, withDomain(VERIFIED_AT), BASE);
    expect(links.ticket_url).toBe("https://agency.example.com/ticket/123");
    expect(links.qr_image_url).toBe(`${OWN}/q/summer-gala/a/${PUBLIC_REF}.png`);
  });

  it("uses the instance for everything while the address is set but not verified", () => {
    const links = buildAttendeeMailLinks(INTERNAL, withDomain(null), BASE, TOKEN);
    expect(links.ticket_url).toBe(`${BASE}/t/${TOKEN}`);
    expect(links.qr_image_url).toBe(`${BASE}/q/${TOKEN}.png`);
    for (const url of Object.values(links)) expect(url).not.toContain("acme.example");
  });

  it("uses the instance for everything when the event has no address of its own", () => {
    const links = buildAttendeeMailLinks(INTERNAL, EVENT_WITH_WALLET, BASE, TOKEN);
    for (const url of Object.values(links)) expect(new URL(url).origin).toBe(BASE);
  });

  it("puts no link of the instance in a ticket or a QR link of an event with a verified address", () => {
    const links = buildAttendeeMailLinks(INTERNAL, withDomain(VERIFIED_AT), `${BASE}/`, TOKEN);
    expect(links.ticket_url).not.toContain("tickets.example.com");
    expect(links.qr_image_url).not.toContain("tickets.example.com");
  });
});

describe("buildConfirmUrl", () => {
  it("builds /r/{slug}/confirm/{id}.{mac} on the guest origin", () => {
    const url = buildConfirmUrl(BASE, "summer-gala", "reg_1");
    expect(url).toBe(
      `${BASE}/r/summer-gala/confirm/reg_1.${signRegistrationConfirm("reg_1")}`,
    );
    const [registrationId, mac] = url.split("/confirm/")[1]!.split(".");
    expect(verifyRegistrationConfirm(registrationId!, mac!)).toBe(true);
  });

  it("gives the same link every time for the same registration, and ignores a trailing slash", () => {
    expect(buildConfirmUrl(`${BASE}/`, "summer-gala", "reg_1")).toBe(
      buildConfirmUrl(BASE, "summer-gala", "reg_1"),
    );
  });

  it("gives another registration another link", () => {
    expect(buildConfirmUrl(BASE, "summer-gala", "reg_2")).not.toBe(
      buildConfirmUrl(BASE, "summer-gala", "reg_1"),
    );
  });
});
