import { describe, expect, it } from "vitest";
import { keepLastWords } from "../../src/utils/keep-last-words.js";

const NBSP = " ";

describe("keepLastWords", () => {
  it("joins the last two words, so that a wrapped text never ends on a lone word", () => {
    expect(keepLastWords("Keep the address open to guests, outside any sign-in gateway.")).toBe(`Keep the address open to guests, outside any sign-in${NBSP}gateway.`);
  });

  it("joins the last three when the last two are short", () => {
    expect(keepLastWords("It works as soon as it does.")).toBe(`It works as soon as${NBSP}it${NBSP}does.`);
  });

  it("leaves a text of one or two words alone", () => {
    expect(keepLastWords("Copied.")).toBe("Copied.");
    expect(keepLastWords("Not chosen")).toBe("Not chosen");
  });

  it("changes nothing but spaces", () => {
    const text = "One value on each line, up to 20, each up to 128 characters. A value must match exactly.";
    expect(keepLastWords(text).replaceAll(NBSP, " ")).toBe(text);
  });

  it("joins only the last two words of a text of three", () => {
    expect(keepLastWords("Open it now")).toBe(`Open it${NBSP}now`);
  });
});
