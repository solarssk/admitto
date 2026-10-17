import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@typescript-eslint/parser";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
/** Where staff UI code lives. */
const SCAN_ROOT = "apps/admin/src";

export const RULES = ["viewer-zone-read", "viewer-local-time"] as const;
export type Rule = (typeof RULES)[number];
export type Counts = Record<string, number>;

/** Where each rule sends the author instead. Shown in the failure message. */
export const RULE_HINTS: Record<Rule, string> = {
  "viewer-zone-read":
    "Do not read the viewer's own time zone to show a time: two people looking at the same screen would read different clocks. Show the zone the actor was in when it is stored (formatEventDateTime(iso, actorZone)) and otherwise UTC (formatUtcDateTime(iso)). See standards/admin-spa/time-display.md.",
  "viewer-local-time":
    "viewerLocalTime() puts the viewer's own zone in the text. It belongs only on a secondary \"Your local time\" line under a UTC primary time (ActorOrViewerLocalTimeLine). Show the time itself with formatUtcDateTime(iso), or with formatEventDateTime(iso, actorZone) when the zone is stored. See standards/admin-spa/time-display.md.",
};

/** Files that implement the rule: the date helpers themselves, and the module that stamps the acting
 * browser's zone on every request (`X-Client-Timezone`), which is capture, not display. */
const IMPLEMENTS_TIME_ZONES: ReadonlySet<string> = new Set([
  "apps/admin/src/utils/event-dates.ts",
  "apps/admin/src/api/client.ts",
]);

/** AST keys that point back up the tree or hold source positions, not children. */
const NOT_CHILDREN = new Set(["parent", "loc", "range", "tokens", "comments"]);

type Node = { type: string; [key: string]: unknown };

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function walk(value: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(value)) {
    for (const child of value) walk(child, visit);
    return;
  }
  if (!isNode(value)) return;
  visit(value);
  for (const [key, child] of Object.entries(value)) {
    if (!NOT_CHILDREN.has(key)) walk(child, visit);
  }
}

function identifierName(node: unknown): string | undefined {
  return isNode(node) && node.type === "Identifier" ? (node.name as string) : undefined;
}

function callee(node: Node): unknown {
  return node.type === "CallExpression" ? node.callee : undefined;
}

/** `something.resolvedOptions()`: the call that hands out the browser's own zone. */
function isResolvedOptionsCall(node: unknown): boolean {
  if (!isNode(node)) return false;
  const target = callee(node);
  return isNode(target) && target.type === "MemberExpression" && identifierName(target.property) === "resolvedOptions";
}

/** `Intl.DateTimeFormat().resolvedOptions().timeZone`, in any spelling of the first part. */
function readsZoneFromResolvedOptions(node: Node): boolean {
  return node.type === "MemberExpression" && node.computed !== true && identifierName(node.property) === "timeZone" && isResolvedOptionsCall(node.object);
}

/** `const { timeZone } = Intl.DateTimeFormat().resolvedOptions();`, also renamed. */
function destructuresZoneFromResolvedOptions(node: Node): boolean {
  if (node.type !== "VariableDeclarator" || !isNode(node.id) || node.id.type !== "ObjectPattern") return false;
  if (!isResolvedOptionsCall(node.init)) return false;
  return (node.id.properties as Node[]).some((p) => p.type === "Property" && p.computed !== true && identifierName(p.key) === "timeZone");
}

function callsFunction(node: Node, name: string): boolean {
  return identifierName(callee(node)) === name;
}

/** Findings per rule and file (repo-relative, `/`-separated) for the given sources. */
export function scanTimeZones(files: Record<string, string>): Record<Rule, Counts> {
  const found: Record<Rule, Counts> = { "viewer-zone-read": {}, "viewer-local-time": {} };
  for (const [file, source] of Object.entries(files)) {
    if (IMPLEMENTS_TIME_ZONES.has(file)) continue;
    let ast: unknown;
    try {
      ast = parse(source, { jsx: file.endsWith(".tsx"), range: true });
    } catch (error) {
      throw new Error(`time-zone-standard scanner could not parse ${file}: ${String(error)}`, { cause: error });
    }
    const counts: Record<Rule, number> = { "viewer-zone-read": 0, "viewer-local-time": 0 };
    walk(ast, (node) => {
      if (callsFunction(node, "getBrowserTimeZone") || readsZoneFromResolvedOptions(node) || destructuresZoneFromResolvedOptions(node)) {
        counts["viewer-zone-read"] += 1;
      }
      if (callsFunction(node, "viewerLocalTime")) counts["viewer-local-time"] += 1;
    });
    for (const rule of RULES) {
      if (counts[rule] > 0) found[rule][file] = counts[rule];
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

export function scanTimeZoneViolations(): Record<Rule, Counts> {
  const files: Record<string, string> = {};
  for (const full of walkFiles(join(REPO_ROOT, SCAN_ROOT))) {
    files[relative(REPO_ROOT, full).split(sep).join("/")] = readFileSync(full, "utf8");
  }
  return scanTimeZones(files);
}
