import type { HTMLAttributes, ReactNode } from "react";

export type NoticeVariant = "info" | "success" | "warning" | "error";

const NOTICE_ICON: Record<NoticeVariant, string> = {
  info: "info-circle",
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
}

/** Bordered/tinted inline box with an icon, for a persistent fact or warning about the
 * surrounding view (e.g. "this data doesn't persist"). Not for a transient action outcome -
 * use Toast for that instead. `role` is left to the caller since it depends on context (a
 * static fact needs none; a warning the user should be told about typically wants
 * `role="alert"`). */
export function Notice({ variant, children, action, className, as: Tag = "p", ...rest }: Readonly<NoticeProps>) {
  const cls = ["at-notice", `at-notice--${variant}`, action ? "at-notice--has-action" : null, className]
    .filter(Boolean)
    .join(" ");
  return (
    <Tag className={cls} {...rest}>
      <i className={`ti ti-${NOTICE_ICON[variant]} at-notice__icon`} aria-hidden="true" />
      <span className="at-notice__body">{children}</span>
      {action ? <span className="at-notice__action">{action}</span> : null}
    </Tag>
  );
}
