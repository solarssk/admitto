import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@typescript-eslint/parser";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
/** Where staff UI code lives: the admin app and the shared kit it renders. */
const SCAN_ROOTS = ["apps/admin/src", "packages/ui/src"];

export const RULES = ["overlay-lifecycle-outside-hook", "inline-fixed-position", "viewport-math-in-component"] as const;
export type Rule = (typeof RULES)[number];
export type Counts = Record<string, number>;

/** Where each rule sends the author instead. Shown in the failure message. */
export const RULE_HINTS: Record<Rule, string> = {
  "overlay-lifecycle-outside-hook":
    "attachFixedOverlayLifecycle and getFixedOverlayViewport belong to useFloatingPlacement. A panel that floats next to an element calls that hook (or useDropdownMenu, which is built on it) and spreads its `panelStyle`.",
  "inline-fixed-position":
    'Do not write `position: "fixed"` in a style object. A floating panel gets its position from useFloatingPlacement (`panelStyle`), which places it with a transform and keeps it inside the visual viewport.',
  "viewport-math-in-component":
    "Do not measure an element with getBoundingClientRect() and read the window's size (window.innerWidth, innerHeight, visualViewport, documentElement.clientWidth/clientHeight) in the same function: that is placing a panel by hand. useFloatingPlacement (Floating UI) flips, shifts and clamps against the visual viewport, and the copies of this math each had to be fixed again for narrow screens, zoom and the phone keyboard.",
};

/** Files that implement placement themselves, per rule. */
const IMPLEMENTS_PLACEMENT: Record<Rule, ReadonlySet<string>> = {
  "overlay-lifecycle-outside-hook": new Set([
    "apps/admin/src/components/useFloatingPlacement.ts",
    "apps/admin/src/utils/fixed-overlay-lifecycle.ts",
  ]),
  "inline-fixed-position": new Set(["apps/admin/src/components/useFloatingPlacement.ts"]),
  "viewport-math-in-component": new Set([
    "apps/admin/src/components/useFloatingPlacement.ts",
    "apps/admin/src/utils/fixed-overlay-lifecycle.ts",
  ]),
};

const LIFECYCLE_HELPERS = new Set(["attachFixedOverlayLifecycle", "getFixedOverlayViewport"]);
const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const WINDOW_SIZE = new Set(["innerWidth", "innerHeight", "visualViewport"]);
const DOCUMENT_SIZE = new Set(["clientWidth", "clientHeight"]);
/** AST keys that point back up the tree or hold source positions, not children. */
const NOT_CHILDREN = new Set(["parent", "loc", "range", "tokens", "comments"]);

type Node = { type: string; range: [number, number]; [key: string]: unknown };

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function walk(value: unknown, enclosing: Node | null, visit: (node: Node, enclosing: Node | null) => void): void {
  if (Array.isArray(value)) {
    for (const child of value) walk(child, enclosing, visit);
    return;
  }
  if (!isNode(value)) return;
  visit(value, enclosing);
  const next = FUNCTIONS.has(value.type) ? value : enclosing;
  for (const [key, child] of Object.entries(value)) {
    if (!NOT_CHILDREN.has(key)) walk(child, next, visit);
  }
}

function identifierName(node: unknown): string | undefined {
  return isNode(node) && node.type === "Identifier" ? (node.name as string) : undefined;
}

/** The text of a string literal, or of a template literal without interpolations. */
function stringValue(node: unknown): string | undefined {
  if (!isNode(node)) return undefined;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && (node.expressions as unknown[]).length === 0) {
    return ((node.quasis as { value: { cooked: string } }[])[0]?.value.cooked) ?? undefined;
  }
  return undefined;
}

/** `window.innerWidth`, `window.visualViewport`, `document.documentElement.clientHeight` and the like. */
function readsViewportSize(node: Node): boolean {
  if (node.type !== "MemberExpression" || node.computed === true) return false;
  const property = identifierName(node.property);
  if (!property) return false;
  if (identifierName(node.object) === "window") return WINDOW_SIZE.has(property);
  const object = node.object;
  return (
    isNode(object) &&
    object.type === "MemberExpression" &&
    identifierName(object.object) === "document" &&
    identifierName(object.property) === "documentElement" &&
    DOCUMENT_SIZE.has(property)
  );
}

function callsGetBoundingClientRect(node: Node): boolean {
  if (node.type !== "CallExpression" || !isNode(node.callee) || node.callee.type !== "MemberExpression") return false;
  return identifierName(node.callee.property) === "getBoundingClientRect";
}

/** Findings per rule and file (repo-relative, `/`-separated) for the given sources. */
export function scanPlacement(files: Record<string, string>): Record<Rule, Counts> {
  const found: Record<Rule, Counts> = {
    "overlay-lifecycle-outside-hook": {},
    "inline-fixed-position": {},
    "viewport-math-in-component": {},
  };
  for (const [file, source] of Object.entries(files)) {
    const counts: Record<Rule, number> = { "overlay-lifecycle-outside-hook": 0, "inline-fixed-position": 0, "viewport-math-in-component": 0 };
    const helperSpots = new Set<number>();
    // Per function: does it measure an element, and does it read the window's size? Both in one function
    // is placement math; a drag handler that measures and a render that reads the width are not.
    const functions = new Map<Node | null, { measures: boolean; readsViewport: boolean }>();
    const note = (fn: Node | null) => {
      let entry = functions.get(fn);
      if (!entry) {
        entry = { measures: false, readsViewport: false };
        functions.set(fn, entry);
      }
      return entry;
    };

    let ast: unknown;
    try {
      ast = parse(source, { jsx: file.endsWith(".tsx"), range: true });
    } catch (error) {
      throw new Error(`placement-standard scanner could not parse ${file}: ${String(error)}`, { cause: error });
    }
    walk(ast, null, (node, enclosing) => {
      const name = identifierName(node);
      // An import specifier names the helper twice (`imported` and `local`, at the same place).
      if (name && LIFECYCLE_HELPERS.has(name)) helperSpots.add(node.range[0]);
      if (node.type === "Property" && node.computed !== true) {
        const key = identifierName(node.key) ?? stringValue(node.key);
        if (key === "position" && stringValue(node.value) === "fixed") counts["inline-fixed-position"] += 1;
      }
      if (callsGetBoundingClientRect(node)) note(enclosing).measures = true;
      if (readsViewportSize(node)) note(enclosing).readsViewport = true;
    });
    counts["overlay-lifecycle-outside-hook"] = helperSpots.size;
    counts["viewport-math-in-component"] = [...functions.values()].filter((f) => f.measures && f.readsViewport).length;

    for (const rule of RULES) {
      if (counts[rule] > 0 && !IMPLEMENTS_PLACEMENT[rule].has(file)) found[rule][file] = counts[rule];
    }
  }
  return found;
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkFiles(full, out);
    else if (/\.(?:ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

export function scanPlacementViolations(): Record<Rule, Counts> {
  const files: Record<string, string> = {};
  for (const root of SCAN_ROOTS) {
    for (const full of walkFiles(join(REPO_ROOT, root))) {
      files[relative(REPO_ROOT, full).split(sep).join("/")] = readFileSync(full, "utf8");
    }
  }
  return scanPlacement(files);
}
