import { describe, expect, it } from "vitest";
import { scanPlacement } from "./placementStandardScan.js";

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
