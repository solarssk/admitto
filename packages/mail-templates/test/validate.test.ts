import { describe, expect, it } from "vitest";
import { findMissingRequiredPlaceholders } from "../src/validate.js";

describe("findMissingRequiredPlaceholders", () => {
  it("returns both required placeholders (sorted) when neither appears", () => {
    expect(findMissingRequiredPlaceholders("Subject", "<p>Hello</p>")).toEqual([
      "qr_image_url",
      "ticket_url",
    ]);
  });

  it("returns an empty array once both appear, across subject and body", () => {
    expect(
      findMissingRequiredPlaceholders(
        "See your ticket {{ticket_url}}",
        "<img src=\"{{qr_image_url}}\">",
      ),
    ).toEqual([]);
  });

  it("returns only the one still missing", () => {
    expect(
      findMissingRequiredPlaceholders("Subject", "<a href=\"{{ticket_url}}\">Ticket</a>"),
    ).toEqual(["qr_image_url"]);
  });
});
