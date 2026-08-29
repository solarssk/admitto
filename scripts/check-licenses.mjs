#!/usr/bin/env node
/**
 * License-compliance check for the resolved npm dependency tree.
 *
 * Runs license-checker (a pinned version, via `npx`, deliberately NOT a project devDependency -
 * see the comment above PINNED_VERSION) against every workspace's node_modules and reports any
 * third-party package whose license isn't on the ALLOWLIST below. Admitto is redistributed as a
 * self-hostable product, so an incompatible-license dependency is a real distribution risk, not
 * a hypothetical one.
 *
 * This check is currently report-only (see ci.yml: `continue-on-error: true` on this step) - it
 * always prints a full report but only exits non-zero (which the workflow does not treat as a
 * failure yet) when something outside the allowlist is found. Flip that off once the flagged
 * packages below have had a human look and the report has run clean for a while.
 *
 * Usage:
 *   node scripts/check-licenses.mjs
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

// Resolve npx by absolute path instead of letting the OS search PATH for a bare "npx" -
// SonarCloud javascript:S4036 (CWE-88 untrusted search path): a PATH entry earlier than the
// real npx that's writable by something less trusted than this CI job could substitute a
// malicious binary. The official Node.js distribution (what actions/setup-node installs, and
// what every local install used for this repo bundles) always ships npx as a sibling of the
// running node executable, so this needs no separate lookup or dependency.
const NPX_PATH = join(dirname(process.execPath), "npx");

// license-checker itself is intentionally NOT a project devDependency: this repo's root
// `overrides.brace-expansion` (needed by the modern glob/minimatch used elsewhere) breaks
// license-checker's own bundled legacy `glob@7` -> `minimatch@3` chain when it's hoisted into
// this project's node_modules and inherits that override ("TypeError: expand is not a function").
// Running it through `npx` gives it an isolated dependency tree instead. Pinned exact version so
// CI doesn't silently pick up a different license-checker release (and thus a different report)
// between runs.
//
// `--ignore-scripts` is passed to npx itself (before the positional package, so it's consumed as
// npm-exec's own config flag rather than forwarded to license-checker) - this repo's `npm ci`
// steps already run with `--ignore-scripts` as supply-chain hardening, and npx's on-demand
// install of an absent package does not inherit that by default: without it, a cold runner would
// let license-checker's (or an unpinned transitive dependency's) lifecycle scripts execute during
// PR CI. license-checker itself needs no install-time script to run correctly, so this has no
// functional effect on the tool - only on whether its dependency tree's scripts get to run.
const PINNED_VERSION = "25.0.1";

// Standard OSI-recognized permissive licenses actually present in this repo's dependency tree
// (verified with `npx --yes license-checker@25.0.1 --excludePrivatePackages --summary`, 978
// third-party packages as of the PR that added this check). Anything not listed here - including
// every copyleft license (GPL/AGPL/LGPL/MPL/EPL) and any "SEE LICENSE IN LICENSE"/custom license -
// is intentionally left off so it surfaces in the report below for manual review, rather than
// being silently allowed.
const ALLOWLIST = new Set([
  "MIT",
  "ISC",
  "Apache-2.0",
  "BSD-3-Clause",
  "BSD-2-Clause",
  "BlueOak-1.0.0",
  "Unlicense",
  "OFL-1.1", // SIL Open Font License - bundled @fontsource/* text fonts.
  "MIT-0",
  "CC0-1.0",
  "0BSD",
  "CC-BY-4.0", // Attribution-only; caniuse-lite's browser data.
  "Python-2.0", // Python Software Foundation License - permissive despite the name; argparse.
  // license-checker appends "*" when it guessed the license from LICENSE file text rather than
  // an explicit package.json field. Verified-permissive in every case found in this tree.
  "MIT*",
  "ISC*",
  // Both halves of this compound license are themselves permissive (Zlib is BSD/MIT-equivalent),
  // so unlike an "X OR <copyleft>" expression there is no compliance choice to make here.
  "(MIT AND Zlib)",
]);

let raw;
try {
  raw = execFileSync(
    NPX_PATH,
    ["--yes", "--ignore-scripts", `license-checker@${PINNED_VERSION}`, "--excludePrivatePackages", "--json"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
} catch (err) {
  console.error("license check: failed to run license-checker.");
  console.error(err.message);
  process.exit(1);
}

const packages = JSON.parse(raw);
const entries = Object.entries(packages);
const flagged = entries.filter(([, info]) => !ALLOWLIST.has(info.licenses));

console.log(`license check: scanned ${entries.length} third-party package(s).`);
console.log(`license check: ${entries.length - flagged.length} allowed, ${flagged.length} flagged.`);

if (flagged.length > 0) {
  console.log("\nFlagged (license not on the allowlist - needs human review):");
  const sortedFlagged = flagged.toSorted(([a], [b]) => a.localeCompare(b));
  for (const [pkg, info] of sortedFlagged) {
    console.log(`  - ${pkg}: ${info.licenses} (${info.repository ?? "no repository listed"})`);
  }
  console.log(
    "\nThis does not mean these packages are forbidden - it means nobody has confirmed they're"
    + " fine yet. Add a license string to ALLOWLIST in this script only after reviewing it.",
  );
  process.exit(1);
}

console.log("\nAll scanned packages are on the allowlist.");
