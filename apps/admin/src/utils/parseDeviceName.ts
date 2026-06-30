/** Extract a human-readable device name from navigator.userAgent. */
export function parseDeviceName(ua: string = typeof navigator !== "undefined" ? navigator.userAgent : ""): string {
  if (/iPad/i.test(ua)) {
    const match = ua.match(/iPad.*OS ([\d_]+)/);
    const version = match?.[1]?.replace(/_/g, ".") ?? "";
    return `iPad${version ? ` (iOS ${version})` : ""} · Safari`;
  }
  if (/iPhone/i.test(ua)) {
    const match = ua.match(/iPhone.*OS ([\d_]+)/);
    const version = match?.[1]?.replace(/_/g, ".") ?? "";
    return `iPhone${version ? ` (iOS ${version})` : ""}`;
  }
  if (/Android/i.test(ua)) {
    const match = ua.match(/Android ([\d.]+);?\s*([^;)]+)?/);
    const device = match?.[2]?.trim() ?? "Android";
    return device;
  }
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/Linux/i.test(ua)) return "Linux";
  return "";
}
