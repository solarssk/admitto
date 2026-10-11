import { describe, expect, it } from "vitest";
import { scanPlacement, stripComments } from "./placementStandardScan.js";

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

  it("keeps what is inside a string or a template literal, even when it looks like a comment", () => {
    expect(stripComments('const u = "https://example.com"; // gone')).toBe('const u = "https://example.com"; ');
    expect(stripComments("const t = `a // b ${x}`; /* gone */ const c = 1;")).toBe("const t = `a // b ${x}`;  const c = 1;");
    expect(stripComments("const q = 'it\\'s // not a comment'; // gone")).toBe("const q = 'it\\'s // not a comment'; ");
  });

  it("still counts a violation that comes before a trailing comment", () => {
    expect(scan('const s = { position: "fixed" }; // a panel')["inline-fixed-position"]).toEqual({
      "apps/admin/src/components/Panel.tsx": 1,
    });
  });

  it("handles an unclosed block comment and a line that ends inside a quote", () => {
    expect(stripComments("a /* never closed")).toBe("a ");
    expect(stripComments("const s = 'oops\nconst b = 1; // c")).toBe("const s = 'oops\nconst b = 1; ");
  });
});
