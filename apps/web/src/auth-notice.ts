/**
 * Server-rendered Notice markup matching React `Notice` in `@admitto/ui`
 * (same classes/DOM: `.at-notice`, icon, body). Auth pages are HTML strings, not React.
 *
 * Icons are inline SVG (same stroke style as `AUTH_SSO_BUTTON_ICON_SVG`) so auth pages
 * do not pull the full Tabler webfont CSS + font on the critical sign-in path.
 */

export type AuthNoticeVariant = "info" | "highlight" | "success" | "warning" | "error";

/** Tabler-outline equivalents, 24×24, `currentColor`, aria-hidden. */
const NOTICE_ICON_SVG: Record<AuthNoticeVariant, string> = {
  info: `<svg class="at-notice__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" /><path d="M12 9h.01" /><path d="M11 12h1v4h1" /></svg>`,
  highlight: `<svg class="at-notice__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" /><path d="M12 9h.01" /><path d="M11 12h1v4h1" /></svg>`,
  success: `<svg class="at-notice__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" /><path d="M9 12l2 2l4 -4" /></svg>`,
  warning: `<svg class="at-notice__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 9v4" /><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z" /><path d="M12 16h.01" /></svg>`,
  error: `<svg class="at-notice__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" /><path d="M10 10l4 4m0 -4l-4 4" /></svg>`,
};

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export interface RenderNoticeHtmlOptions {
  variant: AuthNoticeVariant;
  /** Plain-text body (escaped). */
  message: string;
  /** Typically `alert` for error/warning notices. */
  role?: string;
  /** Extra classes (e.g. spacing). */
  className?: string;
  /** Element tag; default `p` like React Notice. */
  as?: "p" | "output";
}

/** Emit Notice-equivalent HTML for auth / OIDC SSR pages. */
export function renderNoticeHtml(options: RenderNoticeHtmlOptions): string {
  const { variant, message, role, className, as: tag = "p" } = options;
  const cls = ["at-notice", `at-notice--${variant}`, className].filter(Boolean).join(" ");
  const roleAttr = role ? ` role="${escapeHtml(role)}"` : "";
  return `<${tag} class="${cls}"${roleAttr}>${NOTICE_ICON_SVG[variant]}<span class="at-notice__body">${escapeHtml(message)}</span></${tag}>`;
}
