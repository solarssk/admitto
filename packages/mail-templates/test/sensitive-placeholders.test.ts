/**
 * Sensitive attendee fields (D-E6): a mail carries no answer to a question the organiser marked sensitive. The reason it can
 * promise that is that the vocabulary of a template is closed and has no placeholder for a custom field. These tests fail for
 * the change that would open it, so adding one is a decision with a sensitive question in mind, not a side effect.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWED_PLACEHOLDERS } from "../src/placeholders.js";
import { validateTemplate } from "../src/validate.js";

/** Every placeholder a template may use. None of them is the answer to a custom question. A new entry must be added here on
 * purpose, and a placeholder that would carry an answer to a custom question must leave out the questions marked sensitive
 * (`sensitiveSourceFields` in `@admitto/tickets`), with a test of its own. */
const VOCABULARY = [
  "accessibility_text",
  "apple_maps_url",
  "apple_wallet_url",
  "confirm_url",
  "contact_email",
  "contact_line",
  "contact_name",
  "directions_text",
  "download_page_url",
  "email",
  "event_address",
  "event_date",
  "event_hours",
  "event_location",
  "event_map_url",
  "event_name",
  "first_name",
  "full_name",
  "google_maps_url",
  "google_wallet_url",
  "header_image_url",
  "last_name",
  "logo_url",
  "qr_image_url",
  "ticket_type",
  "ticket_url",
];

describe("the vocabulary of a mail template", () => {
  it("is the closed list above, so a new placeholder is a decision", () => {
    expect([...ALLOWED_PLACEHOLDERS].sort()).toEqual(VOCABULARY);
  });

  it("has no placeholder named after a custom field", () => {
    expect([...ALLOWED_PLACEHOLDERS].filter((name) => /^custom|answer|health|diet|allerg|disab|access_need/.test(name))).toEqual([]);
  });

  it("refuses a placeholder that names a custom field, in the subject and in the body", () => {
    const unknown = validateTemplate({ subject: "{{custom:health}}", body: "<p>{{custom_health}} {{health}} {{custom_data}} {{first_name}}</p>" });

    expect(unknown).toEqual(expect.arrayContaining(["custom:health", "custom_health", "health", "custom_data"]));
    expect(unknown).not.toContain("first_name");
  });
});

describe("the code that builds a mail", () => {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) return ["node_modules", "dist", "test"].includes(entry) ? [] : files(full);
      return /\.tsx?$/.test(entry) ? [full] : [];
    });
  }

  it("never reads the answers of an attendee (custom_data) in the template or the delivery package", () => {
    const readers = ["mail-templates", "mail-delivery", "mailer"]
      .flatMap((pkg) => files(path.join(ROOT, pkg, "src")))
      .filter((file) => /custom_data|customData/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(ROOT, file));

    expect(readers).toEqual([]);
  });
});
