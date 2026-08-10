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

/** Keys seen in process.env in tests/fixtures that are not deploy operator config. */
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
]);

const ENV_KEY = "([A-Z][A-Z0-9_]*)";
const TS_ENV_DOT_RE = new RegExp(String.raw`process\.env\.${ENV_KEY}`, "g");
const TS_ENV_BRACKET_RE = new RegExp(String.raw`process\.env\[\s*['"]${ENV_KEY}['"]\s*\]`, "g");
const ENV_LIKE_BRACKET_RE = new RegExp(String.raw`\benv\[\s*['"]${ENV_KEY}['"]\s*\]`, "g");
// Capture only the variable name; ignore ${VAR:-default} / ${VAR:?err} suffixes.
const SHELL_BRACE_RE = new RegExp(String.raw`\$\{${ENV_KEY}`, "g");
const ENV_ASSIGN_RE = new RegExp(String.raw`^${ENV_KEY}=`, "gm");
const ENV_EXPORT_RE = new RegExp(String.raw`^export\s+${ENV_KEY}=`, "gm");
const ENV_COMMENT_RE = new RegExp(String.raw`^#\s*${ENV_KEY}=`, "gm");
const COMPOSE_ENV_KEY_RE = new RegExp(String.raw`^[ \t]+${ENV_KEY}:`, "gm");

const GROUP_TITLES = {
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
    if (st.isDirectory()) {
      walk(full, files);
    } else {
      files.push(full);
    }
  }
  return files;
}

function addKey(map, key, file) {
  if (!key || key.length < 2) return;
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) return;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(file);
}

function collectMatches(map, text, regex, file, groupIndex = 1) {
  regex.lastIndex = 0;
  let match = regex.exec(text);
  while (match !== null) {
    addKey(map, match[groupIndex], file);
    match = regex.exec(text);
  }
}

function scanTsJs(map, text, rel) {
  collectMatches(map, text, TS_ENV_DOT_RE, rel);
  collectMatches(map, text, TS_ENV_BRACKET_RE, rel);
  collectMatches(map, text, ENV_LIKE_BRACKET_RE, rel);
}

function scanShellOrCompose(map, text, rel, base) {
  if (/\.(yml|yaml)$/.test(base)) {
    collectMatches(map, text, COMPOSE_ENV_KEY_RE, rel);
  }
  if (
    /\.(sh|yml|yaml)$/.test(base) ||
    base === "Dockerfile" ||
    base === "docker-entrypoint.sh" ||
    base.endsWith(".env.example")
  ) {
    collectMatches(map, text, SHELL_BRACE_RE, rel);
  }
}

function scanEnvExample(map, text, rel, base) {
  if (!base.endsWith(".env.example")) return;
  collectMatches(map, text, ENV_ASSIGN_RE, rel);
  collectMatches(map, text, ENV_EXPORT_RE, rel);
  collectMatches(map, text, ENV_COMMENT_RE, rel);
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
  if (/\.(ts|tsx|mjs|js)$/.test(base)) {
    scanTsJs(map, text, rel);
  }
  scanShellOrCompose(map, text, rel, base);
  scanEnvExample(map, text, rel, base);
}

function scanKeys() {
  /** @type {Map<string, Set<string>>} */
  const found = new Map();
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(root, dir))) {
      scanFile(found, file);
    }
  }
  const dockerfile = join(root, "Dockerfile");
  if (existsSync(dockerfile)) {
    scanFile(found, dockerfile);
  }
  return found;
}

function loadCatalog() {
  const raw = JSON.parse(readFileSync(catalogPath, "utf8"));
  if (!Array.isArray(raw.vars)) {
    throw new TypeError("deploy/env-catalog.json: missing vars[]");
  }
  const ignore = new Set([...(raw.scanIgnore ?? []), ...DEFAULT_SCAN_IGNORE]);
  const byName = new Map();
  for (const v of raw.vars) {
    if (!v.name || typeof v.name !== "string") {
      throw new TypeError("deploy/env-catalog.json: each var needs name");
    }
    if (byName.has(v.name)) {
      throw new Error(`deploy/env-catalog.json: duplicate var ${v.name}`);
    }
    byName.set(v.name, v);
  }
  return { ignore, byName, vars: raw.vars, intro: raw.intro };
}

function escapeCell(s) {
  // Backslashes first so later pipe escapes stay intact (CodeQL js/incomplete-sanitization).
  const bs = "\u005c";
  return String(s ?? "")
    .replaceAll(bs, bs + bs)
    .replaceAll("|", bs + "|")
    .replaceAll("\r\n", " ")
    .replaceAll("\n", " ")
    .replaceAll("\r", " ");
}

function orderedGroups(vars) {
  const groups = [];
  const seen = new Set();
  for (const v of vars) {
    const g = v.group || "other";
    if (seen.has(g)) continue;
    seen.add(g);
    groups.push(g);
  }
  return groups;
}

function renderGroupSection(lines, catalog, group) {
  lines.push(`## ${GROUP_TITLES[group] ?? group}`, "");
  lines.push(
    "| Variable | Boot | Consumers | UI | Secret | Summary |",
    "|----------|------|-----------|----|--------|---------|",
  );
  for (const v of catalog.vars.filter((x) => (x.group || "other") === group)) {
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

function renderMarkdown(catalog, scanned) {
  const lines = [
    "# Admitto environment variable reference",
    "",
    "> Generated file. Do not edit by hand.",
    ">",
    "> Descriptions and boot/UI metadata: [`env-catalog.json`](./env-catalog.json).",
    "> Keys are cross-checked against `process.env` / compose / `.env.example` by `scripts/generate-env-dictionary.mjs`.",
    ">",
    "> Regenerate: `npm run docs:env` &nbsp;|&nbsp; Drift check: `npm run docs:env -- --check`",
    "",
  ];
  if (catalog.intro) {
    lines.push(catalog.intro.trim(), "");
  }
  lines.push(
    "## How to read this table",
    "",
    "| Column | Meaning |",
    "|--------|---------|",
    "| Boot | `required` = production is broken without it; `recommended` = set on first deploy; `optional` = defaults exist |",
    "| Consumers | Which roles read it (`app`, `worker`, `migrate`, ...) |",
    "| UI | Whether the same setting can be managed in admin Settings |",
    "| Secret | Treat as a credential; never commit real values |",
    "",
  );

  for (const group of orderedGroups(catalog.vars)) {
    renderGroupSection(lines, catalog, group);
  }

  lines.push(
    "## Maintenance",
    "",
    "1. Add or change a deploy-facing variable in code, compose, or `.env.example`.",
    "2. Update [`env-catalog.json`](./env-catalog.json) (summary, boot, consumers, ui).",
    "3. Run `npm run docs:env` and commit `ENV.md`.",
    "4. `npm run docs:check` fails if this file is stale or a scanned key is missing from the catalog.",
    "",
    `_Last generated from ${scanned.size} distinct keys seen in scan (tests excluded)._`,
    "",
  );
  return lines.join("\n");
}

function collectCatalogErrors(catalog, scanned) {
  const errors = [];
  for (const [key, files] of scanned) {
    if (catalog.ignore.has(key) || catalog.byName.has(key)) continue;
    const sample = [...files].slice(0, 5).join(", ");
    errors.push(
      `Scanned env key ${key} is not in deploy/env-catalog.json (e.g. ${sample}). Add it or list it under scanIgnore.`,
    );
  }
  for (const v of catalog.vars) {
    if (v.catalogOnly) continue;
    if (scanned.has(v.name) || catalog.ignore.has(v.name)) continue;
    errors.push(
      `Catalog var ${v.name} was not found in code/compose/.env.example scan. Mark catalogOnly: true if docs-only, or fix the name.`,
    );
  }
  return errors;
}

function writeOrCheck(markdown, catalog, scanned) {
  if (checkOnly) {
    if (!existsSync(outPath)) {
      console.error("docs:env: deploy/ENV.md missing - run npm run docs:env");
      process.exit(1);
    }
    if (readFileSync(outPath, "utf8") !== markdown) {
      console.error("docs:env: deploy/ENV.md is stale - run npm run docs:env and commit");
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

function main() {
  const catalog = loadCatalog();
  const scanned = scanKeys();
  const errors = collectCatalogErrors(catalog, scanned);
  if (errors.length > 0) {
    console.error(errors.map((e) => `docs:env: ${e}`).join("\n"));
    process.exit(1);
  }
  writeOrCheck(renderMarkdown(catalog, scanned), catalog, scanned);
}

main();
