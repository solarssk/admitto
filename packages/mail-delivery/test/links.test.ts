import { describe, expect, it } from "vitest";
import { buildAttendeeMailLinks } from "../src/links.js";

const BASE = "https://tickets.example.com";
const EVENT = {
  slug: "summer-gala",
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
