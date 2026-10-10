// Guards the files that steer coding agents (AGENTS.md, CLAUDE.md, nested AGENTS.md, standards/).
// They grow by accretion, and an oversized root file is silently truncated by some tools (Codex
// stops at 32 KiB), so the size budgets here are what keeps the always-loaded part complete.
// Dependency-free on purpose: the wiki-docs CI job runs it without `npm ci`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export const BUDGETS = {
  root: 90_000, // AGENTS.md. Temporary: 20_000 once the loading standard has moved to standards/. With one nested file in the chain it must stay under Codex's 32 KiB.
  nested: 10_000, // apps/*/AGENTS.md, packages/*/AGENTS.md
  claude: 4_000, // every CLAUDE.md
  standard: 24_000, // each file under standards/
};

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

export function slug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replaceAll(/[`*_~]/g, "")
    .replaceAll(/[^\p{L}\p{N}\s-]/gu, "")
    .replaceAll(/\s/g, "-");
}

const posix = (path) => path.replaceAll("\\", "/");

// "## Title ##": the closing hashes are not part of the heading (CommonMark), but "## C#" keeps its #.
function withoutClosingHashes(heading) {
  const text = heading.trimEnd();
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end--;
  return end > 0 && end < text.length && text[end - 1] === " " ? text.slice(0, end).trimEnd() : text;
}

function anchorsOf(text) {
  const seen = new Map();
  const set = new Set();
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const m = !fenced && /^#{1,6}\s+(.*)$/.exec(line);
    if (!m) continue;
    const base = slug(withoutClosingHashes(m[1]));
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    set.add(n === 0 ? base : `${base}-${n}`);
  }
  return set;
}

function linksOf(text) {
  const links = [];
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const bare = line.replaceAll(/`[^`]*`/g, "");
    for (const m of bare.matchAll(/\]\(([^)\s]+)\)/g)) links.push(m[1]);
  }
  return links;
}

function budgetOf(file) {
  if (file === "AGENTS.md") return BUDGETS.root;
  if (file.endsWith("CLAUDE.md")) return BUDGETS.claude;
  if (file.startsWith("standards/")) return BUDGETS.standard;
  return BUDGETS.nested;
}

function checkSizes(root, steering) {
  const problems = [];
  for (const f of steering) {
    const size = statSync(join(root, f)).size;
    const budget = budgetOf(f);
    if (size > budget) {
      problems.push(`${f} is ${size} bytes, over its ${budget} byte budget. Move detail into a standards/ file and keep a one-line rule plus a link here.`);
    }
  }
  return problems;
}

function checkLinks(root, steering) {
  const problems = [];
  const anchorCache = new Map();
  const anchors = (path) => {
    if (!anchorCache.has(path)) anchorCache.set(path, anchorsOf(readFileSync(path, "utf8")));
    return anchorCache.get(path);
  };
  for (const f of steering) {
    for (const href of linksOf(readFileSync(join(root, f), "utf8"))) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue; // https:, mailto:
      const [target, hash] = href.split("#");
      const path = target ? resolve(root, dirname(f), target) : join(root, f);
      if (!existsSync(path)) problems.push(`${f}: link to ${href} does not resolve.`);
      else if (hash && path.endsWith(".md") && !anchors(path).has(hash)) {
        problems.push(`${f}: link to ${href} points at a heading that does not exist.`);
      }
    }
  }
  return problems;
}

function linkedFiles(root, indexFile) {
  const dir = dirname(indexFile);
  return new Set(
    linksOf(readFileSync(indexFile, "utf8")).map((h) => posix(relative(root, resolve(dir, h.split("#")[0])))),
  );
}

function checkIndex(root, steering) {
  const pages = steering.filter((f) => f.startsWith("standards/"));
  if (pages.length === 0) return [];
  const index = join(root, "standards/README.md");
  if (!existsSync(index)) return ["standards/README.md (the index) is missing."];
  const top = linkedFiles(root, index);
  // A sub-index (standards/admin-spa/README.md) may list the files of its own folder.
  const sub = new Map();
  const listedBySubIndex = (f) => {
    const subIndex = `${dirname(f)}/README.md`;
    if (dirname(f) === "standards" || !top.has(subIndex)) return false;
    if (!sub.has(subIndex)) sub.set(subIndex, linkedFiles(root, join(root, subIndex)));
    return sub.get(subIndex).has(f);
  };
  return pages
    .filter((f) => f !== "standards/README.md" && !top.has(f) && !listedBySubIndex(f))
    .map((f) => `${f} is not listed in standards/README.md.`);
}

export function checkAgentDocs(root) {
  const files = walk(root).map((f) => posix(relative(root, f)));
  const steering = files.filter(
    (f) =>
      /(^|\/)(AGENTS|CLAUDE)\.md$/.test(f) ||
      (f.startsWith("standards/") && f.endsWith(".md")) ||
      /^\.(claude|cursor)\/rules\/[^/]+\.(md|mdc)$/.test(f),
  );
  return [...checkSizes(root, steering), ...checkLinks(root, steering), ...checkIndex(root, steering)];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = checkAgentDocs(resolve(import.meta.dirname, ".."));
  if (problems.length) {
    console.error(problems.map((p) => `check-agent-docs: ${p}`).join("\n"));
    process.exit(1);
  }
  console.log("check-agent-docs: agent instruction files are within budget and every link resolves.");
}
