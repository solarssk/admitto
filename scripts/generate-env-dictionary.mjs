#!/usr/bin/env node
/**
 * Scan the repo for environment variable references, merge with deploy/env-catalog.json
 * (human summaries + boot/UI metadata), and generate deploy/ENV.md.
 *
 * Usage:
 *   node scripts/generate-env-dictionary.mjs          # write deploy/ENV.md
 *   node scripts/generate-env-dictionary.mjs --check   # fail if ENV.md is stale or catalog drifts
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const catalogPath = join(root, "deploy/env-catalog.json");
const outPath = join(root, "deploy/ENV.md");
const checkOnly = process.argv.includes("--check");

const SCAN_DIRS = ["apps", "packages", "deploy"];
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".git",
  "uploads",
  "emergency-exports",
]);

/** Keys that appear as process.env in tests/fixtures but are not deploy operator config. */
const DEFAULT_SCAN_IGNORE = new Set([
  "CI",
  "COUNT",
  "PATH",
  "HOME",
  "PWD",
  "USER",
  "SHELL",
  "TMPDIR",
  "TERM",
  "LANG",
  "LC_ALL",
  "NODE_OPTIONS",
  "WEB_TEST_DATABASE_URL",
  "PGDATABASE",
  "PGHOST",
  "PGPORT",
  "PGUSER",
  "PGPASSWORD",
  "DATABASE_URL", // still catalogued; keep for dual use — do NOT ignore DATABASE_URL
]);

// Fix: remove DATABASE_URL from ignore - I accidentally thought to ignore it. Don't.

const TS_ENV_RE =
  /process\.env(?:\.([A-Z][A-Z0-9_]+)|\[\s*['"]([A-Z][A-Z0-9_]+)['"]\s*\])/g;
const ENV_BRACKET_RE = /\benv\[\s*['"]([A-Z][A-Z0-9_]+)['"]\s*\]/g;
const SHELL_ENV_RE = /\$\{([A-Z][A-Z0-9_]+)(?::-[^}]*)?\}|\$\{([A-Z][A-Z0-9_]+)\?[^}]*\}/g;
const ENV_EXAMPLE_LINE_RE = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]+)\s*=/gm;
const COMMENT_ENV_RE = /^\s*#\s*([A-Z][A-Z0-9_]+)=/gm;

function isTestPath(rel) {
  return (
    /(^|\/)test\//.test(rel) ||
    /\.test\.[jt]sx?$/.test(rel) ||
    /\.spec\.[jt]sx?$/.test(rel) ||
    /(^|\/)__tests__\//.test(rel)
  );
}

function walk(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

function addKey(map, key, file) {
  if (!key || key.length < 2) return;
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) return;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(file);
}

function scanFile(map, absPath) {
  const rel = relative(root, absPath);
  if (isTestPath(rel)) return;

  let text;
  try {
    text = readFileSync(absPath, "utf8");
  } catch {
    return;
  }

  const base = absPath.split("/").pop() ?? "";
  const isTsJs = /\.(ts|tsx|mjs|js)$/.test(base);
  const isShellYml =
    /\.(sh|yml|yaml)$/.test(base) ||
    base === "Dockerfile" ||
    base === "docker-entrypoint.sh" ||
    base.endsWith(".env.example");

  if (isTsJs) {
    TS_ENV_RE.lastIndex = 0;
    let m;
    while ((m = TS_ENV_RE.exec(text)) !== null) addKey(map, m[1] || m[2], rel);
    // apps/web config helpers often take EnvLike and read env["KEY"]
    ENV_BRACKET_RE.lastIndex = 0;
    while ((m = ENV_BRACKET_RE.exec(text)) !== null) addKey(map, m[1], rel);
  }

  // Compose `environment:` keys (KEY: value) without ${} interpolation
  if (/\.(yml|yaml)$/.test(base)) {
    const composeEnvKey = /^\s{2,}([A-Z][A-Z0-9_]+):\s*\S+/gm;
    let m;
    while ((m = composeEnvKey.exec(text)) !== null) addKey(map, m[1], rel);
  }

  if (isShellYml) {
    SHELL_ENV_RE.lastIndex = 0;
    let m;
    while ((m = SHELL_ENV_RE.exec(text)) !== null) addKey(map, m[1] || m[2], rel);
  }

  if (base.endsWith(".env.example")) {
    ENV_EXAMPLE_LINE_RE.lastIndex = 0;
    let m;
    while ((m = ENV_EXAMPLE_LINE_RE.exec(text)) !== null) addKey(map, m[1], rel);
    COMMENT_ENV_RE.lastIndex = 0;
    while ((m = COMMENT_ENV_RE.exec(text)) !== null) addKey(map, m[1], rel);
  }
}

function scanKeys() {
  /** @type {Map<string, Set<string>>} */
  const found = new Map();
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(root, dir))) scanFile(found, file);
  }
  const dockerfile = join(root, "Dockerfile");
  if (existsSync(dockerfile)) scanFile(found, dockerfile);
  return found;
}

function loadCatalog() {
  const raw = JSON.parse(readFileSync(catalogPath, "utf8"));
  if (!Array.isArray(raw.vars)) {
    throw new Error("deploy/env-catalog.json: missing vars[]");
  }
  const ignore = new Set([...(raw.scanIgnore ?? []), ...[...DEFAULT_SCAN_IGNORE].filter((k) => k !== "DATABASE_URL")]);
  const byName = new Map();
  for (const v of raw.vars) {
    if (!v.name || typeof v.name !== "string") {
      throw new Error("deploy/env-catalog.json: each var needs name");
    }
    if (byName.has(v.name)) {
      throw new Error(`deploy/env-catalog.json: duplicate var ${v.name}`);
    }
    byName.set(v.name, v);
  }
  return { ignore, byName, vars: raw.vars, intro: raw.intro };
}

function escapeCell(s) {
  return String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function renderMarkdown(catalog, scanned) {
  const lines = [];
  lines.push("# Admitto environment variable reference");
  lines.push("");
  lines.push("> Generated file. Do not edit by hand.");
  lines.push(">");
  lines.push("> Descriptions and boot/UI metadata: [`env-catalog.json`](./env-catalog.json).");
  lines.push("> Keys are cross-checked against `process.env` / compose / `.env.example` by `scripts/generate-env-dictionary.mjs`.");
  lines.push(">");
  lines.push("> Regenerate: `npm run docs:env` &nbsp;|&nbsp; Drift check: `npm run docs:env -- --check`");
  lines.push("");
  if (catalog.intro) {
    lines.push(catalog.intro.trim());
    lines.push("");
  }

  lines.push("## How to read this table");
  lines.push("");
  lines.push("| Column | Meaning |");
  lines.push("|--------|---------|");
  lines.push("| Boot | `required` = production is broken without it; `recommended` = set on first deploy; `optional` = defaults exist |");
  lines.push("| Consumers | Which roles read it (`app`, `worker`, `migrate`, ...) |");
  lines.push("| UI | Whether the same setting can be managed in admin Settings |");
  lines.push("| Secret | Treat as a credential; never commit real values |");
  lines.push("");

  const groups = [];
  const seenGroup = new Set();
  for (const v of catalog.vars) {
    const g = v.group || "other";
    if (!seenGroup.has(g)) {
      seenGroup.add(g);
      groups.push(g);
    }
  }

  const groupTitles = {
    boot: "Boot (set these first)",
    compose: "Compose / image",
    proxy: "Reverse proxy trust",
    migrate: "Migrations and DB backups",
    storage: "Uploads and emergency exports",
    mail: "Mail transport (often UI later)",
    worker: "Background worker",
    ops: "Ops / health / logging",
    sessions: "Sessions and MFA",
    identity: "Identity (env lock / seed)",
    maps: "Maps and geocoding",
    weather: "Weather",
    retention: "Retention",
    other: "Other",
  };

  for (const g of groups) {
    lines.push(`## ${groupTitles[g] ?? g}`);
    lines.push("");
    lines.push("| Variable | Boot | Consumers | UI | Secret | Summary |");
    lines.push("|----------|------|-----------|----|--------|---------|");
    for (const v of catalog.vars.filter((x) => (x.group || "other") === g)) {
      const consumers = (v.consumers ?? []).join(", ") || "-";
      const ui = v.ui ?? "none";
      const secret = v.secret ? "yes" : "no";
      const boot = v.boot ?? "optional";
      lines.push(
        `| \`${v.name}\` | ${escapeCell(boot)} | ${escapeCell(consumers)} | ${escapeCell(ui)} | ${secret} | ${escapeCell(v.summary)} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Maintenance");
  lines.push("");
  lines.push("1. Add or change a deploy-facing variable in code, compose, or `.env.example`.");
  lines.push("2. Update [`env-catalog.json`](./env-catalog.json) (summary, boot, consumers, ui).");
  lines.push("3. Run `npm run docs:env` and commit `ENV.md`.");
  lines.push("4. `npm run docs:check` fails if this file is stale or a scanned key is missing from the catalog.");
  lines.push("");
  lines.push(`_Last generated from ${scanned.size} distinct keys seen in scan (tests excluded)._`);
  lines.push("");
  return `${lines.join("\n")}`;
}

function main() {
  const catalog = loadCatalog();
  const scanned = scanKeys();
  const errors = [];

  for (const [key, files] of scanned) {
    if (catalog.ignore.has(key)) continue;
    if (!catalog.byName.has(key)) {
      const sample = [...files].slice(0, 5).join(", ");
      errors.push(
        `Scanned env key ${key} is not in deploy/env-catalog.json (e.g. ${sample}). Add it or list it under scanIgnore.`,
      );
    }
  }

  for (const v of catalog.vars) {
    if (v.catalogOnly) continue;
    if (!scanned.has(v.name) && !catalog.ignore.has(v.name)) {
      errors.push(
        `Catalog var ${v.name} was not found in code/compose/.env.example scan. Mark catalogOnly: true if docs-only, or fix the name.`,
      );
    }
  }

  const markdown = renderMarkdown(catalog, scanned);

  if (errors.length > 0) {
    for (const e of errors) console.error(`docs:env: ${e}`);
    process.exit(1);
  }

  if (checkOnly) {
    if (!existsSync(outPath)) {
      console.error("docs:env: deploy/ENV.md missing — run npm run docs:env");
      process.exit(1);
    }
    const existing = readFileSync(outPath, "utf8");
    if (existing !== markdown) {
      console.error("docs:env: deploy/ENV.md is stale — run npm run docs:env and commit");
      process.exit(1);
    }
    console.log("docs:env: ok (catalog + ENV.md in sync)");
    return;
  }

  writeFileSync(outPath, markdown, "utf8");
  console.log(
    `docs:env: wrote ${relative(root, outPath)} (${catalog.vars.length} catalog vars, ${scanned.size} scanned)`,
  );
}

main();
