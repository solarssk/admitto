import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@typescript-eslint/parser";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
/** Where staff UI code lives. */
const SCAN_ROOT = "apps/admin/src";

export const RULES = ["viewer-zone-read", "viewer-local-time", "implicit-zone-format", "zone-fallback-not-utc"] as const;
export type Rule = (typeof RULES)[number];
export type Counts = Record<string, number>;

/** Where each rule sends the author instead. Shown in the failure message. */
export const RULE_HINTS: Record<Rule, string> = {
  "viewer-zone-read":
    "Do not read the viewer's own time zone to show a time: two people looking at the same screen would read different clocks. Show the zone the actor was in when it is stored and otherwise UTC: formatActorTime(iso, actorZone). See standards/admin-spa/time-display.md.",
  "viewer-local-time":
    'viewerLocalTime() puts the viewer\'s own zone in the text. It belongs only on a secondary "Your local time" line under a UTC primary time (ActorOrViewerLocalTimeLine). Show the time itself with formatActorTime(iso, actorZone). See standards/admin-spa/time-display.md.',
  "implicit-zone-format":
    "An Intl.DateTimeFormat, toLocaleDateString or toLocaleTimeString call with no `timeZone` option formats in the viewer's zone. Pass `timeZone` (\"UTC\" for a value pinned to UTC), or use a helper from utils/event-dates.ts. See standards/admin-spa/time-display.md.",
  "zone-fallback-not-utc":
    'A time must not fall back to another zone when the actor\'s zone is not stored (`actorZone ?? eventZone` reads as a fact something that is a guess). Use formatActorTime(iso, actorZone): it shows UTC. See standards/admin-spa/time-display.md.',
};

/** Files that implement the rule: the date helpers themselves, and the module that stamps the acting
 * browser's zone on every request (`X-Client-Timezone`), which is capture, not display. */
const IMPLEMENTS_TIME_ZONES: ReadonlySet<string> = new Set([
  "apps/admin/src/utils/event-dates.ts",
  "apps/admin/src/api/client.ts",
]);

/** The helpers whose result carries the viewer's own zone, by rule. */
const VIEWER_ZONE_HELPER = "getBrowserTimeZone";
const VIEWER_LOCAL_TIME_HELPER = "viewerLocalTime";

/** Zone-taking helpers of utils/event-dates.ts, with the position of their zone argument. */
const ZONE_ARGUMENT: Record<string, number> = {
  formatActorTime: 1,
  formatEventDateTime: 1,
  formatEventTime: 1,
  formatEventDate: 1,
  formatEventClockTime: 1,
  formatZonedClockTime: 1,
  formatAdmissionDisplayParts: 1,
  formatAdmissionDisplay: 2,
  formatRelativeAdmissionDisplay: 2,
};

/** AST keys that point back up the tree or hold source positions, not children. */
const NOT_CHILDREN = new Set(["parent", "loc", "range", "tokens", "comments"]);

type Node = { type: string; [key: string]: unknown };

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function walk(value: unknown, ancestors: Node[], visit: (node: Node, ancestors: Node[]) => void): void {
  if (Array.isArray(value)) {
    for (const child of value) walk(child, ancestors, visit);
    return;
  }
  if (!isNode(value)) return;
  visit(value, ancestors);
  const next = [...ancestors, value];
  for (const [key, child] of Object.entries(value)) {
    if (!NOT_CHILDREN.has(key)) walk(child, next, visit);
  }
}

function identifierName(node: unknown): string | undefined {
  return isNode(node) && node.type === "Identifier" ? (node.name as string) : undefined;
}

function stringValue(node: unknown): string | undefined {
  return isNode(node) && node.type === "Literal" && typeof node.value === "string" ? node.value : undefined;
}

/** The name of the function or method a call goes to: `f(...)` and `x.f(...)` both give "f". */
function calleeName(node: Node): string | undefined {
  if (node.type !== "CallExpression" && node.type !== "NewExpression") return undefined;
  const target = node.callee;
  if (!isNode(target)) return undefined;
  if (target.type === "MemberExpression" && target.computed !== true) return identifierName(target.property);
  return identifierName(target);
}

function isIntlDateTimeFormat(node: Node): boolean {
  if ((node.type !== "CallExpression" && node.type !== "NewExpression") || !isNode(node.callee)) return false;
  const target = node.callee;
  return target.type === "MemberExpression" && identifierName(target.object) === "Intl" && identifierName(target.property) === "DateTimeFormat";
}

/** Whether an options argument names a zone: an object with a `timeZone` key, or one with a spread (which may). */
function namesATimeZone(options: unknown): boolean {
  if (!isNode(options) || options.type !== "ObjectExpression") return false;
  return (options.properties as Node[]).some(
    (p) => p.type === "SpreadElement" || (p.type === "Property" && p.computed !== true && (identifierName(p.key) === "timeZone" || stringValue(p.key) === "timeZone")),
  );
}

/** `Intl.DateTimeFormat(...)` that is only built to be asked `.resolvedOptions()`: the read rule counts that call. */
function isBuiltToReadOptions(node: Node, ancestors: Node[]): boolean {
  const parent = ancestors.at(-1);
  return parent?.type === "MemberExpression" && parent.object === node && identifierName(parent.property) === "resolvedOptions";
}

/** The operands of a chain of `??` and `||`: `a ?? b ?? c` gives [a, b, c]. */
function chainOperands(node: unknown): unknown[] {
  if (!isNode(node) || node.type !== "LogicalExpression" || (node.operator !== "??" && node.operator !== "||")) return [node];
  return [...chainOperands(node.left), ...chainOperands(node.right)];
}

/** A fallback that names no zone: the literal "UTC", `undefined` or `null`, which the helpers read as UTC. */
function isUtcFallback(node: unknown): boolean {
  return stringValue(node) === "UTC" || identifierName(node) === "undefined" || (isNode(node) && node.type === "Literal" && node.value === null);
}

/** `x ?? y` or `x || y` (in any chain) where something after the first operand names another zone. */
function isNonUtcFallback(node: unknown): boolean {
  return chainOperands(node).slice(1).some((operand) => !isUtcFallback(operand));
}

/** Local names that an import gives to `imported`, plus the nodes of the import specifiers themselves. */
function importedAs(importSpecifiers: Node[], imported: string): Set<string> {
  const names = new Set<string>([imported]);
  for (const specifier of importSpecifiers) {
    if (identifierName(specifier.imported) === imported) {
      const local = identifierName(specifier.local);
      if (local) names.add(local);
    }
  }
  return names;
}

/** Findings per rule and file (repo-relative, `/`-separated) for the given sources. */
export function scanTimeZones(files: Record<string, string>): Record<Rule, Counts> {
  const found: Record<Rule, Counts> = { "viewer-zone-read": {}, "viewer-local-time": {}, "implicit-zone-format": {}, "zone-fallback-not-utc": {} };
  for (const [file, source] of Object.entries(files)) {
    if (IMPLEMENTS_TIME_ZONES.has(file)) continue;
    let ast: unknown;
    try {
      ast = parse(source, { jsx: file.endsWith(".tsx"), range: true });
    } catch (error) {
      throw new Error(`time-zone-standard scanner could not parse ${file}: ${String(error)}`, { cause: error });
    }

    const importSpecifiers: Node[] = [];
    const references: { node: Node; name: string; member: boolean }[] = [];
    const counts: Record<Rule, number> = { "viewer-zone-read": 0, "viewer-local-time": 0, "implicit-zone-format": 0, "zone-fallback-not-utc": 0 };
    walk(ast, [], (node, ancestors) => {
      if (node.type === "ImportSpecifier") importSpecifiers.push(node);
      const parent = ancestors.at(-1);
      // A name used anywhere but in its own import: a call, an argument, an alias, `ns.name`.
      if (node.type === "Identifier" && parent?.type !== "ImportSpecifier" && !(parent?.type === "MemberExpression" && parent.property === node && parent.computed !== true)) {
        references.push({ node, name: node.name as string, member: false });
      }
      if (node.type === "MemberExpression" && node.computed !== true) {
        const property = identifierName(node.property);
        if (property) references.push({ node, name: property, member: true });
      }
      if (calleeName(node) === "resolvedOptions") counts["viewer-zone-read"] += 1;
      if (isIntlDateTimeFormat(node) && !isBuiltToReadOptions(node, ancestors) && !namesATimeZone((node.arguments as unknown[])[1])) {
        counts["implicit-zone-format"] += 1;
      }
      const method = node.type === "CallExpression" ? calleeName(node) : undefined;
      if ((method === "toLocaleDateString" || method === "toLocaleTimeString") && !namesATimeZone((node.arguments as unknown[])[1])) {
        counts["implicit-zone-format"] += 1;
      }
      const zoneArgument = node.type === "CallExpression" ? ZONE_ARGUMENT[identifierName(node.callee) ?? ""] : undefined;
      if (zoneArgument !== undefined && isNonUtcFallback((node.arguments as unknown[])[zoneArgument])) counts["zone-fallback-not-utc"] += 1;
    });

    const viewerZoneNames = importedAs(importSpecifiers, VIEWER_ZONE_HELPER);
    const viewerLocalTimeNames = importedAs(importSpecifiers, VIEWER_LOCAL_TIME_HELPER);
    for (const reference of references) {
      if (viewerZoneNames.has(reference.name)) counts["viewer-zone-read"] += 1;
      if (viewerLocalTimeNames.has(reference.name)) counts["viewer-local-time"] += 1;
    }

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
