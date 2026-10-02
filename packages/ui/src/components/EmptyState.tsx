import type { ReactNode } from "react";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  /** Text, or an element when the text must be mounted afresh (a `key`) so a live region says it again. */
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  /**
   * "error" for a load that failed (usually with a Retry as the `action`): announced at once by assistive
   * tech (`role="alert"`) instead of politely, and the same wherever a failed load is shown. The look is
   * the same. Default is a plain empty list ("No attendees yet"), which is only a status.
   */
  variant?: "default" | "error";
}

/** Centered empty-list placeholder with optional icon, description, and action slot. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  variant = "default",
}: Readonly<EmptyStateProps>) {
  const cls = ["at-empty-state", className].filter(Boolean).join(" ");
  const content = (
    <>
      {icon && (
        <div className="at-empty-state__icon" aria-hidden="true">
          {icon}
        </div>
      )}
      <p className="at-empty-state__title">{title}</p>
      {description && <p className="at-empty-state__desc">{description}</p>}
      {action && <div className="at-empty-state__action">{action}</div>}
    </>
  );
  // An <output> is a status (polite); a failed load must be heard, so it is an alert instead.
  if (variant === "error") {
    return (
      <div className={cls} role="alert">
        {content}
      </div>
    );
  }
  return <output className={cls}>{content}</output>;
}
