import { describe, expect, it } from "vitest";
import { extractPlaceholderNamesFromHtml, extractPlaceholderTokens } from "../src/placeholders.js";

describe("extractPlaceholderTokens", () => {
  it("preserves valid and malformed token contents in source order", () => {
    expect(extractPlaceholderTokens("Hi {{first_name}} — {{ First_Name }} — {{}}"))
      .toEqual(["first_name", " First_Name ", ""]);
  });

  it("ignores an invalid single closing brace and finds a later valid token", () => {
    expect(extractPlaceholderTokens("{{malformed}token}} {{first_name}}")).toEqual(["first_name"]);
  });

  it("handles an unterminated nested-delimiter payload without regex backtracking", () => {
    const maliciousTemplate = "{{{{|".repeat(10_000);

    expect(extractPlaceholderTokens(maliciousTemplate)).toEqual([]);
  });

  it("advances past a single closing brace without rescanning earlier openings", () => {
    const maliciousTemplate = `${"{{".repeat(10_000)}}`;

    expect(extractPlaceholderTokens(maliciousTemplate)).toEqual([]);
  });
});

describe("extractPlaceholderNamesFromHtml", () => {
  it("excludes a whitelisted token sitting inside an HTML comment", () => {
    // Regression coverage (CodeRabbit, PR #1212): a template save already rejects this exact
    // combination (assertRenderableCompiledHtml), but a caller reading already-compiled HTML -
    // like mail-delivery's own wallet-CTA detection - must not treat a commented-out reference as
    // a live one either, independent of that write-time guarantee.
    expect(extractPlaceholderNamesFromHtml("<!-- {{apple_wallet_url}} --><p>Hi {{first_name}}</p>"))
      .toEqual(["first_name"]);
  });

  it("excludes a token inside an Outlook conditional comment", () => {
    expect(extractPlaceholderNamesFromHtml("<!--[if mso]>{{google_wallet_url}}<![endif]-->")).toEqual([]);
  });

  it("includes a token that merely follows a closed, unrelated comment", () => {
    expect(extractPlaceholderNamesFromHtml("<!-- note --><a href=\"{{apple_wallet_url}}\">Add</a>"))
      .toEqual(["apple_wallet_url"]);
  });

  it("drops a name outside the static whitelist", () => {
    expect(extractPlaceholderNamesFromHtml("{{not_a_real_placeholder}}")).toEqual([]);
  });
});
