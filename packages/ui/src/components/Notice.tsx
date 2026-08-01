import type { HTMLAttributes, ReactNode } from "react";

/** "info" is a deliberately neutral/gray "permanent fact" tone (see the CSS). "highlight" is the
 * genuinely blue tone (shares the `--status-info*` tokens already used by `.at-badge--info` /
 * `.status-circle--info`) for a callout that should actually catch the eye, e.g. a privacy note
 * above sensitive content - use it instead of hand-rolling a one-off blue box. */
export type NoticeVariant = "info" | "highlight" | "success" | "warning" | "error";

const NOTICE_ICON: Record<NoticeVariant, string> = {
  info: "info-circle",
  highlight: "info-circle",
  success: "circle-check",
  warning: "alert-triangle",
  error: "circle-x",
};

export interface NoticeProps extends HTMLAttributes<HTMLElement> {
  variant: NoticeVariant;
  children: ReactNode;
  /** A trailing control (e.g. a "Retry" button) that stays a separate, non-shrinking flex
   * item at the notice's edge instead of being absorbed into the wrapped body text - use
   * this instead of putting a button directly in `children`. */
  action?: ReactNode;
  /** "output" for a value derived from the surrounding form/state (mirrors Toast's own
   * success/info tag choice); "p" (default) for a standalone fact or warning. */
  as?: "p" | "output";
  /** Overrides the variant's default Tabler icon name (without the `ti-` prefix), for a
   * domain-specific icon (e.g. "qrcode-off" for a QR-redaction notice) instead of the generic
   * one implied by the variant. */
  icon?: string;
}

/** Bordered/tinted inline box with an icon, for a persistent fact or warning about the
 * surrounding view (e.g. "this data doesn't persist"). Not for a transient action outcome -
 * use Toast for that instead. `role` is left to the caller since it depends on context (a
 * static fact needs none; a warning the user should be told about typically wants
 * `role="alert"`). */
export function Notice({
  variant,
  children,
  action,
  className,
  as: Tag = "p",
  icon,
  ...rest
}: Readonly<NoticeProps>) {
  const cls = ["at-notice", `at-notice--${variant}`, action ? "at-notice--has-action" : null, className]
    .filter(Boolean)
    .join(" ");
  return (
    <Tag className={cls} {...rest}>
      <i className={`ti ti-${icon ?? NOTICE_ICON[variant]} at-notice__icon`} aria-hidden="true" />
      <span className="at-notice__body">{children}</span>
      {action ? <span className="at-notice__action">{action}</span> : null}
    </Tag>
  );
}
