import { describe, expect, it } from "vitest";
import {
  compileTemplate,
  validateTemplate,
  assertValidTemplate,
  findPlaceholdersInHtmlComments,
  getBuiltinTemplate,
  renderTemplate,
  DEFAULT_SAMPLE_VARS,
  MjmlCompileError,
  PlaceholderInHtmlCommentError,
  UnquotedAttributePlaceholderError,
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

  it("keeps mj-button href placeholders outside HTML comments after MJML compile", async () => {
    const html = await compileTemplate(
      `<mjml><mj-body><mj-section><mj-column>
        <mj-button href="{{ticket_url}}">View your ticket</mj-button>
      </mj-column></mj-section></mj-body></mjml>`,
      "mjml",
    );
    expect(html).toContain('href="{{ticket_url}}"');
    expect(findPlaceholdersInHtmlComments(html)).toEqual([]);
  });

  it("builtin default MJML compiles to renderable HTML", async () => {
    const builtin = await getBuiltinTemplate();
    expect(findPlaceholdersInHtmlComments(builtin.compiledHtmlTemplate)).toEqual([]);
    const rendered = renderTemplate(
      {
        subject: builtin.subjectTemplate,
        compiledHtml: builtin.compiledHtmlTemplate,
      },
      DEFAULT_SAMPLE_VARS,
    );
    expect(rendered.html).toContain("tickets.example.com");
    expect(rendered.html).toContain("View your ticket");
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

  it("rejects malformed placeholder tokens", () => {
    expect(
      validateTemplate({
        subject: "Hi {{First_Name}}",
        body: "<p>{{first-name}}</p>",
      }),
    ).toEqual(["First_Name", "first-name"]);
  });

  it("rejects empty placeholder tokens", () => {
    expect(validateTemplate({ subject: "{{}}", body: "<p>ok</p>" })).toEqual(["{{}}"]);
  });

  it("rejects whitespace-padded placeholder tokens", () => {
    expect(
      validateTemplate({
        subject: "Hi {{ first_name }}",
        body: "<p>{{event_name}}</p>",
      }),
    ).toEqual(["first_name"]);
    expect(() =>
      assertValidTemplate({
        subject: "Hi",
        body: "<p>{{ ticket_url }}</p>",
      }),
    ).toThrow(/Unknown template placeholders: ticket_url/);
  });

  it("rejects unquoted attribute placeholders", () => {
    expect(() =>
      assertValidTemplate({
        subject: "Hi",
        body: '<img alt={{first_name}} width="100" />',
      }),
    ).toThrow(UnquotedAttributePlaceholderError);
  });

  it("rejects placeholders inside Outlook conditional comments", () => {
    expect(() =>
      assertValidTemplate({
        subject: "Hi",
        body: '<!--[if mso]><td title="{{first_name}}"><![endif]-->',
      }),
    ).toThrow(PlaceholderInHtmlCommentError);
  });

  it("rejects unquoted attributes with literal prefixes before placeholder", () => {
    expect(() =>
      assertValidTemplate({
        subject: "Hi",
        body: '<img alt=x{{first_name}} width="100" />',
      }),
    ).toThrow(UnquotedAttributePlaceholderError);
  });
});
