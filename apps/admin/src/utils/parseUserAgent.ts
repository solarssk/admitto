const BROWSER_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Edg\//, "Edge"],
  [/OPR\//, "Opera"],
  [/Chrome\//, "Chrome"],
  [/Firefox\//, "Firefox"],
  [/Safari\//, "Safari"],
];

const OS_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Windows/, "Windows"],
  [/Mac OS X/, "macOS"],
  [/Linux/, "Linux"],
  [/Android/, "Android"],
  [/iPhone|iPad/, "iOS"],
];

function matchFirstPattern(ua: string, patterns: ReadonlyArray<readonly [RegExp, string]>): string | null {
  for (const [pattern, label] of patterns) {
    if (pattern.test(ua)) return label;
  }
  return null;
}

/** Human-readable "Browser / OS" label from a stored request User-Agent string (e.g. a session
 * or login-history row) - unlike parseDeviceName.ts, which reads the current browser's own
 * navigator.userAgent for self-service device labeling. */
export function parseUserAgent(ua: string | null): string {
  if (!ua) return "Unknown";
  const browser = matchFirstPattern(ua, BROWSER_PATTERNS);
  const os = matchFirstPattern(ua, OS_PATTERNS);
  const parts = [browser, os].filter(Boolean);
  return parts.length ? parts.join(" / ") : ua.slice(0, 40);
}
