import { describe, expect, it } from "vitest";
import { buildAttendeeMailLinks } from "../src/links.js";

const BASE = "https://tickets.example.com";
const EVENT = { slug: "summer-gala" };

describe("buildAttendeeMailLinks", () => {
  it("Mode A — internal token links", () => {
    const links = buildAttendeeMailLinks(
      { id: "att-1", qr_payload: null, external_uuid: null },
      EVENT,
      BASE,
      "tok_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
    );
    expect(links.ticket_url).toBe(`${BASE}/t/tok_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij`);
    expect(links.qr_image_url).toBe(`${BASE}/q/tok_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij.png`);
  });

  it("Mode B — agency URL payload uses external ticket_url and hosted qr", () => {
    const links = buildAttendeeMailLinks(
      {
        id: "att-agency",
        qr_payload: "https://agency.example.com/ticket/123",
        external_uuid: null,
      },
      EVENT,
      BASE,
    );
    expect(links.ticket_url).toBe("https://agency.example.com/ticket/123");
    expect(links.qr_image_url).toBe(`${BASE}/q/summer-gala/a/att-agency.png`);
  });

  it("Mode B — non-URL payload uses Admitto routes for both", () => {
    const links = buildAttendeeMailLinks(
      {
        id: "att-b2",
        qr_payload: "AGENCY-QR-001",
        external_uuid: null,
      },
      EVENT,
      BASE,
    );
    expect(links.ticket_url).toBe(`${BASE}/t/summer-gala/a/att-b2`);
    expect(links.qr_image_url).toBe(`${BASE}/q/summer-gala/a/att-b2.png`);
  });
});
