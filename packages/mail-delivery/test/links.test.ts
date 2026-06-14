import { describe, expect, it } from "vitest";
import { buildAttendeeMailLinks } from "../src/links.js";

const BASE = "https://tickets.example.com";
const EVENT = { slug: "summer-gala" };
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
