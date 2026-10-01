// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bootHandoverEnabled, resetLoaderClockForTests, syncLoaderClockToSplash } from "@admitto/ui";
import { describe, expect, it } from "vitest";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../index.html"), "utf8");

describe("apps/admin/index.html splash", () => {
  const root = /<div id="root">([\s\S]*?)<\/div>\s*<script/.exec(html)?.[1] ?? "";

  it("puts a loading splash inside #root, so the page is never blank before React mounts", () => {
    // <output> is the native status element (a live region), so no role attribute is needed.
    expect(root).toMatch(/<output class="at-splash" aria-label="Loading Admitto">[\s\S]*<\/output>/);
    expect(root).not.toContain('role="status"');
    expect(root).toContain('class="tile"');
    expect(root).toContain('class="check"');
    expect(root).toContain('pathLength="1"');
    expect(root).toContain('class="dot"');
  });

  describe("label under the mark", () => {
    /** The declarations of `selector { ... }` in a stylesheet or the splash's <style>, as a property map. */
    function decls(source: string, selector: string): Record<string, string> {
      const start = source.indexOf(`${selector} {`);
      expect(start, `rule "${selector}" exists`).toBeGreaterThan(-1);
      const body = source.slice(source.indexOf("{", start) + 1, source.indexOf("}", start)).replaceAll(/\/\*[\s\S]*?\*\//g, "");
      const out: Record<string, string> = {};
      for (const part of body.split(";")) {
        const colon = part.indexOf(":");
        if (colon > -1) out[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
      }
      return out;
    }
    const uiStyles = join(dirname(fileURLToPath(import.meta.url)), "../../../packages/ui/src/styles");
    const loaderCss = readFileSync(join(uiStyles, "components/loader.css"), "utf8");
    const tokens = (file: string) => readFileSync(join(uiStyles, "tokens", file), "utf8");

    it("says what is loading under the mark, like PageLoader does", () => {
      expect(root).toMatch(/<span class="at-splash__label" aria-hidden="true">Loading Admitto…<\/span>/);
      // In the stack with the mark, after it, so the stack is what is centred and the label hangs below.
      expect(root).toMatch(/<span class="at-splash__stack">\s*<svg[\s\S]*<\/svg>\s*<span class="at-splash__label"/);
    });

    it("lines up with PageLoader: same stack size, same anchor, same offset, so nothing moves at the hand-over", () => {
      const mark = decls(loaderCss, ".at-loader--page .at-loader__mark");
      const stack = decls(html, ".at-splash__stack");
      expect(stack.position).toBe("relative");
      expect([stack.width, stack.height]).toEqual([mark.width, mark.height]);
      expect(decls(html, ".at-splash svg").display).toBe("block");

      const text = decls(loaderCss, ".at-loader__text");
      const label = decls(html, ".at-splash__label");
      expect(label.position).toBe(text.position);
      expect(label.top).toBe(text.top);
      expect(label.left).toBe(text.left);
      expect(label["margin-top"]).toBe(text["margin-top"]);
      expect(label.transform).toBe(text.transform);
    });

    it("writes the label in the same weight, size, line height, font stack and colour as PageLoader", () => {
      // The splash cannot use the design tokens (no stylesheet yet), so it must hold the same values.
      const label = decls(html, ".at-splash__label");
      const type = tokens("typography.css");
      const weight = /--fw-medium:\s*(\d+)/.exec(type)?.[1];
      const size = Number(/--fs-h3:\s*([\d.]+)rem/.exec(type)?.[1]) * 16;
      const lineHeight = /--lh-snug:\s*([\d.]+)/.exec(type)?.[1];
      const family = /--font-sans:\s*([^;]+);/.exec(type)?.[1];
      expect(label.font).toBe(`${weight} ${size}px/${lineHeight} ${family}`);
      expect(label["-webkit-font-smoothing"]).toBe("antialiased");

      // PageLoader takes these from the same tokens: the title step of an empty or error state.
      const pageLabel = decls(loaderCss, ".at-loader__label");
      expect([pageLabel["font-size"], pageLabel["font-weight"], pageLabel.color]).toEqual(["var(--fs-h3)", "var(--fw-medium)", "var(--text-primary)"]);
      const ink = /--at-ink:\s*(#[0-9a-fA-F]{6})/.exec(tokens("colors.css"))?.[1];
      expect(label.color.toLowerCase()).toBe(ink?.toLowerCase());
    });

    it("lets the loaders' shared clock find the mark inside the real splash markup (hand-over is detected)", () => {
      const el = document.createElement("div");
      el.innerHTML = root;
      const svg = el.querySelector(".at-splash svg");
      expect(svg, "the mark is inside .at-splash").not.toBeNull();
      Object.assign(svg as Element, { getAnimations: () => [{ currentTime: 400 }] });
      try {
        syncLoaderClockToSplash(el);
        expect(bootHandoverEnabled()).toBe(true);
      } finally {
        resetLoaderClockForTests();
      }
    });
  });

  it("explains itself when JavaScript is off, and hides the splash then", () => {
    expect(root).toContain("<noscript>");
    expect(root).toMatch(/Admitto needs JavaScript/);
    expect(html).toMatch(/<noscript>\s*<style>[\s\S]*\.at-splash\s*\{\s*display:\s*none/);
  });

  it("is plain CSS only: no inline script or event handler (the staff CSP has no 'unsafe-inline' for scripts)", () => {
    const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
    expect(scripts).toEqual(['<script type="module" src="/src/main.tsx">']);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it("draws the tick in with the same 2s cycle as PageLoader, so the two look like one animation", () => {
    expect(html).toMatch(/animation:\s*at-splash-draw 2s/);
    expect(html).toMatch(/@keyframes at-splash-draw\s*\{\s*0%\s*\{\s*stroke-dashoffset:\s*1\.05/);
    const loaderCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../packages/ui/src/styles/components/loader.css"), "utf8");
    expect(loaderCss).toMatch(/animation:\s*at-loader-draw 2s/);
    // Same keyframe stops for the draw-in in both places.
    expect(loaderCss).toMatch(/25%,\s*80%/);
    expect(html).toMatch(/25%,\s*80%/);
  });

  it("respects prefers-reduced-motion without freezing the mark", () => {
    expect(html).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(html).toContain("at-splash-soft");
  });
});
