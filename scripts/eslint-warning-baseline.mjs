#!/usr/bin/env node
/**
 * ESLint new-warning gate.
 *
 * `npm run lint` currently reports a non-zero number of warnings (ESLint's default behavior never
 * fails a run on warnings alone, without `--max-warnings`), so CI treats that run as green
 * regardless of whether a PR quietly adds a new warning while fixing an old one - the raw warning
 * count can stay flat while the actual set of warnings shifts underneath it. This script tracks a
 * committed baseline of warning "fingerprints" and requires the CURRENT tree to match it exactly:
 * every current warning must have a baseline entry, and every baseline entry must still match a
 * current warning. Fixing a warning and adding a new (reviewed) one both require the same one
 * step - `npm run lint:baseline:update` - to re-sync the baseline; neither is free, on purpose
 * (see the "stale entries" paragraph below for why fixing used to be free and no longer is).
 *
 * A fingerprint is `{ ruleId, filePath, message, codeLine, column, contextBefore, contextAfter }` -
 * deliberately EXCLUDING the line NUMBER, so a line shifting elsewhere in a file (e.g. someone
 * adds a blank line above an untouched warning) never produces a false "new warning". `codeLine`
 * (the warned line's own trimmed source text) stands in for the line number instead of being
 * dropped outright: without it, a PR that removes one occurrence of a {rule, file, message}
 * signature and introduces a *different* occurrence of the exact same signature elsewhere in the
 * same file would just consume the removed one's slot in the multiset comparison below and pass
 * silently - exactly the warning-for-warning swap this gate exists to catch. This is a real, not
 * hypothetical, case here: the committed baseline has 16 identical
 * `security/detect-object-injection` / "Generic Object Injection Sink" entries for
 * packages/tickets/src/attendees-export-pdf.ts alone.
 *
 * `codeLine` alone is not enough, though: two of those 16 entries can also share the exact same
 * trimmed line text (e.g. a common `obj[key]` idiom repeated verbatim), which lets the same
 * warning-for-warning swap happen *within* an already-duplicated signature - remove one, introduce
 * a different one elsewhere with an identical line, and the multiset still just sees "same count".
 * `contextBefore`/`contextAfter` (the immediately adjacent lines' own trimmed text) break most of
 * that remaining tie: they change only when code next to the warning actually changes, not when
 * anything elsewhere in the file shifts, so they keep the line-number-independence property above
 * while still telling apart two textually-identical warned lines living in different code.
 *
 * `column` closes the last gap context can't: five signatures in that same file still collide even
 * WITH context, because they're not actually two different call sites at all - they're a single
 * line with two separate object-injection expressions (e.g.
 * `doc.text(cells[i] ?? "", x, y, cellOptions(plan.contentWidths[i]!, rowHeight))` flags both
 * `cells[i]` and `plan.contentWidths[i]`), which ESLint reports as two messages sharing one `line`
 * but different `column`s. Column, like codeLine/context, is purely a property of that one line's
 * own content - unaffected by anything shifting elsewhere in the file - so it keeps the same
 * independence property while finally telling these apart.
 *
 * Stale entries: a baseline is committed at some point and never *required* to shrink again on its
 * own - if `check` only looked for new warnings, fixing one without regenerating the baseline
 * would leave its old fingerprint sitting there unconsumed, and a LATER, unrelated PR could
 * reintroduce that exact warning at the same source context and have it silently match the stale
 * entry - a genuine "fixed warning comes back unnoticed" gap, not hypothetical: nothing about the
 * multiset comparison distinguishes "still present" from "removed and never cleaned up". `check`
 * therefore fails on unconsumed baseline entries too, not just unmatched current ones - the
 * baseline must be an exact mirror of the current warning set, not a ceiling it can safely drift
 * below.
 *
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
 *   check     - lints the current tree and fails (exit 1) unless it matches the committed baseline
 *               exactly (no new fingerprints, no stale ones left over). This is the default with
 *               no args.
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
export function getLintGlobs() {
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
 * populated in some configurations) to capture the warned line's own trimmed text plus its
 * immediate neighbors - see the module doc comment above for why a fingerprint needs all of these
 * fields and not just {ruleId, filePath, message}.
 */
export function toFingerprints(results) {
  const fingerprints = [];
  for (const result of results) {
    const warnings = result.messages.filter((msg) => msg.severity === 1);
    if (warnings.length === 0) continue; // don't read files with nothing to fingerprint.

    const relPath = relative(REPO_ROOT, result.filePath).split(sep).join("/");
    const lines = readFileSync(result.filePath, "utf8").split("\n");
    for (const msg of warnings) {
      const codeLine = (lines[msg.line - 1] ?? "").trim();
      const contextBefore = (lines[msg.line - 2] ?? "").trim();
      const contextAfter = (lines[msg.line] ?? "").trim();
      fingerprints.push({
        ruleId: msg.ruleId,
        filePath: relPath,
        message: msg.message,
        codeLine,
        column: msg.column,
        contextBefore,
        contextAfter,
      });
    }
  }
  return fingerprints;
}

export function fingerprintKey(fp) {
  return JSON.stringify([
    fp.ruleId,
    fp.filePath,
    fp.message,
    fp.codeLine,
    fp.column,
    fp.contextBefore,
    fp.contextAfter,
  ]);
}

const SORT_FIELDS = ["filePath", "ruleId", "message", "codeLine", "column", "contextBefore", "contextAfter"];

export function sortFingerprints(fingerprints) {
  return [...fingerprints].sort((a, b) => {
    for (const field of SORT_FIELDS) {
      const av = a[field] ?? "";
      const bv = b[field] ?? "";
      if (av !== bv) return av < bv ? -1 : 1;
    }
    return 0;
  });
}

/**
 * Multiset (count-based), bidirectional comparison: two genuinely distinct warned lines can still
 * produce an identical fingerprint (same rule, message, code text, column, AND surrounding context
 * - e.g. a repeated boilerplate block), so occurrences are counted rather than just checked for
 * presence - a THIRD occurrence of a signature the baseline only saw twice is still correctly
 * caught as new. Returns `{ newWarnings, staleWarnings }`: current fingerprints with no matching
 * baseline slot left (new, unreviewed), and baseline fingerprints with no matching current slot
 * (stale - the warning they describe no longer exists, and leaving them in place would let an
 * unrelated later PR reintroduce that exact warning unnoticed).
 */
export function diffFingerprints(baseline, current) {
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

  const staleWarnings = baseline.filter((fp) => (remainingBaselineCounts.get(fingerprintKey(fp)) ?? 0) > 0);
  // Each stale key should only be reported once, not once per remaining count.
  const seenStaleKeys = new Set();
  const dedupedStale = staleWarnings.filter((fp) => {
    const key = fingerprintKey(fp);
    if (seenStaleKeys.has(key)) return false;
    seenStaleKeys.add(key);
    return true;
  });

  return { newWarnings, staleWarnings: dedupedStale };
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
  const { newWarnings, staleWarnings } = diffFingerprints(baseline, current);

  if (newWarnings.length > 0) {
    console.error(`Found ${newWarnings.length} new ESLint warning(s) not present in the baseline:\n`);
    for (const fp of newWarnings) {
      console.error(`  ${fp.ruleId ?? "(no ruleId)"}  ${fp.filePath}`);
      console.error(`    ${fp.message}`);
      console.error(`    > ${fp.codeLine}\n`);
    }
  }

  if (staleWarnings.length > 0) {
    console.error(
      `Found ${staleWarnings.length} baseline entr${staleWarnings.length === 1 ? "y" : "ies"} `
      + "that no longer match any current warning (already fixed, but the baseline wasn't refreshed):\n",
    );
    for (const fp of staleWarnings) {
      console.error(`  ${fp.ruleId ?? "(no ruleId)"}  ${fp.filePath}`);
      console.error(`    ${fp.message}`);
      console.error(`    > ${fp.codeLine}\n`);
    }
  }

  if (newWarnings.length > 0 || staleWarnings.length > 0) {
    console.error(
      `Run "npm run lint:baseline:update" to refresh ${relative(REPO_ROOT, BASELINE_PATH)} and`
      + " commit the result - review any new warnings first; a stale entry alone just needs the refresh.",
    );
    process.exit(1);
  }

  console.log(`No new or stale ESLint warnings (${baseline.length} baseline, ${current.length} current)`);
}

// Only run the CLI when this file is executed directly (`node scripts/eslint-warning-baseline.mjs
// ...`), not when imported - scripts/eslint-warning-baseline.test.mjs imports the pure functions
// above to test them without linting the whole repo or calling process.exit().
if (import.meta.url === `file://${process.argv[1]}`) {
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
}
