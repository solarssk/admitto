const BROWSER_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Edg\//, "Edge"],
  [/OPR\//, "Opera"],
  [/Chrome\//, "Chrome"],
  [/Firefox\//, "Firefox"],
  [/Safari\//, "Safari"],
];

// Android UAs contain "Linux" and iPhone/iPad UAs contain "like Mac OS X" - the mobile-specific
// patterns must be checked first or a real device UA matches the generic desktop OS instead.
const OS_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Android/, "Android"],
  [/iPhone|iPad/, "iOS"],
  [/Windows/, "Windows"],
  [/Mac OS X/, "macOS"],
  [/Linux/, "Linux"],
];

function matchFirstPattern(ua: string, patterns: ReadonlyArray<readonly [RegExp, string]>): string | null {
  for (const [pattern, label] of patterns) {
    if (pattern.test(ua)) return label;
  }
  return null;
}

/** Human-readable "Browser / OS" label from a stored request User-Agent string (e.g. a session
 * row) - unlike parseDeviceName.ts, which reads the current browser's own navigator.userAgent
 * for self-service device labeling. */
export function parseUserAgent(ua: string | null): string {
  if (!ua) return "Unknown";
  const browser = matchFirstPattern(ua, BROWSER_PATTERNS);
  const os = matchFirstPattern(ua, OS_PATTERNS);
  const parts = [browser, os].filter(Boolean);
  return parts.length ? parts.join(" / ") : ua.slice(0, 40);
}

// Safari's own release version rides in "Version/x.y", not the "Safari/build" WebKit tag next to
// it - must be checked last, after the other Chromium/Gecko browsers, since their UAs also carry
// a trailing "Safari/build" token.
const BROWSER_VERSION_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Edg\/([\d.]+)/, "Edge"],
  [/OPR\/([\d.]+)/, "Opera"],
  [/Chrome\/([\d.]+)/, "Chrome"],
  [/Firefox\/([\d.]+)/, "Firefox"],
  [/Version\/([\d.]+).*Safari\//, "Safari"],
];

// Same mobile-first precedence as OS_PATTERNS. iOS/Android/macOS versions come dotted or
// underscored ("17_4") depending on where in the UA they appear - normalized to dots.
const OS_VERSION_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Android ([\d.]+)/, "Android"],
  [/CPU (?:iPhone )?OS ([\d_]+)/, "iOS"],
  [/Mac OS X ([\d_]+)/, "macOS"],
];

function matchWithVersion(ua: string, patterns: ReadonlyArray<readonly [RegExp, string]>): string | null {
  for (const [pattern, label] of patterns) {
    const version = pattern.exec(ua)?.[1];
    if (version) return `${label} ${version.replace(/_/g, ".")}`;
  }
  return null;
}

/** Same as parseUserAgent, but with each side's version number when the UA carries one (e.g.
 * "Safari 18.7 / iOS 18.7") - for a context with room for the extra detail (the Wallet card's
 * Device row), not the compact session-list table parseUserAgent was built for. Falls back to the
 * unversioned label for a browser/OS this can't extract a version from (e.g. Windows, Linux). */
export function parseUserAgentWithVersion(ua: string | null): string {
  if (!ua) return "Unknown";
  const browser = matchWithVersion(ua, BROWSER_VERSION_PATTERNS) ?? matchFirstPattern(ua, BROWSER_PATTERNS);
  const os = matchWithVersion(ua, OS_VERSION_PATTERNS) ?? matchFirstPattern(ua, OS_PATTERNS);
  const parts = [browser, os].filter(Boolean);
  return parts.length ? parts.join(" / ") : ua.slice(0, 40);
}
