import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../index.html"), "utf8");

describe("apps/admin/index.html splash", () => {
  const root = /<div id="root">([\s\S]*?)<\/div>\s*<script/.exec(html)?.[1] ?? "";

  it("puts a loading splash inside #root, so the page is never blank before React mounts", () => {
    expect(root).toContain('class="at-splash"');
    expect(root).toContain('role="status"');
    expect(root).toContain('aria-label="Loading Admitto"');
    expect(root).toContain('pathLength="1"');
  });

  it("explains itself when JavaScript is off, and hides the splash then", () => {
    expect(root).toContain("<noscript>");
    expect(root).toMatch(/Admitto needs JavaScript/);
    expect(html).toMatch(/<noscript>\s*<style>[\s\S]*\.at-splash\s*\{\s*display:\s*none/);
  });

  it("is plain CSS only: no inline script or event handler (the staff CSP has no 'unsafe-inline' for scripts)", () => {
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(scripts).toEqual(['<script type="module" src="/src/main.tsx">']);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it("respects prefers-reduced-motion without freezing the mark", () => {
    expect(html).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(html).toContain("at-splash-soft");
  });
});
