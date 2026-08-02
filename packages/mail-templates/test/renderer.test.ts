import { describe, expect, it } from "vitest";
import {
  escapeHtmlAttribute,
  escapeHtmlText,
  renderTemplate,
  renderTemplateTrusted,
  renderTemplateTrustedForStorage,
  materializeStoredDeliveryMessage,
  materializeStoredDeliveryMessageRedacted,
  validateHttpUrl,
  InvalidHttpUrlError,
  MissingRequiredPlaceholderError,
  UnquotedAttributePlaceholderError,
  PlaceholderInHtmlCommentError,
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

  it("throws on whitespace-padded placeholder tokens", () => {
    expect(() =>
      renderTemplate(
        { subject: "Hi {{ first_name }}", compiledHtml: "<p>ok</p>" },
        { first_name: "Alex" },
      ),
    ).toThrow(/Unknown template placeholders: first_name/);
  });

  it("rejects placeholders inside Outlook conditional comments at render time", () => {
    expect(() =>
      renderTemplate(
        {
          subject: "T",
          compiledHtml: '<!--[if mso]><td title="{{first_name}}"><![endif]-->',
        },
        { first_name: 'x" onmouseover=alert(1)' },
      ),
    ).toThrow(PlaceholderInHtmlCommentError);
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

  it("rejects placeholders in attribute-name position at render time", () => {
    expect(() =>
      renderTemplate(
        {
          subject: "T",
          compiledHtml: '<td {{first_name}} onmouseover=alert(1)>Hi</td>',
        },
        { first_name: "" },
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

  it("renders event location URLs and strips an empty map image src", () => {
    const withMap = renderTemplate(
      {
        subject: "Getting there",
        compiledHtml:
          '<img src="{{event_map_url}}" alt="Map" /><a href="{{google_maps_url}}">Google</a><a href="{{apple_maps_url}}">Apple</a>',
      },
      {
        event_map_url: "https://tickets.example.com/m/event-1.png",
        google_maps_url: "https://www.google.com/maps/search/?api=1%26query=50%2C19",
        apple_maps_url: "https://maps.apple.com/?ll=50%2C19",
      },
    );
    expect(withMap.html).toContain('src="https://tickets.example.com/m/event-1.png"');
    expect(withMap.html).toContain("https://www.google.com/maps/search/");

    const withoutMap = renderTemplate(
      { subject: "Getting there", compiledHtml: '<img src="{{event_map_url}}" alt="Map" />' },
      { event_map_url: "" },
    );
    expect(withoutMap.html).not.toContain("src=");
  });

  it("absolutizes uploaded logo paths when baseUrl is provided", () => {
    const result = renderTemplate(
      {
        subject: "T",
        compiledHtml: '<img src="{{logo_url}}" alt="logo" width="100" height="50" />',
      },
      { logo_url: "/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png" },
      { baseUrl: "https://tickets.example.com" },
    );
    expect(result.html).toContain(
      'src="https://tickets.example.com/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png"',
    );
  });

  it("rejects uploaded logo paths without baseUrl at render time", () => {
    expect(() =>
      renderTemplate(
        {
          subject: "T",
          compiledHtml: '<img src="{{logo_url}}" alt="logo" width="100" height="50" />',
        },
        { logo_url: "/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png" },
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

describe("renderTemplateTrusted", () => {
  it("escapes HTML without re-validating placeholder whitelist", () => {
    const result = renderTemplateTrusted(
      {
        subject: "Hello {{first_name}}",
        compiledHtml: "<p>Hi {{first_name}}</p>",
      },
      { first_name: `Tom <script>alert(1)</script>` },
    );
    expect(result.subject).toBe("Hello Tom <script>alert(1)</script>");
    expect(result.html).toContain("Hi Tom &lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("does not throw on templates that would fail whitelist validation at save time", () => {
    expect(() =>
      renderTemplateTrusted(
        {
          subject: "Hi",
          compiledHtml: "<p>{{not_on_whitelist}}</p>",
        },
        { first_name: "Alex" },
      ),
    ).not.toThrow();
  });
});

describe("renderTemplateTrustedForStorage", () => {
  it("leaves ticket link placeholders literal in frozen snapshot", () => {
    const frozen = renderTemplateTrustedForStorage(
      {
        subject: "Ticket for {{first_name}}",
        compiledHtml:
          '<a href="{{ticket_url}}">Open</a><img src="{{qr_image_url}}" alt="QR" />',
      },
      {
        first_name: "Alice",
        ticket_url: "https://secret.example/t/SHOULD_NOT_PERSIST",
        qr_image_url: "https://secret.example/q/SHOULD_NOT_PERSIST.png",
      },
    );
    expect(frozen.html).toContain('href="{{ticket_url}}"');
    expect(frozen.html).toContain('src="{{qr_image_url}}"');
    expect(frozen.html).not.toContain("SHOULD_NOT_PERSIST");
    expect(frozen.subject).toBe("Ticket for Alice");
  });

  it("materializeStoredDeliveryMessage applies links with escaping at send time", () => {
    const frozen = renderTemplateTrustedForStorage(
      {
        subject: "Hi",
        compiledHtml: '<a href="{{ticket_url}}">x</a>',
      },
      { first_name: "Bob" },
    );
    const sent = materializeStoredDeliveryMessage(frozen, {
      ticket_url: "https://example.com/t?a=1&b=2",
      qr_image_url: "https://example.com/q/x.png",
    });
    expect(sent.html).toContain('href="https://example.com/t?a=1&amp;b=2"');
    expect(sent.html).not.toContain("{{ticket_url}}");
  });
});

describe("materializeStoredDeliveryMessageRedacted", () => {
  it("never includes a real ticket_url/qr_image_url, only safe placeholders", () => {
    const frozen = renderTemplateTrustedForStorage(
      {
        subject: "Ticket for {{first_name}}, link: {{ticket_url}}",
        compiledHtml:
          '<a href="{{ticket_url}}">Open ticket</a><img src="{{qr_image_url}}" alt="QR" width="200" height="200" />',
      },
      { first_name: "Alice" },
    );

    const redacted = materializeStoredDeliveryMessageRedacted(frozen);

    // The literal placeholder tokens must be gone in both subject and html.
    expect(redacted.subject).not.toContain("{{ticket_url}}");
    expect(redacted.html).not.toContain("{{ticket_url}}");
    expect(redacted.html).not.toContain("{{qr_image_url}}");

    // The ticket link must be inert, never a real/navigable URL.
    expect(redacted.html).toContain('href="#"');
    expect(redacted.subject).toContain("#");

    // The QR image must be a local inline SVG data URI, never a fetchable URL that could
    // reveal or proxy the recipient's real scannable QR code.
    expect(redacted.html).toMatch(/src="data:image\/svg\+xml/);
    expect(redacted.html).not.toContain("http://");
    expect(redacted.html).not.toContain("https://");

    // Other, non-deferred placeholders are untouched by redaction.
    expect(redacted.subject).toContain("Alice");
  });

  it("never leaks a real ticket_url/qr_image_url even if the frozen snapshot somehow held one", () => {
    // Defense in depth: even if a future bug stored a real resolved value instead of the
    // literal placeholder token, redaction must still only ever emit the safe constants —
    // it must not "pass through" whatever text preceded it.
    const redacted = materializeStoredDeliveryMessageRedacted({
      subject: "See {{ticket_url}}",
      html: '<a href="{{ticket_url}}">go</a><img src="{{qr_image_url}}" />',
    });
    expect(redacted.subject).toBe("See #");
    expect(redacted.html).toContain('href="#"');
    expect(redacted.html).toMatch(/^<a href="#">go<\/a><img src="data:image\/svg\+xml/);
  });

  it("leaves non-deferred placeholders literal (only ticket_url/qr_image_url are redacted)", () => {
    const redacted = materializeStoredDeliveryMessageRedacted({
      subject: "Hi {{first_name}}",
      html: "<p>{{event_name}}</p>",
    });
    expect(redacted.subject).toBe("Hi {{first_name}}");
    expect(redacted.html).toBe("<p>{{event_name}}</p>");
  });

  it("redacts a ticket_url/qr_image_url placeholder that appears in HTML text content, not inside a quoted attribute", () => {
    const redacted = materializeStoredDeliveryMessageRedacted({
      subject: "See {{ticket_url}}",
      html: "<p>Link: {{ticket_url}}</p><p>QR: {{qr_image_url}}</p>",
    });

    expect(redacted.html).not.toContain("{{ticket_url}}");
    expect(redacted.html).not.toContain("{{qr_image_url}}");
    expect(redacted.html).toContain("<p>Link: #</p>");
    expect(redacted.html).toMatch(/<p>QR: data:image\/svg\+xml/);
  });
});
