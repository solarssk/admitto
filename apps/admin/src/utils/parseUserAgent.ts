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
