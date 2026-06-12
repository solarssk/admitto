import { describe, expect, it } from "vitest";
import {
  escapeHtmlAttribute,
  escapeHtmlText,
  renderTemplate,
  validateHttpUrl,
  InvalidHttpUrlError,
  MissingRequiredPlaceholderError,
  UnquotedAttributePlaceholderError,
} from "../src/index.js";

describe("escape helpers", () => {
  it("escapeHtmlText encodes <>&", () => {
    expect(escapeHtmlText(`Tom & "Jerry" <script>`)).toBe(
      `Tom &amp; "Jerry" &lt;script&gt;`,
    );
  });

  it("escapeHtmlAttribute encodes quotes", () => {
    expect(escapeHtmlAttribute(`a"b'c`)).toBe(`a&quot;b&#39;c`);
  });

  it("validateHttpUrl accepts http(s) and rejects others", () => {
    expect(validateHttpUrl("ticket_url", "https://example.com/t")).toBe(
      "https://example.com/t",
    );
    expect(() => validateHttpUrl("ticket_url", "javascript:alert(1)")).toThrow(
      InvalidHttpUrlError,
    );
    expect(validateHttpUrl("ticket_url", "")).toBe("");
  });
});

describe("renderTemplate", () => {
  it("substitutes known placeholders; subject is plain text, HTML body is escaped", () => {
    const result = renderTemplate(
      {
        subject: "Hello {{first_name}} — {{event_name}}",
        compiledHtml: "<p>Hi {{first_name}}, company &lt;test&gt;</p>",
      },
      { first_name: `Tom & Jerry <VIP>`, event_name: "A & B" },
    );
    expect(result.subject).toBe("Hello Tom & Jerry <VIP> — A & B");
    expect(result.html).toContain("Hi Tom &amp; Jerry &lt;VIP&gt;");
  });

  it("throws on unknown placeholder", () => {
    expect(() =>
      renderTemplate(
        { subject: "Hi", compiledHtml: "<p>{{unknown_field}}</p>" },
        {},
      ),
    ).toThrow(/Unknown template placeholders/);
  });

  it("throws on malformed placeholder tokens", () => {
    expect(() =>
      renderTemplate(
        { subject: "Hi {{First_Name}}", compiledHtml: "<p>ok</p>" },
        {},
      ),
    ).toThrow(/Unknown template placeholders: First_Name/);
  });

  it("rejects unquoted attribute placeholders at render time", () => {
    expect(() =>
      renderTemplate(
        {
          subject: "T",
          compiledHtml: '<img alt={{first_name}} width="100" />',
        },
        { first_name: 'x onerror=alert(1)' },
      ),
    ).toThrow(UnquotedAttributePlaceholderError);
  });

  it("escapes quoted attribute placeholders", () => {
    const result = renderTemplate(
      {
        subject: "T",
        compiledHtml: '<img alt="{{first_name}}" width="100" />',
      },
      { first_name: 'x" onerror=alert(1)' },
    );
    expect(result.html).toBe('<img alt="x&quot; onerror=alert(1)" width="100" />');
  });

  it("escapes placeholders in double-quoted attributes that contain apostrophes", () => {
    const result = renderTemplate(
      {
        subject: "T",
        compiledHtml: '<td title="Guest\'s {{first_name}}">Hi</td>',
      },
      { first_name: 'x" onmouseover=alert(1)' },
    );
    expect(result.html).toBe(
      '<td title="Guest\'s x&quot; onmouseover=alert(1)">Hi</td>',
    );
  });

  it("escapes placeholders in single-quoted attributes that contain double quotes", () => {
    const result = renderTemplate(
      {
        subject: "T",
        compiledHtml: "<td title='Say \"hi\" {{first_name}}'>Hi</td>",
      },
      { first_name: "x' onclick=alert(1)" },
    );
    expect(result.html).toBe(
      "<td title='Say \"hi\" x&#39; onclick=alert(1)'>Hi</td>",
    );
  });

  it("escapes placeholders when attribute value contains inner =\"...\" segment", () => {
    const result = renderTemplate(
      {
        subject: "T",
        compiledHtml: "<td title='Badge type=\"VIP\" for {{first_name}}'>Hi</td>",
      },
      { first_name: "' onmouseover=alert(1)" },
    );
    expect(result.html).toBe(
      "<td title='Badge type=\"VIP\" for &#39; onmouseover=alert(1)'>Hi</td>",
    );
  });

  it("escapes placeholders in later quoted attributes on multi-attribute tags", () => {
    const result = renderTemplate(
      {
        subject: "T",
        compiledHtml: '<td class="label" title="{{first_name}}">Hi</td>',
      },
      { first_name: 'x" onmouseover=alert(1)' },
    );
    expect(result.html).toBe(
      '<td class="label" title="x&quot; onmouseover=alert(1)">Hi</td>',
    );
  });

  it("rejects unquoted attributes with literal prefixes at render time", () => {
    expect(() =>
      renderTemplate(
        {
          subject: "T",
          compiledHtml: '<img alt=x{{first_name}} width="100" />',
        },
        { first_name: " onerror=alert(1)" },
      ),
    ).toThrow(UnquotedAttributePlaceholderError);
  });

  it("throws when required URL placeholders are missing", () => {
    expect(() =>
      renderTemplate(
        {
          subject: "Ticket",
          compiledHtml:
            '<a href="{{ticket_url}}">Open</a><img src="{{qr_image_url}}" width="200" height="200" />',
        },
        {},
      ),
    ).toThrow(MissingRequiredPlaceholderError);
  });

  it("renders wallet placeholders as empty string", () => {
    const result = renderTemplate(
      {
        subject: "Ticket",
        compiledHtml:
          '<a href="{{apple_wallet_url}}">Apple</a><a href="{{google_wallet_url}}">Google</a>',
      },
      {},
    );
    expect(result.html).not.toContain("{{");
    expect(result.html).not.toContain('href=""');
  });

  it("validates URL values at render time", () => {
    expect(() =>
      renderTemplate(
        {
          subject: "T",
          compiledHtml: '<a href="{{ticket_url}}">link</a>',
        },
        { ticket_url: "not-a-url" },
      ),
    ).toThrow(InvalidHttpUrlError);
  });

  it("accepts header_image_url placeholder in HTML", () => {
    const result = renderTemplate(
      {
        subject: "T",
        compiledHtml:
          '<img src="{{header_image_url}}" alt="header" width="600" height="120" />',
      },
      { header_image_url: "https://cdn.example.com/header.png" },
    );
    expect(result.html).toContain('src="https://cdn.example.com/header.png"');
  });

  it("strips empty src when logo_url is empty", () => {
    const result = renderTemplate(
      {
        subject: "T",
        compiledHtml: '<img src="{{logo_url}}" alt="logo" width="100" height="50" />',
      },
      { logo_url: "" },
    );
    expect(result.html).not.toContain('src=""');
    expect(result.html).toContain('alt="logo"');
  });

  it("strips empty action and background URL attributes", () => {
    const result = renderTemplate(
      {
        subject: "T",
        compiledHtml:
          '<form action="{{logo_url}}"><td background="{{header_image_url}}">x</td></form>',
      },
      { logo_url: "", header_image_url: "" },
    );
    expect(result.html).not.toMatch(/\saction\s*=/i);
    expect(result.html).not.toMatch(/\sbackground\s*=/i);
  });

  it("escapes placeholder when quoted attribute value contains greater-than", () => {
    const result = renderTemplate(
      {
        subject: "T",
        compiledHtml: '<td title="2 > {{first_name}}">Hi</td>',
      },
      { first_name: 'x" onmouseover=alert(1)' },
    );
    expect(result.html).toBe('<td title="2 > x&quot; onmouseover=alert(1)">Hi</td>');
  });

  it("allows quoted attribute after unquoted numeric attribute", () => {
    const result = renderTemplate(
      {
        subject: "T",
        compiledHtml: '<img width=100 alt="{{first_name}}" />',
      },
      { first_name: "Alex" },
    );
    expect(result.html).toBe('<img width=100 alt="Alex" />');
  });

  it("attribute-escapes URL placeholders", () => {
    const result = renderTemplate(
      {
        subject: "T",
        compiledHtml: '<a href="{{ticket_url}}">x</a>',
      },
      { ticket_url: "https://example.com/t?a=1&b=2" },
    );
    expect(result.html).toContain('href="https://example.com/t?a=1&amp;b=2"');
  });
});
