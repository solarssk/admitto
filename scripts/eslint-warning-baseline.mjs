#!/usr/bin/env node
/**
 * ESLint new-warning gate.
 *
 * `npm run lint` currently reports a non-zero number of warnings (ESLint's default behavior never
 * fails a run on warnings alone, without `--max-warnings`), so CI treats that run as green
 * regardless of whether a PR quietly adds a new warning while fixing an old one - the raw warning
 * count can stay flat while the actual set of warnings shifts underneath it. This script tracks a
 * committed baseline of warning "fingerprints" and fails only when the CURRENT tree contains a
 * fingerprint that isn't in the baseline; fixing an existing warning (which only shrinks the
 * current set) is always fine and never blocks anything.
 *
 * A fingerprint is `{ ruleId, filePath, message, codeLine }` - deliberately EXCLUDING the line
 * NUMBER, so a line shifting elsewhere in a file (e.g. someone adds a blank line above an
 * untouched warning) never produces a false "new warning". `codeLine` (the warned line's own
 * trimmed source text) stands in for the line number instead of being dropped outright: without
 * it, a PR that removes one occurrence of a {rule, file, message} signature and introduces a
 * *different* occurrence of the exact same signature elsewhere in the same file would just
 * consume the removed one's slot in the multiset comparison below and pass silently - exactly the
 * warning-for-warning swap this gate exists to catch. This is a real, not hypothetical, case here:
 * the committed baseline has 16 identical `security/detect-object-injection` /
 * "Generic Object Injection Sink" entries for packages/tickets/src/attendees-export-pdf.ts alone.
 * Only ESLint messages with severity 1 (warning) are fingerprinted; severity 2 (error) already
 * fails `npm run lint`'s own exit code and needs no separate gate here.
 *
 * Uses ESLint's Node API (`new ESLint()` from the "eslint" devDependency) rather than shelling out
 * to the `eslint` CLI via `execFileSync`/`spawnSync` - it returns structured `LintResult[]` objects
 * directly, so there's no `--format json` output to parse, no extra child process, and no PATH
 * resolution question for locating an `eslint`/`npx` binary. It resolves this repo's flat
 * `eslint.config.js` the same way the CLI does, from the given `cwd`.
 *
 * Modes:
 *   generate  - lints the current tree and writes a fresh `.eslint-warning-baseline.json`.
 *   check     - lints the current tree and fails (exit 1) if it contains any warning fingerprint
 *               not present in the committed baseline. This is the default with no args.
 *
 * Usage:
 *   node scripts/eslint-warning-baseline.mjs [check|generate]
 */
import { ESLint } from "eslint";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const BASELINE_PATH = join(REPO_ROOT, ".eslint-warning-baseline.json");

/**
 * Reads the glob patterns `npm run lint` passes to eslint straight out of package.json's own
 * "lint" script, instead of hardcoding a copy that could drift out of sync with it. This repo's
 * script is a plain `eslint '<glob>' '<glob>' ...` with no flags - if that ever grows flags or
 * unquoted globs, extend this tokenizer rather than special-casing around it.
 */
function getLintGlobs() {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  const lintScript = pkg.scripts?.lint;
  if (!lintScript) {
    throw new Error('package.json has no "lint" script to read glob patterns from.');
  }

  const tokens = lintScript.match(/'[^']*'|"[^"]*"|\S+/g) ?? [];
  if (tokens[0] !== "eslint") {
    throw new Error(`Expected the "lint" script to start with "eslint", got: ${lintScript}`);
  }

  const globs = tokens
    .slice(1)
    .filter((tok) => !tok.startsWith("-"))
    .map((tok) => (/^(['"]).*\1$/.test(tok) ? tok.slice(1, -1) : tok));

  if (globs.length === 0) {
    throw new Error(`Could not extract any glob patterns from the "lint" script: ${lintScript}`);
  }
  return globs;
}

async function runEslint() {
  const globs = getLintGlobs();
  const eslint = new ESLint({ cwd: REPO_ROOT });
  return eslint.lintFiles(globs);
}

/**
 * Converts raw ESLint results into warning-only fingerprints (severity 1, no line number).
 * Reads each flagged file's own source once (not via ESLint's own `result.source`, which is only
 * populated in some configurations) to capture the warned line's trimmed text as `codeLine` - see
 * the module doc comment above for why a fingerprint needs this and not just {ruleId, filePath,
 * message}.
 */
function toFingerprints(results) {
  const fingerprints = [];
  for (const result of results) {
    const warnings = result.messages.filter((msg) => msg.severity === 1);
    if (warnings.length === 0) continue; // don't read files with nothing to fingerprint.

    const relPath = relative(REPO_ROOT, result.filePath).split(sep).join("/");
    const lines = readFileSync(result.filePath, "utf8").split("\n");
    for (const msg of warnings) {
      const codeLine = (lines[msg.line - 1] ?? "").trim();
      fingerprints.push({ ruleId: msg.ruleId, filePath: relPath, message: msg.message, codeLine });
    }
  }
  return fingerprints;
}

function fingerprintKey(fp) {
  return JSON.stringify([fp.ruleId, fp.filePath, fp.message, fp.codeLine]);
}

function sortFingerprints(fingerprints) {
  return [...fingerprints].sort((a, b) => {
    if (a.filePath !== b.filePath) return a.filePath < b.filePath ? -1 : 1;
    const aRule = a.ruleId ?? "";
    const bRule = b.ruleId ?? "";
    if (aRule !== bRule) return aRule < bRule ? -1 : 1;
    if (a.message !== b.message) return a.message < b.message ? -1 : 1;
    if (a.codeLine !== b.codeLine) return a.codeLine < b.codeLine ? -1 : 1;
    return 0;
  });
}

async function generate() {
  const results = await runEslint();
  const fingerprints = sortFingerprints(toFingerprints(results));
  writeFileSync(BASELINE_PATH, `${JSON.stringify(fingerprints, null, 2)}\n`);
  console.log(
    `Wrote ${fingerprints.length} ESLint warning fingerprint(s) to ${relative(REPO_ROOT, BASELINE_PATH)}`,
  );
}

async function check() {
  if (!existsSync(BASELINE_PATH)) {
    console.error(
      `Baseline file not found at ${relative(REPO_ROOT, BASELINE_PATH)}.`
      + ' Run "npm run lint:baseline:update" first and commit the result.',
    );
    process.exit(1);
  }

  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const current = sortFingerprints(toFingerprints(await runEslint()));

  // Multiset (count-based) comparison rather than a plain Set difference: two genuinely distinct
  // warned lines can still produce an identical fingerprint (same rule, message, AND code text -
  // e.g. two call sites in the same file both literally reading `obj[key]`). Counting occurrences
  // means a THIRD occurrence of a signature the baseline only saw twice is still correctly caught
  // as new.
  const remainingBaselineCounts = new Map();
  for (const fp of baseline) {
    const key = fingerprintKey(fp);
    remainingBaselineCounts.set(key, (remainingBaselineCounts.get(key) ?? 0) + 1);
  }

  const newWarnings = [];
  for (const fp of current) {
    const key = fingerprintKey(fp);
    const remaining = remainingBaselineCounts.get(key) ?? 0;
    if (remaining > 0) {
      remainingBaselineCounts.set(key, remaining - 1);
    } else {
      newWarnings.push(fp);
    }
  }

  if (newWarnings.length > 0) {
    console.error(`Found ${newWarnings.length} new ESLint warning(s) not present in the baseline:\n`);
    for (const fp of newWarnings) {
      console.error(`  ${fp.ruleId ?? "(no ruleId)"}  ${fp.filePath}`);
      console.error(`    ${fp.message}`);
      console.error(`    > ${fp.codeLine}\n`);
    }
    console.error(
      "If each of these is an expected, reviewed warning, run \"npm run lint:baseline:update\" to"
      + ` refresh ${relative(REPO_ROOT, BASELINE_PATH)} and commit the result. Otherwise, fix it.`,
    );
    process.exit(1);
  }

  console.log(`No new ESLint warnings (${baseline.length} baseline, ${current.length} current)`);
}

const mode = process.argv[2] ?? "check";
try {
  if (mode === "generate") {
    await generate();
  } else if (mode === "check") {
    await check();
  } else {
    throw new Error(`Unknown mode "${mode}". Usage: node scripts/eslint-warning-baseline.mjs [check|generate]`);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
