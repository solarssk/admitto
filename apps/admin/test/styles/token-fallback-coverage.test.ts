import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ADMIN_SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");
const WEB_SRC = join(dirname(fileURLToPath(import.meta.url)), "../../../web/src");
const UI_SRC = join(dirname(fileURLToPath(import.meta.url)), "../../../../packages/ui/src");
const COLORS_CSS = join(UI_SRC, "styles/tokens/colors.css");

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

describe("CSS var() fallback values match their canonical token", () => {
  it("every var(--token, #hex) fallback equals colors.css's resolved value for that token", () => {
    const canonical = canonicalTokens();
    expect(canonical.size).toBeGreaterThan(20);

    const gap: string[] = [];
    for (const { dir, label } of [
      { dir: ADMIN_SRC, label: "apps/admin/src" },
      { dir: WEB_SRC, label: "apps/web/src" },
      { dir: UI_SRC, label: "packages/ui/src" },
    ]) {
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
});
