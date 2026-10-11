import { describe, expect, it } from "vitest";
import { scanPlacement } from "./placementStandardScan.js";

const FILE = "apps/admin/src/components/Panel.tsx";
const scan = (source: string, file = FILE) => scanPlacement({ [file]: source });
const only = (count: number) => (count === 0 ? {} : { [FILE]: count });

describe("placement-standard scanner: inline fixed position", () => {
  it("counts a style object with position fixed, however it is quoted or spaced", () => {
    for (const source of ['{ position: "fixed", top: 1 }', "{ position: 'fixed' }", '{position:"fixed"}', '{ "position": "fixed" }', "{ position: `fixed` }"]) {
      expect(scan(`const s = ${source};`)["inline-fixed-position"]).toEqual(only(1));
    }
  });

  it("does not count another position, or a computed key", () => {
    expect(scan('const s = { position: "absolute" };')["inline-fixed-position"]).toEqual({});
    expect(scan('const s = { [position]: "fixed" };')["inline-fixed-position"]).toEqual({});
  });
});

describe("placement-standard scanner: overlay lifecycle helpers", () => {
  it("counts an import and a call of a helper outside the hook", () => {
    const source = 'import { attachFixedOverlayLifecycle } from "../utils/fixed-overlay-lifecycle.js";\nattachFixedOverlayLifecycle(a, b, c);';
    expect(scan(source)["overlay-lifecycle-outside-hook"]).toEqual(only(2));
    expect(scan("const v = getFixedOverlayViewport();")["overlay-lifecycle-outside-hook"]).toEqual(only(1));
  });
});

describe("placement-standard scanner: measuring an element and reading the window in one function", () => {
  it("counts placement math in one function, at the top level or nested", () => {
    expect(scan("const r = el.getBoundingClientRect();\nconst below = window.innerHeight - r.bottom;")["viewport-math-in-component"]).toEqual(only(1));
    const effect = "useEffect(() => { const update = () => { const r = a.getBoundingClientRect(); const w = window.innerWidth; }; update(); });";
    expect(scan(effect)["viewport-math-in-component"]).toEqual(only(1));
    expect(scan("const f = () => { el.getBoundingClientRect(); return window.visualViewport; };")["viewport-math-in-component"]).toEqual(only(1));
    expect(scan("function f() { el.getBoundingClientRect(); return document.documentElement.clientHeight; }")["viewport-math-in-component"]).toEqual(only(1));
  });

  it("counts placement math written inside a template interpolation", () => {
    const source = "const style = { transform: `translateX(${window.innerWidth - el.getBoundingClientRect().right}px)` };";
    expect(scan(source)["viewport-math-in-component"]).toEqual(only(1));
  });

  it("does not count a component that measures for one thing and reads the width for another", () => {
    // A drag handler that auto-scrolls its list, and a render that picks a layout from the window's width.
    const source = [
      "export function Editor() {",
      "  const onMove = (e) => { const r = list.getBoundingClientRect(); if (e.clientY - r.top < 26) list.scrollTop -= 9; };",
      "  const compact = window.innerWidth < 768;",
      "  return null;",
      "}",
    ].join("\n");
    expect(scan(source)["viewport-math-in-component"]).toEqual({});
  });

  it("does not count measuring alone, or reading the window alone", () => {
    expect(scan("const r = list.getBoundingClientRect(); const x = r.left;")["viewport-math-in-component"]).toEqual({});
    expect(scan("const w = window.innerWidth;")["viewport-math-in-component"]).toEqual({});
  });
});

describe("placement-standard scanner: what is not code", () => {
  it("ignores comments, trailing ones included", () => {
    const source = [
      '// position: "fixed" and attachFixedOverlayLifecycle used to live here',
      'const mode = value; // position: "fixed", getFixedOverlayViewport',
      "/* el.getBoundingClientRect() with window.innerWidth */",
      "const a = 1;",
    ].join("\n");
    const found = scan(source);
    expect(found["inline-fixed-position"]).toEqual({});
    expect(found["overlay-lifecycle-outside-hook"]).toEqual({});
    expect(found["viewport-math-in-component"]).toEqual({});
  });

  it("ignores a rule's pattern that is only text in a string or in the text of a template", () => {
    const source = [
      "const a = 'position: \"fixed\"';",
      'const b = "use attachFixedOverlayLifecycle instead";',
      "const c = `getFixedOverlayViewport and position: 'fixed'`;",
      "const d = 'compare getBoundingClientRect() with window.innerHeight';",
    ].join("\n");
    const found = scan(source);
    expect(found["inline-fixed-position"]).toEqual({});
    expect(found["overlay-lifecycle-outside-hook"]).toEqual({});
    expect(found["viewport-math-in-component"]).toEqual({});
  });

  it("does not mistake text that looks like a comment, a regex or a URL for the end of the code", () => {
    const source = 'const u = "https://example.com"; const re = /["\'`]\\/\\//; const s = { position: "fixed" };';
    expect(scan(source)["inline-fixed-position"]).toEqual(only(1));
  });
});

describe("placement-standard scanner: the files that implement placement", () => {
  const source = 'const s = { position: "fixed" };\nattachFixedOverlayLifecycle(a, b, c);\nel.getBoundingClientRect(); window.innerWidth;';

  it("lets the placement hook implement all of it, and the helper file all but a fixed style", () => {
    const hook = scan(source, "apps/admin/src/components/useFloatingPlacement.ts");
    expect(hook["inline-fixed-position"]).toEqual({});
    expect(hook["overlay-lifecycle-outside-hook"]).toEqual({});
    expect(hook["viewport-math-in-component"]).toEqual({});

    const helper = scan(source, "apps/admin/src/utils/fixed-overlay-lifecycle.ts");
    expect(helper["overlay-lifecycle-outside-hook"]).toEqual({});
    expect(helper["viewport-math-in-component"]).toEqual({});
    expect(helper["inline-fixed-position"]).toEqual({ "apps/admin/src/utils/fixed-overlay-lifecycle.ts": 1 });
  });

  it("says which file it could not parse", () => {
    expect(() => scan("const = ;", "apps/admin/src/components/Broken.tsx")).toThrow(/Broken\.tsx/);
  });
});
