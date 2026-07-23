/** Extract a human-readable device name from navigator.userAgent. */
export function parseDeviceName(
  ua: string = typeof navigator !== "undefined" ? navigator.userAgent : "",
  /** Touch point count from `navigator.maxTouchPoints` (detects iPadOS desktop-class Safari). */
  maxTouchPoints: number = typeof navigator !== "undefined" ? navigator.maxTouchPoints : 0,
): string {
  // iPadOS desktop-class Safari reports Macintosh without "iPad" in the UA string.
  if (/Macintosh/i.test(ua) && maxTouchPoints > 1) {
    return "iPad · Safari";
  }
  if (/iPad/i.test(ua)) {
    const match = /iPad.*OS ([\d_]+)/.exec(ua);
    const version = match?.[1]?.replaceAll("_", ".") ?? "";
    const versionSuffix = version ? ` (iOS ${version})` : "";
    return `iPad${versionSuffix} · Safari`;
  }
  if (/iPhone/i.test(ua)) {
    const match = /iPhone.*OS ([\d_]+)/.exec(ua);
    const version = match?.[1]?.replaceAll("_", ".") ?? "";
    const versionSuffix = version ? ` (iOS ${version})` : "";
    return `iPhone${versionSuffix}`;
  }
  if (/Android/i.test(ua)) {
  // eslint-disable-next-line security/detect-unsafe-regex -- bounded input; validated pattern
    const match = /Android ([\d.]+);?\s*([^;)]+)?/.exec(ua);
    const device = match?.[2]?.trim() ?? "Android";
    return device;
  }
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/Linux/i.test(ua)) return "Linux";
  return "";
}
