/**
 * Guard for "one order": the fields of an event are listed by the staff list, the Add attendee form,
 * import and export columns, the field reports and the registration form, and a reorder has to show
 * the same everywhere. So a reader that sorts the registry sorts it with `eventCustomFieldOrderBy()`
 * (packages/tickets/src/event-custom-fields.ts), never with an `orderBy` of its own. A reader that
 * only looks fields up by key needs no order and says none.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SOURCE_ROOTS = ["apps/web/src", ...readdirSync(join(REPO_ROOT, "packages")).map((name) => `packages/${name}/src`)];
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "generated"]);
const REGISTRY_READ = /\beventCustomField\.findMany\(/g;
const SHARED_RULE = "eventCustomFieldOrderBy()";

function sourceFiles(directory: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return SKIPPED_DIRECTORIES.has(name) ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The text of the call whose "(" is at `open`, up to its matching ")". */
function callText(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const character = source.charAt(i);
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

type RegistryRead = { where: string; sorted: boolean; usesSharedRule: boolean };

function registryReads(): RegistryRead[] {
  const reads: RegistryRead[] = [];
  for (const root of SOURCE_ROOTS) {
    for (const file of sourceFiles(join(REPO_ROOT, root))) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(REGISTRY_READ)) {
        const call = callText(source, match.index + match[0].length - 1);
        const line = source.slice(0, match.index).split("\n").length;
        reads.push({
          where: `${relative(REPO_ROOT, file)}:${line}`,
          sorted: call.includes("orderBy"),
          usesSharedRule: call.includes(SHARED_RULE),
        });
      }
    }
  }
  return reads;
}

describe("readers of an event's custom-field registry", () => {
  const reads = registryReads();

  it("finds the readers it is meant to guard", () => {
    // Not an exact count: it only has to prove the scan is not looking at nothing.
    expect(reads.filter((read) => read.usesSharedRule).length).toBeGreaterThanOrEqual(3);
  });

  it("sort with eventCustomFieldOrderBy(), or do not sort at all", () => {
    const withOwnOrder = reads.filter((read) => read.sorted && !read.usesSharedRule).map((read) => read.where);
    expect(withOwnOrder).toEqual([]);
  });
});
