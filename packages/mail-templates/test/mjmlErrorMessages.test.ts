import { describe, expect, it } from "vitest";
import { compileTemplate, friendlyMjmlErrorMessage, MjmlCompileError } from "../src/index.js";

describe("friendlyMjmlErrorMessage", () => {
  it("translates an invalid attribute value error", () => {
    expect(
      friendlyMjmlErrorMessage({
        message: "Attribute color has invalid value: #333333d for type Color ",
        tagName: "mj-text",
        line: 5,
      }),
    ).toBe('The "color" setting has an invalid value ("#333333d") (line 5). Check it for typos.');
  });

  it("translates an invalid Unit value error, dropping the extra detail after the type name", () => {
    expect(
      friendlyMjmlErrorMessage({
        message:
          "Attribute padding has invalid value: 12xy for type Unit, only accepts (px, %) units and 1 to 4 value(s)",
      }),
    ).toBe('The "padding" setting has an invalid value ("12xy"). Check it for typos.');
  });

  it("translates an unknown element error", () => {
    expect(
      friendlyMjmlErrorMessage({ message: "Element mj-bogus doesn't exist or is not registered" }),
    ).toBe('"mj-bogus" isn\'t a recognized MJML element. Check the spelling.');
  });

  it("translates an illegal attribute error", () => {
    expect(friendlyMjmlErrorMessage({ message: "Attribute bogus-attr is illegal" })).toBe(
      '"bogus-attr" isn\'t a valid setting for this element.',
    );
  });

  it("translates an invalid nesting error", () => {
    expect(
      friendlyMjmlErrorMessage({
        message: "mj-button cannot be used inside mj-body, only inside: mj-column, mj-hero",
      }),
    ).toBe('"mj-button" can\'t go directly inside "mj-body". Check where it\'s placed in the body.');
  });

  it("translates a missing mj-title error", () => {
    expect(
      friendlyMjmlErrorMessage({
        message: "Missing mj-title. Provide non-empty content for a valid <title>.",
      }),
    ).toBe("The template is missing a title. Add an <mj-title> inside <mj-head>.");
  });

  it("falls back to a generic message naming the tag, for anything unrecognized", () => {
    expect(friendlyMjmlErrorMessage({ message: "Something mjml-internal", tagName: "mj-section" })).toBe(
      "There's a formatting problem in the template body near <mj-section>. Check that area and try again.",
    );
  });

  it("falls back to a bare generic message with no tag or line info at all", () => {
    expect(friendlyMjmlErrorMessage({ message: "Invalid MJML" })).toBe(
      "There's a formatting problem in the template body. Check that area and try again.",
    );
  });

  it("never echoes the raw formattedMessage, which embeds a filesystem path", () => {
    const friendly = friendlyMjmlErrorMessage({
      message: "Attribute color has invalid value: #333333d for type Color ",
      formattedMessage: "Line 5 of /Users/someone/real/project/path (mj-text) — Attribute color has invalid value: #333333d for type Color ",
      tagName: "mj-text",
      line: 5,
    });
    expect(friendly).not.toContain("/Users/");
    expect(friendly).not.toContain("—");
  });
});

describe("compileTemplate error path never leaks a real filesystem path", () => {
  it("rejects with a MjmlCompileError whose raw message does not contain this repo's own path", async () => {
    try {
      await compileTemplate("<mjml><mj-body><mj-section><mj-column><mj-text color=\"not-a-color\">Hi</mj-text></mj-column></mj-section></mj-body></mjml>", "mjml");
      expect.unreachable("expected compileTemplate to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(MjmlCompileError);
      const detail = (err as MjmlCompileError).message;
      expect(detail).not.toContain("mail-templates");
      expect(detail).not.toContain(process.cwd());
    }
  });
});
