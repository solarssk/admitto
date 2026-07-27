import { describe, expect, it } from "vitest";
import { getHtmlAttributeContext, isInsideQuotedAttribute } from "../src/htmlContext.js";

const PH = "{{first_name}}";

function ctxAt(html: string, needle = PH): ReturnType<typeof getHtmlAttributeContext> {
  const index = html.indexOf(needle);
  expect(index).toBeGreaterThanOrEqual(0);
  return getHtmlAttributeContext(html, index);
}

describe("getHtmlAttributeContext", () => {
  it("treats placeholder in double-quoted attribute as quoted", () => {
    const result = ctxAt('<td title="{{first_name}}">Hi</td>');
    expect(result.inTag).toBe(true);
    expect(result.inQuotedAttribute).toBe(true);
    expect(result.unquotedAttributeName).toBeNull();
  });

  it.each([
    {
      name: "handles apostrophe inside double-quoted attribute value",
      html: '<td title="Guest\'s {{first_name}}">Hi</td>',
    },
    {
      name: "handles inner double quotes inside single-quoted attribute",
      html: "<td title='Badge type=\"VIP\" for {{first_name}}'>Hi</td>",
    },
    {
      name: "treats placeholder in later attribute on multi-attribute tag as quoted",
      html: '<td class="label" title="{{first_name}}">Hi</td>',
    },
  ])("$name", ({ html }) => {
    const result = ctxAt(html);
    expect(result.inQuotedAttribute).toBe(true);
  });

  it("handles greater-than inside quoted attribute value", () => {
    const result = ctxAt('<td title="2 > {{first_name}}">Hi</td>');
    expect(result.inQuotedAttribute).toBe(true);
    expect(result.inTag).toBe(true);
  });

  it("ends unquoted numeric attribute before the next quoted attribute", () => {
    const result = ctxAt('<img width=100 alt="{{first_name}}">');
    expect(result.inQuotedAttribute).toBe(true);
    expect(result.unquotedAttributeName).toBeNull();
  });

  it("detects unquoted attribute with literal prefix", () => {
    const result = ctxAt('<img alt=x{{first_name}} width="100">');
    expect(result.unquotedAttributeName).toBe("alt");
  });

  it("detects unquoted attribute when placeholder follows equals directly", () => {
    const result = ctxAt('<img alt={{first_name}} width="100">');
    expect(result.unquotedAttributeName).toBe("alt");
  });

  it("detects placeholder used as a pseudo attribute name", () => {
    const bare = ctxAt("<td {{first_name}}>Hi</td>");
    expect(bare.inTag).toBe(true);
    expect(bare.inBareTagMarkup).toBe(true);
    expect(bare.inQuotedAttribute).toBe(false);
    expect(bare.unquotedAttributeName).toBeNull();

    const withValue = ctxAt('<td {{first_name}}="x">Hi</td>');
    expect(withValue.inBareTagMarkup).toBe(true);
  });

  it("treats self-closing tags with quoted attributes as in-tag", () => {
    const result = ctxAt('<img alt="{{first_name}}" width="100" />');
    expect(result.inTag).toBe(true);
    expect(result.inQuotedAttribute).toBe(true);
  });

  it("does not treat a placeholder after a self-closing tag as tag markup", () => {
    const result = ctxAt("<img alt=\"name\" />{{first_name}}");

    expect(result).toEqual({
      inTag: false,
      inQuotedAttribute: false,
      unquotedAttributeName: null,
      inBareTagMarkup: false,
    });
  });

  it("treats a value as quoted when whitespace separates the equals sign and quote", () => {
    const result = ctxAt('<td title =  "{{first_name}}">Hi</td>');
    expect(result.inTag).toBe(true);
    expect(result.inQuotedAttribute).toBe(true);
  });

  it("does not treat a placeholder after a closing tag as tag markup", () => {
    const result = ctxAt("<p>Hi</p>{{first_name}}");
    expect(result).toEqual({
      inTag: false,
      inQuotedAttribute: false,
      unquotedAttributeName: null,
      inBareTagMarkup: false,
    });
  });

  it("exposes the quoted-attribute convenience check", () => {
    const quoted = '<td title="{{first_name}}">Hi</td>';
    const plain = "<p>Hello {{first_name}}</p>";

    expect(isInsideQuotedAttribute(quoted, quoted.indexOf(PH))).toBe(true);
    expect(isInsideQuotedAttribute(plain, plain.indexOf(PH))).toBe(false);
  });

  it("ignores placeholders inside HTML comments", () => {
    const result = ctxAt("<!-- hidden {{first_name}} -->");
    expect(result.inTag).toBe(false);
    expect(result.inQuotedAttribute).toBe(false);
  });

  it.each([
    {
      name: "ignores placeholders inside script element text",
      html: "<script>var x = '{{first_name}}';</script>",
    },
    {
      name: "ignores placeholders inside style element text",
      html: "<style>.x::before { content: '{{first_name}}'; }</style>",
    },
    {
      name: "treats placeholders in element text as outside attributes",
      html: "<p>Hello {{first_name}}</p>",
    },
  ])("$name", ({ html }) => {
    const result = ctxAt(html);
    expect(result.inTag).toBe(false);
  });
});
