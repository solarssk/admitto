import { describe, expect, it } from "vitest";
import { getHtmlAttributeContext } from "../src/htmlContext.js";

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

  it("handles apostrophe inside double-quoted attribute value", () => {
    const result = ctxAt('<td title="Guest\'s {{first_name}}">Hi</td>');
    expect(result.inQuotedAttribute).toBe(true);
  });

  it("handles inner double quotes inside single-quoted attribute", () => {
    const result = ctxAt("<td title='Badge type=\"VIP\" for {{first_name}}'>Hi</td>");
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

  it("treats placeholder in later attribute on multi-attribute tag as quoted", () => {
    const result = ctxAt('<td class="label" title="{{first_name}}">Hi</td>');
    expect(result.inQuotedAttribute).toBe(true);
  });

  it("treats self-closing tags with quoted attributes as in-tag", () => {
    const result = ctxAt('<img alt="{{first_name}}" width="100" />');
    expect(result.inTag).toBe(true);
    expect(result.inQuotedAttribute).toBe(true);
  });

  it("ignores placeholders inside HTML comments", () => {
    const result = ctxAt("<!-- hidden {{first_name}} -->");
    expect(result.inTag).toBe(false);
    expect(result.inQuotedAttribute).toBe(false);
  });

  it("ignores placeholders inside script element text", () => {
    const result = ctxAt("<script>var x = '{{first_name}}';</script>");
    expect(result.inTag).toBe(false);
  });

  it("ignores placeholders inside style element text", () => {
    const result = ctxAt("<style>.x::before { content: '{{first_name}}'; }</style>");
    expect(result.inTag).toBe(false);
  });

  it("treats placeholders in element text as outside attributes", () => {
    const result = ctxAt("<p>Hello {{first_name}}</p>");
    expect(result.inTag).toBe(false);
  });
});
