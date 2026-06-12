import { describe, expect, it } from "vitest";
import {
  escapeHtmlAttribute,
  escapeHtmlText,
  renderTemplate,
  validateHttpUrl,
  InvalidHttpUrlError,
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
  it("substitutes known placeholders and escapes HTML in text", () => {
    const result = renderTemplate(
      {
        subject: "Hello {{first_name}}",
        compiledHtml: "<p>Hi {{first_name}}, company &lt;test&gt;</p>",
      },
      { first_name: `O'Brien <img>` },
    );
    expect(result.subject).toBe("Hello O'Brien &lt;img&gt;");
    expect(result.html).toContain("Hi O'Brien &lt;img&gt;");
  });

  it("throws on unknown placeholder", () => {
    expect(() =>
      renderTemplate(
        { subject: "Hi", compiledHtml: "<p>{{unknown_field}}</p>" },
        {},
      ),
    ).toThrow(/Unknown template placeholders/);
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
