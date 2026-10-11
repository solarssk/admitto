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
/** Objects the browser's global scope is reachable through. */
const GLOBAL_OBJECTS = new Set(["window", "globalThis", "self"]);
/** Keys that, next to `position: "fixed"`, make an object a style rather than data. */
const STYLE_KEYS = new Set([
  "top", "left", "right", "bottom", "inset", "transform", "zIndex", "visibility", "opacity", "pointerEvents",
  "width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight", "margin", "overflow", "overflowY",
]);
const DOCUMENT_SIZE = new Set(["clientWidth", "clientHeight"]);
/** AST keys that point back up the tree or hold source positions, not children. */
const NOT_CHILDREN = new Set(["parent", "loc", "range", "tokens", "comments"]);

type Node = { type: string; range: [number, number]; [key: string]: unknown };

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function walk(
  value: unknown,
  enclosing: Node | null,
  ancestors: Node[],
  visit: (node: Node, enclosing: Node | null, ancestors: Node[]) => void,
): void {
  if (Array.isArray(value)) {
    for (const child of value) walk(child, enclosing, ancestors, visit);
    return;
  }
  if (!isNode(value)) return;
  visit(value, enclosing, ancestors);
  const next = FUNCTIONS.has(value.type) ? value : enclosing;
  const nextAncestors = [...ancestors, value];
  for (const [key, child] of Object.entries(value)) {
    if (!NOT_CHILDREN.has(key)) walk(child, next, nextAncestors, visit);
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

/** `window.innerWidth`, `visualViewport`, `document.documentElement.clientHeight` and the like. */
function readsViewportSize(node: Node, parent: Node | undefined): boolean {
  // A bare `innerHeight` or `visualViewport` is the same global. It has to be a reference: not the property
  // of another object (`panel.innerHeight`) and not the key of an object literal.
  if (node.type === "Identifier") {
    if (!WINDOW_SIZE.has(node.name as string) || !parent) return false;
    if (parent.type === "MemberExpression" && parent.property === node && parent.computed !== true) return false;
    if (parent.type === "Property" && parent.key === node && parent.computed !== true && parent.shorthand !== true) return false;
    return !["VariableDeclarator", "FunctionDeclaration", "ImportSpecifier", "ExportSpecifier"].includes(parent.type) || parent.id !== node;
  }
  if (node.type !== "MemberExpression" || node.computed === true) return false;
  const property = identifierName(node.property);
  if (!property) return false;
  const objectName = identifierName(node.object);
  if (objectName && GLOBAL_OBJECTS.has(objectName)) return WINDOW_SIZE.has(property);
  const object = node.object;
  return (
    isNode(object) &&
    object.type === "MemberExpression" &&
    identifierName(object.object) === "document" &&
    identifierName(object.property) === "documentElement" &&
    DOCUMENT_SIZE.has(property)
  );
}

/** Whether an object literal is a style: it sits in a JSX `style` attribute, is typed `CSSProperties`, or has
 * a CSS key next to its `position`. A `{ position: "fixed" }` that is data of some other kind is not. */
function isStyleObject(object: Node, ancestors: Node[]): boolean {
  const keys = (object.properties as Node[]).map((p) => (p.type === "Property" ? (identifierName(p.key) ?? stringValue(p.key)) : undefined));
  if (keys.some((key) => key !== undefined && STYLE_KEYS.has(key))) return true;
  const container = ancestors.at(-1);
  const attribute = ancestors.at(-2);
  if (container?.type === "JSXExpressionContainer" && attribute?.type === "JSXAttribute" && jsxName(attribute) === "style") {
    return true;
  }
  // `const s: CSSProperties = {...}`, `{...} as CSSProperties`, `useState<CSSProperties>({...})`
  return ancestors.slice(-3).some((ancestor) => JSON.stringify(typeNames(ancestor)).includes("CSSProperties"));
}

function jsxName(attribute: Node): string | undefined {
  const name = attribute.name;
  return isNode(name) && name.type === "JSXIdentifier" ? (name.name as string) : undefined;
}

/** The type names written on a declarator, a cast or a call's type arguments. */
function typeNames(node: Node): string[] {
  const names: string[] = [];
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(collect);
    else if (isNode(value)) {
      if (value.type === "TSTypeReference") {
        const name = identifierName(value.typeName);
        if (name) names.push(name);
      }
      for (const [key, child] of Object.entries(value)) if (!NOT_CHILDREN.has(key)) collect(child);
    }
  };
  if (node.type === "VariableDeclarator") collect((node.id as Node).typeAnnotation);
  else if (node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression") collect(node.typeAnnotation);
  else if (node.type === "CallExpression") collect(node.typeArguments);
  return names;
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
    walk(ast, null, [], (node, enclosing, ancestors) => {
      const name = identifierName(node);
      // An import specifier names the helper twice (`imported` and `local`, at the same place).
      if (name && LIFECYCLE_HELPERS.has(name)) helperSpots.add(node.range[0]);
      if (node.type === "Property" && node.computed !== true) {
        const key = identifierName(node.key) ?? stringValue(node.key);
        const object = ancestors.at(-1);
        if (key === "position" && stringValue(node.value) === "fixed" && object?.type === "ObjectExpression" && isStyleObject(object, ancestors.slice(0, -1))) {
          counts["inline-fixed-position"] += 1;
        }
      }
      if (callsGetBoundingClientRect(node)) note(enclosing).measures = true;
      if (readsViewportSize(node, ancestors.at(-1))) note(enclosing).readsViewport = true;
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
