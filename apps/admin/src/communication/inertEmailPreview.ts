/** `sandbox=""` on a preview iframe blocks top-level navigation and popups, but not the iframe
 * navigating *itself* - a plain `<a href="...">` click still loads that URL inside the iframe.
 * For a real sent-message preview that URL is the recipient's actual ticket link, so it points
 * back at this app's own origin, which sets `frame-ancestors 'none'` and refuses to render nested
 * - a broken "refused to connect" sub-frame, not a harmless no-op. Disabling pointer-events on
 * every link/QR image is a no-scripting way to keep preview content non-interactive regardless of
 * what URL it points to. */
const INERT_LINKS_STYLE = "<style>a,area{pointer-events:none;cursor:default;}</style>";

export function makeEmailPreviewInert(html: string): string {
  return INERT_LINKS_STYLE + html;
}
