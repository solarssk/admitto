import { describe, expect, it } from "vitest";
import {
  compileTemplate,
  validateTemplate,
  MjmlCompileError,
} from "../src/index.js";

describe("compileTemplate", () => {
  it("compiles valid MJML to HTML containing placeholders", async () => {
    const html = await compileTemplate(
      `<mjml><mj-body><mj-section><mj-column><mj-text>Hi {{first_name}}</mj-text></mj-column></mj-section></mj-body></mjml>`,
      "mjml",
    );
    expect(html).toContain("{{first_name}}");
    expect(html.toLowerCase()).toContain("<table");
  });

  it("throws MjmlCompileError on invalid MJML", async () => {
    await expect(compileTemplate("<mjml><mj-invalid /></mjml>", "mjml")).rejects.toThrow(
      MjmlCompileError,
    );
  });

  it("passes HTML through unchanged", async () => {
    const html = '<p>Hello {{first_name}}</p>';
    expect(await compileTemplate(html, "html")).toBe(html);
  });
});

describe("validateTemplate", () => {
  it("returns unknown placeholders for mjml and html alike", () => {
    const unknown = validateTemplate({
      subject: "{{bad_one}}",
      body: "<mj-text>{{bad_two}}</mj-text>",
    });
    expect(unknown).toEqual(["bad_one", "bad_two"]);
  });

  it("returns empty list when all placeholders are allowed", () => {
    expect(
      validateTemplate({
        subject: "{{event_name}}",
        body: "Hi {{first_name}} — {{ticket_url}}",
      }),
    ).toEqual([]);
  });
});
