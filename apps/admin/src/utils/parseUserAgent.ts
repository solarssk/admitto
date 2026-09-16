// Order matters: a more specific browser's own identifier must be checked before a broader
// pattern that could also match its UA. Every iOS browser (Chrome, Firefox, Edge - each gets its
// own dedicated identifier since Apple requires them all to use WebKit under the hood) still ends
// with a trailing "Safari/build" WebKit tag, so the generic Safari checks must come last, or a
// Chrome/Firefox/Edge user on an iPhone gets mislabeled Safari. Android Chromium-based browsers
// (Samsung Internet, Edge) are the same problem one layer up: they still carry a "Chrome/x.y"
// token for site-compatibility sniffing alongside their own real identifier, so the same
// most-specific-first ordering applies there too, or they get mislabeled Chrome with Chrome's
// embedded engine version instead of their own. The optional capture group is each pattern's real
// version number where one exists.
const BROWSER_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/EdgiOS\/([\d.]+)/, "Edge"],
  [/EdgA\/([\d.]+)/, "Edge"],
  [/Edg\/([\d.]+)/, "Edge"],
  [/OPR\/([\d.]+)/, "Opera"],
  [/SamsungBrowser\/([\d.]+)/, "Samsung Internet"],
  [/CriOS\/([\d.]+)/, "Chrome"],
  [/Chrome\/([\d.]+)/, "Chrome"],
  [/FxiOS\/([\d.]+)/, "Firefox"],
  [/Firefox\/([\d.]+)/, "Firefox"],
  // By this point every other browser above (desktop and iOS) has already failed to match, so a
  // "Version/x.y" token left over only ever belongs to genuine Safari - no need to also require a
  // trailing "Safari/build" tag, which would need an unbounded `.*` scan between the two and was
  // flagged by SonarCloud for super-linear backtracking (S8786) on attacker-controlled input (this
  // parses a raw request User-Agent, e.g. WalletPass.user_agent).
  [/Version\/([\d.]+)/, "Safari"],
  [/Safari\//, "Safari"],
];

// Android UAs contain "Linux" and iPhone/iPad UAs contain "like Mac OS X" - the mobile-specific
// patterns must be checked first or a real device UA matches the generic desktop OS instead.
// Versions come dotted or underscored ("17_4") depending on where in the UA they appear -
// normalized to dots in matchPattern. The optional capture group is each pattern's real version
// number where one exists (Windows/Linux never expose a meaningful one here).
const OS_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Two entries per OS, not one combined optional-group/alternation regex: "iPhone;" and
  // "CPU iPhone OS 18_7" both appear in the same real UA, and a single /a|b/ (or an optional
  // group) resolves to whichever alternative starts at the leftmost string position ("iPhone;"
  // comes first, with no version) - checking the version-bearing pattern as its own entry first
  // means matchPattern tries it against the whole string before ever falling back to the bare,
  // versionless one. Also sidesteps eslint-plugin-security's detect-unsafe-regex false positive on
  // an optional group wrapping a character-class quantifier.
  [/Android ([\d.]+)/, "Android"],
  [/Android/, "Android"],
  [/CPU (?:iPhone )?OS ([\d_]+)/, "iOS"],
  [/iPhone|iPad/, "iOS"],
  [/Mac OS X ([\d_]+)/, "macOS"],
  [/Windows/, "Windows"],
  [/Linux/, "Linux"],
];

function matchPattern(
  ua: string,
  patterns: ReadonlyArray<readonly [RegExp, string]>,
  withVersion: boolean,
): string | null {
  for (const [pattern, label] of patterns) {
    const match = pattern.exec(ua);
    if (!match) continue;
    const version = match[1];
    return withVersion && version ? `${label} ${version.replaceAll("_", ".")}` : label;
  }
  return null;
}

/** Human-readable "Browser / OS" label from a stored request User-Agent string (e.g. a session
 * row) - unlike parseDeviceName.ts, which reads the current browser's own navigator.userAgent
 * for self-service device labeling. */
export function parseUserAgent(ua: string | null): string {
  if (!ua) return "Unknown";
  const browser = matchPattern(ua, BROWSER_PATTERNS, false);
  const os = matchPattern(ua, OS_PATTERNS, false);
  const parts = [browser, os].filter(Boolean);
  return parts.length ? parts.join(" / ") : ua.slice(0, 40);
}

/** Same as parseUserAgent, but with each side's version number when the UA carries one (e.g.
 * "Safari 18.7 / iOS 18.7") - for a context with room for the extra detail (the Wallet card's
 * "Added from" row), not the compact session-list table parseUserAgent was built for. Falls back
 * to the unversioned label for a browser/OS this can't extract a version from (e.g. Windows,
 * Linux). */
export function parseUserAgentWithVersion(ua: string | null): string {
  if (!ua) return "Unknown";
  const browser = matchPattern(ua, BROWSER_PATTERNS, true);
  const os = matchPattern(ua, OS_PATTERNS, true);
  const parts = [browser, os].filter(Boolean);
  return parts.length ? parts.join(" / ") : ua.slice(0, 40);
}
