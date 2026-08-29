import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ADMIN_SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");
const WEB_SRC = join(dirname(fileURLToPath(import.meta.url)), "../../../web/src");
const UI_SRC = join(dirname(fileURLToPath(import.meta.url)), "../../../../packages/ui/src");
const COLORS_CSS = join(UI_SRC, "styles/tokens/colors.css");
const NON_COLOR_TOKEN_FILES = [
  join(UI_SRC, "styles/tokens/spacing.css"),
  join(UI_SRC, "styles/tokens/elevation.css"),
  join(UI_SRC, "styles/tokens/typography.css"),
];
const SEARCH_DIRS = [
  { dir: ADMIN_SRC, label: "apps/admin/src" },
  { dir: WEB_SRC, label: "apps/web/src" },
  { dir: UI_SRC, label: "packages/ui/src" },
];

/** `--token: #hex;` or `--token: var(--other-token);` (colors.css is exactly one level of
 * aliasing - semantic names onto raw scale values - so a single resolution pass is enough). */
const TOKEN_DEF = /(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8}|var\((--[a-z0-9-]+)\))\s*;/g;

/** Every canonical token in colors.css resolved to its final hex value. */
function canonicalTokens(): Map<string, string> {
  const content = readFileSync(COLORS_CSS, "utf8");
  const raw = new Map<string, string>();
  for (const m of content.matchAll(TOKEN_DEF)) {
    raw.set(m[1]!, m[2]!);
  }
  const resolved = new Map<string, string>();
  for (const [token, value] of raw) {
    if (value.startsWith("#")) {
      resolved.set(token, normalizeHex(value));
      continue;
    }
    const aliasMatch = /var\((--[a-z0-9-]+)\)/.exec(value);
    const alias = aliasMatch?.[1];
    const aliasValue = alias ? raw.get(alias) : undefined;
    if (aliasValue?.startsWith("#")) resolved.set(token, normalizeHex(aliasValue));
  }
  return resolved;
}

function normalizeHex(hex: string): string {
  const lower = hex.toLowerCase();
  if (lower.length === 4) return "#" + [...lower.slice(1)].map((c) => c + c).join("");
  return lower;
}

/** `--token: <literal>;` in spacing.css/elevation.css/typography.css, resolving one level of
 * `--token: var(--other-token);` aliasing (same rule as colors.css's canonicalTokens()). A value
 * that mixes a var() reference with other text (e.g. --ring's `0 0 0 0.25rem var(--focus-ring)`)
 * is neither a pure literal nor a pure alias, so it's left out - same as an unresolvable alias
 * in colors.css. */
function nonColorCanonicalTokens(): Map<string, string> {
  const DEF = /(--[a-z0-9-]+):\s*([^;]+);/g;
  const raw = new Map<string, string>();
  for (const file of NON_COLOR_TOKEN_FILES) {
    for (const m of readFileSync(file, "utf8").matchAll(DEF)) {
      raw.set(m[1]!, m[2]!.trim().replace(/\s+/g, " "));
    }
  }
  const resolved = new Map<string, string>();
  for (const [token, value] of raw) {
    const alias = /^var\((--[a-z0-9-]+)\)$/.exec(value)?.[1];
    if (alias) {
      const aliasValue = raw.get(alias);
      if (aliasValue && !aliasValue.includes("var(")) resolved.set(token, aliasValue);
    } else if (!value.includes("var(")) {
      resolved.set(token, value);
    }
  }
  return resolved;
}

function walk(dir: string, exts: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path, exts, out);
    } else if (exts.test(name)) {
      out.push(path);
    }
  }
  return out;
}

/** `var(--token, #hex)` - a fallback that's only reachable at all if `--token` somehow isn't
 * defined (colors.css's `:root` block always defines every token for a normal admin-SPA page,
 * so this is usually dead code there - but apps/web's standalone ticket page never loads
 * colors.css at all, making its fallback the real effective color). Either way the fallback
 * should still be correct, not a stale/guessed approximation of the token it names. */
const VAR_FALLBACK = /var\((--[a-z0-9-]+),\s*#([0-9a-fA-F]{3,8})\)/g;

/** `var(--token, <value>)` where value may itself contain one level of nested parens - covers
 * every non-color token shape in this codebase (`rgba(...)`, `cubic-bezier(...)`, plain
 * px/rem/ms/unitless numbers, and comma-joined font stacks). */
const NON_COLOR_VAR_FALLBACK = /var\((--[a-z0-9-]+),\s*((?:[^()]|\([^()]*\))*)\)/g;

describe("CSS var() fallback values match their canonical token", () => {
  it("every var(--token, #hex) fallback equals colors.css's resolved value for that token", () => {
    const canonical = canonicalTokens();
    expect(canonical.size).toBeGreaterThan(20);

    const gap: string[] = [];
    for (const { dir, label } of SEARCH_DIRS) {
      for (const file of walk(dir, /\.(css|ts|tsx)$/)) {
        if (file.endsWith(".test.ts") || file.endsWith(".test.tsx") || file.endsWith("colors.css")) continue;
        const content = readFileSync(file, "utf8");
        const rel = `${label}/${relative(dir, file)}`;
        for (const m of content.matchAll(VAR_FALLBACK)) {
          const token = m[1]!;
          const canonicalValue = canonical.get(token);
          if (!canonicalValue) continue; // not one of our design tokens (e.g. a Tabler var)
          const fallback = normalizeHex("#" + m[2]!);
          if (fallback !== canonicalValue) {
            gap.push(`${token} in ${rel} is ${fallback}, colors.css says ${canonicalValue}`);
          }
        }
      }
    }

    expect(
      gap.sort(),
      "A var() fallback drifted from its token's canonical value in packages/ui/src/styles/tokens/colors.css. Update the fallback to match (or update colors.css if the token itself should change).",
    ).toEqual([]);
  });

  it("every var(--token, value) fallback equals spacing/elevation/typography.css's value for that token", () => {
    const canonical = nonColorCanonicalTokens();
    expect(canonical.size).toBeGreaterThan(15);

    const gap: string[] = [];
    for (const { dir, label } of SEARCH_DIRS) {
      for (const file of walk(dir, /\.(css|ts|tsx)$/)) {
        if (file.endsWith(".test.ts") || file.endsWith(".test.tsx") || NON_COLOR_TOKEN_FILES.includes(file)) continue;
        const content = readFileSync(file, "utf8");
        const rel = `${label}/${relative(dir, file)}`;
        for (const m of content.matchAll(NON_COLOR_VAR_FALLBACK)) {
          const token = m[1]!;
          const canonicalValue = canonical.get(token);
          if (!canonicalValue) continue; // not a resolvable non-color token (color token, Tabler var, or composite/alias we don't resolve)
          const fallback = m[2]!.trim().replace(/\s+/g, " ");
          if (/^var\(--[a-z0-9-]+\)$/.test(fallback)) continue; // fallback chains to another token, not a hardcoded value - nothing to drift
          if (fallback !== canonicalValue) {
            gap.push(`${token} in ${rel} is "${fallback}", token file says "${canonicalValue}"`);
          }
        }
      }
    }

    expect(
      gap.sort(),
      "A var() fallback drifted from its token's canonical value in packages/ui/src/styles/tokens/{spacing,elevation,typography}.css. Update the fallback to match (or update the token file if the token itself should change).",
    ).toEqual([]);
  });
});
