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
  /** "output" for a value derived from the surrounding form/state (mirrors Toast's own
   * success/info tag choice); "p" (default) for a standalone fact or warning. */
  as?: "p" | "output";
}

/** Bordered/tinted inline box with an icon, for a persistent fact or warning about the
 * surrounding view (e.g. "this data doesn't persist"). Not for a transient action outcome -
 * use Toast for that instead. `role` is left to the caller since it depends on context (a
 * static fact needs none; a warning the user should be told about typically wants
 * `role="alert"`). */
export function Notice({ variant, children, className, as: Tag = "p", ...rest }: Readonly<NoticeProps>) {
  const cls = ["at-notice", `at-notice--${variant}`, className].filter(Boolean).join(" ");
  return (
    <Tag className={cls} {...rest}>
      <i className={`ti ti-${NOTICE_ICON[variant]} at-notice__icon`} aria-hidden="true" />
      <span>{children}</span>
    </Tag>
  );
}
