import { describe, expect, it } from "vitest";
import { extractPlaceholderTokens } from "../src/placeholders.js";

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
