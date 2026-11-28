import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * A small reader of the JSX in `apps/admin/src`, for the tests that guard a standard (a drift guard reads the source, as the other `*Scan.ts`
 * files in this folder do). It is not a parser: it finds the opening tag of a component, and a prop in it, well enough for the code this
 * repository writes.
 */

/** The `.tsx` files under a folder. */
export function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

/** The comments of a source blanked out (same length, same lines), so that a tag in a sentence is not read as code. */
export function withoutComments(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//g, (comment) => comment.replaceAll(/[^\n]/g, " "))
    .replaceAll(/(^|[^:'"`])\/\/[^\n]*/g, (line, before: string) => before + " ".repeat(line.length - before.length));
}

export interface OpeningTag {
  /** The line it starts on (1 based). */
  line: number;
  /** Where it starts and ends in the text it was read from. */
  start: number;
  end: number;
  /** `<Name ...>` or `<Name ... />`, as written. */
  tag: string;
}

/** The index of the `>` that ends the opening tag that starts at `from`: not one in a quoted string, and not one inside braces (an arrow function). */
function endOfTag(text: string, from: number): number {
  let depth = 0;
  let quote = "";
  for (let i = from; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === quote && text[i - 1] !== "\\") quote = "";
    } else if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (char === ">" && depth === 0) return i;
  }
  return text.length - 1;
}

/** The opening tags `<Name ...>` of a text (comments are not removed: pass `withoutComments(source)`). */
export function openingTags(text: string, name: string): OpeningTag[] {
  const tags: OpeningTag[] = [];
  for (const match of text.matchAll(new RegExp(String.raw`<${name}\b`, "g"))) {
    const end = endOfTag(text, match.index + match[0].length);
    tags.push({ line: text.slice(0, match.index).split("\n").length, start: match.index, end: end + 1, tag: text.slice(match.index, end + 1) });
  }
  return tags;
}

/** The text between the braces of the prop `name={...}` of a tag, and where it starts in the tag; null when the tag has no such prop. */
export function braceProp(tag: string, name: string): { start: number; text: string } | null {
  const match = new RegExp(String.raw`(?<![\w-])${name}=\{`).exec(tag);
  if (!match) return null;
  const start = match.index + match[0].length;
  let depth = 1;
  let quote = "";
  for (let i = start; i < tag.length; i++) {
    const char = tag[i];
    if (quote) {
      if (char === quote && tag[i - 1] !== "\\") quote = "";
    } else if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return { start, text: tag.slice(start, i) };
  }
  return null;
}
