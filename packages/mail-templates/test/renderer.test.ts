import { describe, expect, it } from "vitest";
import {
  absolutizeBundledTicketAssetUrls,
  escapeHtmlAttribute,
  escapeHtmlText,
  renderTemplate,
  renderTemplateTrusted,
  renderTemplateTrustedForStorage,
  materializeStoredDeliveryMessage,
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

  it("absolutizes bundled wallet badge asset paths when baseUrl is set", () => {
    expect(
      absolutizeBundledTicketAssetUrls(
        '<img src="/assets/apple-wallet-badge.svg" /><img src="/assets/google-wallet-badge.svg" />',
        "https://tickets.example.com/",
      ),
    ).toBe(
      '<img src="https://tickets.example.com/assets/apple-wallet-badge.svg" /><img src="https://tickets.example.com/assets/google-wallet-badge.svg" />',
    );
    expect(
      absolutizeBundledTicketAssetUrls('<img src="/assets/apple-wallet-badge.svg" />'),
    ).toBe('<img src="/assets/apple-wallet-badge.svg" />');

    // PNG variant: the format the wallet-button placeholder actually inserts into mail bodies
    // (classic Outlook desktop doesn't render SVG <img> sources).
    expect(
      absolutizeBundledTicketAssetUrls(
        '<img src="/assets/apple-wallet-badge.png" /><img src="/assets/google-wallet-badge.png" />',
        "https://tickets.example.com/",
      ),
    ).toBe(
      '<img src="https://tickets.example.com/assets/apple-wallet-badge.png" /><img src="https://tickets.example.com/assets/google-wallet-badge.png" />',
    );

    const rendered = renderTemplate(
      {
        subject: "Ticket",
        compiledHtml:
          '<mj-image href="{{apple_wallet_url}}" src="/assets/apple-wallet-badge.svg" alt="Add to Apple Wallet" />',
      },
      { apple_wallet_url: "https://wallet.example.com/pass" },
      { baseUrl: "https://tickets.example.com" },
    );
    expect(rendered.html).toContain(
      'src="https://tickets.example.com/assets/apple-wallet-badge.svg"',
    );
    expect(rendered.html).toContain('href="https://wallet.example.com/pass"');
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

  it("leaves apple_wallet_url/google_wallet_url literal in frozen snapshot, same as ticket_url", () => {
    const frozen = renderTemplateTrustedForStorage(
      {
        subject: "Ticket for {{first_name}}",
        compiledHtml:
          '<a href="{{apple_wallet_url}}">Apple</a><a href="{{google_wallet_url}}">Google</a>',
      },
      {
        first_name: "Alice",
        apple_wallet_url: "https://secret.example/t/SHOULD_NOT_PERSIST/wallet/apple",
        google_wallet_url: "https://secret.example/t/SHOULD_NOT_PERSIST/wallet/google",
      },
    );
    expect(frozen.html).toContain('href="{{apple_wallet_url}}"');
    expect(frozen.html).toContain('href="{{google_wallet_url}}"');
    expect(frozen.html).not.toContain("SHOULD_NOT_PERSIST");
  });

  it("materializeStoredDeliveryMessage applies wallet links at send time, including in the subject", () => {
    const frozen = renderTemplateTrustedForStorage(
      {
        subject: "Add to wallet: {{apple_wallet_url}}",
        compiledHtml: '<a href="{{apple_wallet_url}}">Apple</a><a href="{{google_wallet_url}}">Google</a>',
      },
      { first_name: "Bob" },
    );
    const sent = materializeStoredDeliveryMessage(frozen, {
      ticket_url: "https://example.com/t/tok",
      qr_image_url: "https://example.com/q/tok.png",
      apple_wallet_url: "https://example.com/t/tok/wallet/apple",
      google_wallet_url: "https://example.com/t/tok/wallet/google",
    });
    expect(sent.subject).toBe("Add to wallet: https://example.com/t/tok/wallet/apple");
    expect(sent.html).toContain('href="https://example.com/t/tok/wallet/apple"');
    expect(sent.html).toContain('href="https://example.com/t/tok/wallet/google"');
    expect(sent.html).not.toContain("{{apple_wallet_url}}");
    expect(sent.html).not.toContain("{{google_wallet_url}}");
  });

  it("materializeStoredDeliveryMessage drops an empty (unconfigured) wallet URL's href attribute", () => {
    const frozen = renderTemplateTrustedForStorage(
      {
        subject: "Hi",
        compiledHtml: '<a href="{{apple_wallet_url}}">Apple</a>',
      },
      { first_name: "Bob" },
    );
    const sent = materializeStoredDeliveryMessage(frozen, {
      ticket_url: "https://example.com/t/tok",
      qr_image_url: "https://example.com/q/tok.png",
      apple_wallet_url: "",
      google_wallet_url: "",
    });
    expect(sent.html).not.toContain("href=");
  });

  it("materializeStoredDeliveryMessage treats a missing wallet link key like an empty one", () => {
    const frozen = renderTemplateTrustedForStorage(
      {
        subject: "Hi",
        compiledHtml: '<a href="{{apple_wallet_url}}">Apple</a>',
      },
      { first_name: "Bob" },
    );
    const sent = materializeStoredDeliveryMessage(frozen, {
      ticket_url: "https://example.com/t/tok",
      qr_image_url: "https://example.com/q/tok.png",
    });
    expect(sent.html).not.toContain("href=");
  });
});
