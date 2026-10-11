import { describe, expect, it } from "vitest";
import { scanPlacement, toCode } from "./placementStandardScan.js";

const scan = (source: string, file = "apps/admin/src/components/Panel.tsx") => scanPlacement({ [file]: source });

describe("placement-standard scanner: what counts as a violation", () => {
  it("counts an inline fixed position, in either quote style", () => {
    expect(scan('const s = { position: "fixed", top: 1 };')["inline-fixed-position"]).toEqual({
      "apps/admin/src/components/Panel.tsx": 1,
    });
    expect(scan("const s = { position: 'fixed' };")["inline-fixed-position"]).toEqual({
      "apps/admin/src/components/Panel.tsx": 1,
    });
  });

  it("counts the overlay lifecycle helpers used outside the hook", () => {
    const source = 'import { attachFixedOverlayLifecycle } from "../utils/fixed-overlay-lifecycle.js";\nattachFixedOverlayLifecycle(a, b, c);';
    expect(scan(source)["overlay-lifecycle-outside-hook"]).toEqual({ "apps/admin/src/components/Panel.tsx": 2 });
    expect(scan("const v = getFixedOverlayViewport();")["overlay-lifecycle-outside-hook"]).toEqual({
      "apps/admin/src/components/Panel.tsx": 1,
    });
  });

  it("counts a file that measures an element and compares it with the window", () => {
    const source = "const r = el.getBoundingClientRect();\nconst below = window.innerHeight - r.bottom;";
    expect(scan(source)["viewport-math-in-component"]).toEqual({ "apps/admin/src/components/Panel.tsx": 1 });
    expect(scan("const r = el.getBoundingClientRect();\nconst v = window.visualViewport;")["viewport-math-in-component"]).toEqual({
      "apps/admin/src/components/Panel.tsx": 1,
    });
  });

  it("does not count measuring an element without placing anything against the window", () => {
    // Auto-scroll while dragging, scrolling a tab into view: measuring, not placing a panel.
    expect(scan("const r = list.getBoundingClientRect();\nif (e.clientY - r.top < 26) list.scrollTop -= 9;")["viewport-math-in-component"]).toEqual({});
    expect(scan("const w = window.innerWidth;")["viewport-math-in-component"]).toEqual({});
  });

  it("ignores what is written in a comment", () => {
    const source = '// position: "fixed" and attachFixedOverlayLifecycle used to live here\n/* getFixedOverlayViewport */\nconst a = 1;';
    const found = scan(source);
    expect(found["inline-fixed-position"]).toEqual({});
    expect(found["overlay-lifecycle-outside-hook"]).toEqual({});
  });

  it("lets the placement hook and its helper implement all of it", () => {
    const source = 'const s = { position: "fixed" };\nattachFixedOverlayLifecycle(a, b, c);\nel.getBoundingClientRect(); window.innerWidth;';
    for (const file of ["apps/admin/src/components/useFloatingPlacement.ts", "apps/admin/src/utils/fixed-overlay-lifecycle.ts"]) {
      const found = scan(source, file);
      expect(found["overlay-lifecycle-outside-hook"]).toEqual({});
      expect(found["viewport-math-in-component"]).toEqual({});
    }
    expect(scan(source, "apps/admin/src/components/useFloatingPlacement.ts")["inline-fixed-position"]).toEqual({});
    // The helper file itself is not a place to write a fixed panel style.
    expect(scan(source, "apps/admin/src/utils/fixed-overlay-lifecycle.ts")["inline-fixed-position"]).toEqual({
      "apps/admin/src/utils/fixed-overlay-lifecycle.ts": 1,
    });
  });
});

describe("placement-standard scanner: comments", () => {
  it("ignores a trailing comment after code", () => {
    const source = 'const mode = value; // position: "fixed", attachFixedOverlayLifecycle\nconst a = 1; /* getFixedOverlayViewport */ const b = 2;';
    const found = scan(source);
    expect(found["inline-fixed-position"]).toEqual({});
    expect(found["overlay-lifecycle-outside-hook"]).toEqual({});
  });

  it("does not mistake a comment-looking text inside a string for a comment", () => {
    expect(toCode('const u = "https://example.com"; // gone')).toBe('const u = "                   "; ');
    expect(toCode("const t = `a // b ${x}`; /* gone */ const c = 1;")).toBe("const t = `       ${x}`;  const c = 1;");
    expect(toCode("const q = 'it\\'s // not'; // gone")).toBe(`const q = '${" ".repeat(12)}'; `);
  });

  it("still counts a violation that comes before a trailing comment", () => {
    expect(scan('const s = { position: "fixed" }; // a panel')["inline-fixed-position"]).toEqual({
      "apps/admin/src/components/Panel.tsx": 1,
    });
  });

  it("handles an unclosed block comment and a line that ends inside a quote", () => {
    expect(toCode("a /* never closed")).toBe("a ");
    expect(toCode("const s = 'oops\nconst b = 1; // c")).toBe("const s = '    \nconst b = 1; ");
  });
});

describe("placement-standard scanner: strings", () => {
  it("does not count a rule's pattern that is only text inside a string", () => {
    const found = scan(
      [
        "const a = 'position: \"fixed\"';",
        'const b = "use attachFixedOverlayLifecycle instead";',
        "const c = `getFixedOverlayViewport ${x}`;",
      ].join("\n"),
    );
    expect(found["inline-fixed-position"]).toEqual({});
    expect(found["overlay-lifecycle-outside-hook"]).toEqual({});
  });

  it("still counts the literal fixed value, in either quote style, and in a style written without spaces", () => {
    for (const source of ['{ position: "fixed" }', "{ position: 'fixed' }", '{position:"fixed"}']) {
      expect(scan(source)["inline-fixed-position"]).toEqual({ "apps/admin/src/components/Panel.tsx": 1 });
    }
  });

  it("does not count a viewport read that is only text", () => {
    const source = "const r = el.getBoundingClientRect();\nconst note = 'compare with window.innerHeight';";
    expect(scan(source)["viewport-math-in-component"]).toEqual({});
  });
});

describe("placement-standard scanner: template literals", () => {
  it("counts placement math written inside a template interpolation", () => {
    const source =
      "const style = { transform: `translateX(${window.innerWidth - el.getBoundingClientRect().right}px)` };";
    expect(scan(source)["viewport-math-in-component"]).toEqual({ "apps/admin/src/components/Panel.tsx": 1 });
    expect(scan("const s = `${attachFixedOverlayLifecycle(a, b, c)}`;")["overlay-lifecycle-outside-hook"]).toEqual({
      "apps/admin/src/components/Panel.tsx": 1,
    });
  });

  it("blanks the text of a template but not its expressions, also when they nest", () => {
    expect(toCode("`a ${b + `c ${d}`} e`")).toBe("`  ${b + `  ${d}`}  `");
    expect(toCode("`x ${ {a: 1}.a } y`")).toBe("`  ${ {a: 1}.a }  `");
  });

  it("does not count a rule's pattern that is only text in a template", () => {
    expect(scan("const s = `use position: 'fixed' and getFixedOverlayViewport`;")["inline-fixed-position"]).toEqual({});
    expect(scan("const s = `use getFixedOverlayViewport`;")["overlay-lifecycle-outside-hook"]).toEqual({});
  });

  it("keeps the line breaks of a multi-line template and survives an unclosed one", () => {
    expect(toCode("`a\nb ${c}`")).toBe("` \n  ${c}`");
    expect(toCode("`never closed ${x")).toBe("`             ${x");
  });
});
