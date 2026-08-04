/**
 * Server-rendered Notice markup matching React `Notice` in `@admitto/ui`
 * (same classes/DOM: `.at-notice`, icon, body). Auth pages are HTML strings, not React.
 */

export type AuthNoticeVariant = "info" | "highlight" | "success" | "warning" | "error";

const NOTICE_ICON: Record<AuthNoticeVariant, string> = {
  info: "info-circle",
  highlight: "info-circle",
  success: "circle-check",
  warning: "alert-triangle",
  error: "circle-x",
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
  /** Overrides the variant default Tabler icon name (without `ti-` prefix). */
  icon?: string;
  /** Extra classes (e.g. spacing). */
  className?: string;
  /** Element tag; default `p` like React Notice. */
  as?: "p" | "output";
}

/** Emit Notice-equivalent HTML for auth / OIDC SSR pages. */
export function renderNoticeHtml(options: RenderNoticeHtmlOptions): string {
  const {
    variant,
    message,
    role,
    icon,
    className,
    as: tag = "p",
  } = options;
  const cls = ["at-notice", `at-notice--${variant}`, className].filter(Boolean).join(" ");
  const roleAttr = role ? ` role="${escapeHtml(role)}"` : "";
  const iconName = icon ?? NOTICE_ICON[variant];
  return `<${tag} class="${cls}"${roleAttr}><i class="ti ti-${escapeHtml(iconName)} at-notice__icon" aria-hidden="true"></i><span class="at-notice__body">${escapeHtml(message)}</span></${tag}>`;
}
