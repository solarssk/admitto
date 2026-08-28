import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CODE_MESSAGES } from "../../src/api/operator-api-error.js";

const ADMIN_SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");
const WEB_SRC = join(dirname(fileURLToPath(import.meta.url)), "../../../web/src");
const PACKAGES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../packages");

/** Only the strict snake_case form ("a" then any of a-z0-9_) — this is exactly the set that
 * `MACHINE_CODE` in operator-api-error.ts treats as a machine code, so an unmapped one can never
 * fall back to showing the raw server detail (that fallback is reserved for human-readable
 * strings). A space/camelCase code (e.g. "eventId required") still displays as-is via that
 * passthrough even with no map entry, so this guard doesn't chase those — only the codes that
 * would otherwise go fully silent. */
const CODE_LITERAL = /\b(?:error|code)\s*:\s*"([a-z][a-z0-9_]*)"/g;

/** A response that forwards a caught error's `.code` as-is (`{ error: code }`, `{ error: err.code }`,
 * `{ code: result.code }`, ...) instead of a string literal - invisible to CODE_LITERAL above.
 * Excludes a `.code` that's only read for a *comparison* (`err.code === "x" ? "a" : "b"`), since
 * that shape emits its own string literals, which CODE_LITERAL already catches on their own line. */
const CODE_PASSTHROUGH = /\b(?:error|code)\s*:\s*(?:\w+\.)?code\b(?!\s*[=!]==)/;

/** A shared `*ErrorCode` union type (e.g. `WalletProviderError`'s `.code`), matched by name so
 * unrelated string unions aren't swept in. */
const ERROR_CODE_UNION = /export type (\w*ErrorCode)\s*=\s*([\s\S]*?);/g;
const UNION_MEMBER = /"([a-z][a-z0-9_]*)"/g;
/** The `Error` subclass a union belongs to, found in the same file via its `readonly code: <Union>`
 * field - lets us confirm a caller actually narrows to *that* class (`instanceof <ClassName>`)
 * before treating its codes as reachable, instead of assuming every export is emitted. */
const ERROR_CLASS = /class (\w+) extends Error \{([\s\S]*?)\n\}/g;

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

/** Every workspace package's own src/ (never dist/, test/, or node_modules), labeled for the
 * failure message the same way apps/web/src and apps/admin/src are below. */
function packageSrcRoots(): { dir: string; label: string }[] {
  return readdirSync(PACKAGES_ROOT)
    .map((name) => ({ dir: join(PACKAGES_ROOT, name, "src"), label: `packages/${name}/src` }))
    .filter(({ dir }) => {
      try {
        return statSync(dir).isDirectory();
      } catch {
        return false;
      }
    });
}

function addCode(codes: Map<string, string[]>, code: string, label: string): void {
  const files = codes.get(code) ?? [];
  if (!files.includes(label)) files.push(label);
  codes.set(code, files);
}

/** `*ErrorCode` union name -> { members, owning Error subclass } across every package's src. */
function errorCodeUnions(): Map<string, { members: string[]; ownerClass: string | null }> {
  const unions = new Map<string, { members: string[]; ownerClass: string | null }>();
  for (const { dir } of [{ dir: WEB_SRC }, ...packageSrcRoots()]) {
    for (const file of walk(dir, /\.ts$/)) {
      if (file.endsWith(".test.ts")) continue;
      const content = readFileSync(file, "utf8");
      for (const unionMatch of content.matchAll(ERROR_CODE_UNION)) {
        const unionName = unionMatch[1]!;
        const members = [...unionMatch[2]!.matchAll(UNION_MEMBER)].map((m) => m[1]!);
        let ownerClass: string | null = null;
        for (const classMatch of content.matchAll(ERROR_CLASS)) {
          if (classMatch[2]!.includes(unionName)) {
            ownerClass = classMatch[1]!;
            break;
          }
        }
        unions.set(unionName, { members, ownerClass });
      }
    }
  }
  return unions;
}

/** Codes reachable only via a shared `*ErrorCode` union (e.g. `WalletProviderError`'s `.code`),
 * then re-emitted dynamically rather than as a string literal. Only counted for a union whose
 * owning class is both narrowed (`instanceof <ClassName>`) and forwarded via CODE_PASSTHROUGH in
 * the same file - a union whose class is only ever translated into different literal codes (each
 * already caught by CODE_LITERAL) never puts its own members on the wire. */
function unionEmittedCodes(): Map<string, string[]> {
  const codes = new Map<string, string[]>();
  const unions = errorCodeUnions();

  for (const file of walk(WEB_SRC, /\.ts$/)) {
    if (file.endsWith(".test.ts")) continue;
    const content = readFileSync(file, "utf8");
    if (!CODE_PASSTHROUGH.test(content)) continue;
    const label = `apps/web/src/${relative(WEB_SRC, file)}`;
    for (const { members, ownerClass } of unions.values()) {
      if (ownerClass && content.includes(`instanceof ${ownerClass}`)) {
        for (const code of members) addCode(codes, code, label);
      }
    }
  }
  return codes;
}

function emittedCodes(): Map<string, string[]> {
  const codes = new Map<string, string[]>();
  for (const file of walk(WEB_SRC, /\.ts$/)) {
    if (file.endsWith(".test.ts")) continue;
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(CODE_LITERAL)) {
      addCode(codes, match[1]!, `apps/web/src/${relative(WEB_SRC, file)}`);
    }
  }
  for (const [code, files] of unionEmittedCodes()) {
    for (const file of files) addCode(codes, code, file);
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
      gap.push(`${code} (${files[0]})`);
    }

    expect(
      gap.sort(),
      "Add these codes to CODE_MESSAGES in apps/admin/src/api/operator-api-error.ts (or give them their own hasApiErrorCode branch) so they don't fall back to a generic message.",
    ).toEqual([]);
  });
});
