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
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

function anchorsOf(text) {
  const seen = new Map();
  const set = new Set();
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const m = !fenced && /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = slug(m[1]);
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
    const bare = line.replace(/`[^`]*`/g, "");
    for (const m of bare.matchAll(/\]\(([^)\s]+)\)/g)) links.push(m[1]);
  }
  return links;
}

export function checkAgentDocs(root) {
  const problems = [];
  const files = walk(root).map((f) => relative(root, f).split("\\").join("/"));
  const isSteering = (f) =>
    /(^|\/)(AGENTS|CLAUDE)\.md$/.test(f) || (f.startsWith("standards/") && f.endsWith(".md"));
  const steering = files.filter(isSteering);

  for (const f of steering) {
    const size = statSync(join(root, f)).size;
    let budget = BUDGETS.nested;
    if (f === "AGENTS.md") budget = BUDGETS.root;
    else if (f.endsWith("CLAUDE.md")) budget = BUDGETS.claude;
    else if (f.startsWith("standards/")) budget = BUDGETS.standard;
    if (size > budget) {
      problems.push(`${f} is ${size} bytes, over its ${budget} byte budget. Move detail into a standards/ file and keep a one-line rule plus a link here.`);
    }
  }

  const anchorCache = new Map();
  const anchors = (path) => {
    if (!anchorCache.has(path)) anchorCache.set(path, anchorsOf(readFileSync(path, "utf8")));
    return anchorCache.get(path);
  };
  for (const f of steering) {
    const text = readFileSync(join(root, f), "utf8");
    for (const href of linksOf(text)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue; // https:, mailto:
      const [target, hash] = href.split("#");
      const path = target ? resolve(root, dirname(f), target) : join(root, f);
      if (!existsSync(path)) {
        problems.push(`${f}: link to ${href} does not resolve.`);
      } else if (hash && path.endsWith(".md") && !statSync(path).isDirectory() && !anchors(path).has(hash)) {
        problems.push(`${f}: link to ${href} points at a heading that does not exist.`);
      }
    }
  }

  const index = join(root, "standards/README.md");
  if (steering.some((f) => f.startsWith("standards/"))) {
    if (!existsSync(index)) {
      problems.push("standards/README.md (the index) is missing.");
    } else {
      const indexed = new Set(
        linksOf(readFileSync(index, "utf8")).map((h) => relative(root, resolve(dirname(index), h.split("#")[0])).split("\\").join("/")),
      );
      // A sub-index (standards/admin-spa/README.md) may list the files of its own folder.
      for (const f of steering.filter((s) => s.startsWith("standards/") && s !== "standards/README.md")) {
        const dir = dirname(f);
        const sub = `${dir}/README.md`;
        const viaSub = dir !== "standards" && indexed.has(sub) && existsSync(join(root, sub)) &&
          new Set(linksOf(readFileSync(join(root, sub), "utf8")).map((h) => relative(root, resolve(join(root, dir), h.split("#")[0])).split("\\").join("/"))).has(f);
        if (!indexed.has(f) && f !== sub && !viaSub) problems.push(`${f} is not listed in standards/README.md.`);
      }
    }
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = checkAgentDocs(resolve(import.meta.dirname, ".."));
  if (problems.length) {
    console.error(problems.map((p) => `check-agent-docs: ${p}`).join("\n"));
    process.exit(1);
  }
  console.log("check-agent-docs: agent instruction files are within budget and every link resolves.");
}
