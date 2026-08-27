import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CODE_MESSAGES } from "../../src/api/operator-api-error.js";

const ADMIN_SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");
const WEB_SRC = join(dirname(fileURLToPath(import.meta.url)), "../../../web/src");

/** Only the strict snake_case form ("a" then any of a-z0-9_) — this is exactly the set that
 * `MACHINE_CODE` in operator-api-error.ts treats as a machine code, so an unmapped one can never
 * fall back to showing the raw server detail (that fallback is reserved for human-readable
 * strings). A space/camelCase code (e.g. "eventId required") still displays as-is via that
 * passthrough even with no map entry, so this guard doesn't chase those — only the codes that
 * would otherwise go fully silent. */
const CODE_LITERAL = /\b(?:error|code)\s*:\s*"([a-z][a-z0-9_]*)"/g;

function walk(dir: string, exts: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path, exts, out);
    } else if (exts.test(name)) {
      out.push(path);
    }
  }
  return out;
}

function emittedCodes(): Map<string, string[]> {
  const codes = new Map<string, string[]>();
  for (const file of walk(WEB_SRC, /\.ts$/)) {
    if (file.endsWith(".test.ts")) continue;
    const rel = relative(WEB_SRC, file);
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(CODE_LITERAL)) {
      const code = match[1]!;
      const files = codes.get(code) ?? [];
      if (!files.includes(rel)) files.push(rel);
      codes.set(code, files);
    }
  }
  return codes;
}

/** Codes given their own bespoke `hasApiErrorCode(err, "...")` branch somewhere in the admin
 * SPA don't need a `CODE_MESSAGES` entry too — the branch already renders specific copy without
 * ever consulting the shared map. A code handled only this way still gets an entry when it's
 * useful as a shared fallback for other callers; this set exists so the guard doesn't demand one
 * for narrow cases where every call site already branches explicitly. */
function inlineHandledCodes(): Set<string> {
  const codes = new Set<string>();
  const pattern = /hasApiErrorCode\([^,]+,\s*"([^"]+)"\)/g;
  for (const dir of [ADMIN_SRC, WEB_SRC]) {
    for (const file of walk(dir, /\.tsx?$/)) {
      if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(pattern)) {
        codes.add(match[1]!);
      }
    }
  }
  return codes;
}

describe("CODE_MESSAGES coverage guard", () => {
  it("every snake_case error code the API can emit has a mapped message or explicit inline handling", () => {
    const emitted = emittedCodes();
    const inlineHandled = inlineHandledCodes();
    const mapped = new Set(Object.keys(CODE_MESSAGES));

    const gap: string[] = [];
    for (const [code, files] of emitted) {
      if (mapped.has(code) || inlineHandled.has(code)) continue;
      gap.push(`${code} (apps/web/src/${files[0]})`);
    }

    expect(
      gap.sort(),
      "Add these codes to CODE_MESSAGES in apps/admin/src/api/operator-api-error.ts (or give them their own hasApiErrorCode branch) so they don't fall back to a generic message.",
    ).toEqual([]);
  });
});
