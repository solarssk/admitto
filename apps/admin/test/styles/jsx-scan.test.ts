import { describe, expect, it } from "vitest";
import { braceProp, openingTags, withoutComments } from "./jsxScan.js";

describe("the scan of the JSX that the drift guards use", () => {
  it("reads a tag to its end, past the arrow functions and the quotes of its props", () => {
    const [entry] = openingTags('<Switch id="a" aria-label="Is a > b" onChange={(e) => set(e.target.checked)} checked={x ? "On" : "Off"} />\n<p>after</p>', "Switch");
    expect(entry?.tag).toBe('<Switch id="a" aria-label="Is a > b" onChange={(e) => set(e.target.checked)} checked={x ? "On" : "Off"} />');
    expect(entry?.line).toBe(1);
  });

  it("gives the line of each tag, and takes `<Card` and `<CardX` for different tags", () => {
    const tags = openingTags("<Card a>\n<CardX b>\n  <Card\n    c\n  >", "Card");
    expect(tags.map((entry) => entry.line)).toEqual([1, 3]);
  });

  it("does not read a comment as code", () => {
    expect(openingTags(withoutComments('/** The `<Switch>` of the form. */\n// a <Switch label={x ? "On" : "Off"} /> in a line comment\nconst a = 1;'), "Switch")).toEqual([]);
    expect(withoutComments("a // b\nc")).toBe("a     \nc");
    expect(withoutComments('const url = "https://example.com"; // note')).toContain("https://example.com");
  });

  it("keeps the lines of a source whose comments it blanks", () => {
    const source = "line 1\n/* a\n b */\n<Switch />";
    expect(openingTags(withoutComments(source), "Switch")[0]?.line).toBe(4);
  });

  it("reads the text of a prop between its braces, with nested braces and strings", () => {
    const tag = '<Card title="T" actions={<Button onClick={() => { go("}"); }}>Go</Button>} padded>';
    const prop = braceProp(tag, "actions");
    expect(prop?.text).toBe('<Button onClick={() => { go("}"); }}>Go</Button>');
    expect(tag.slice(prop!.start, prop!.start + 7)).toBe("<Button");
    expect(braceProp('<Card title="T" padded>', "actions")).toBeNull();
    expect(braceProp('<Card data-actions={x}>', "actions")).toBeNull();
  });
});
