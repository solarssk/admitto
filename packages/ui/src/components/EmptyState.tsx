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
   * tech (`role="alert"`) instead of politely, and drawn the same wherever a failed load is shown: with the
   * glyph an error has everywhere else (`circle-x`, as in `Notice` and `Toast`) in the error colour, unless
   * an `icon` is given. Default is a plain empty list ("No attendees yet"), which is only a status.
   */
  variant?: "default" | "error";
}

/** The glyph of a failed load: the one `Notice` and `Toast` give an error, so a failure looks like a failure wherever it is drawn. */
const ERROR_ICON = <i className="ti ti-circle-x" aria-hidden="true" />;

/** Centered empty-list placeholder with optional icon, description, and action slot. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  variant = "default",
}: Readonly<EmptyStateProps>) {
  const cls = ["at-empty-state", variant === "error" ? "at-empty-state--error" : null, className].filter(Boolean).join(" ");
  // An icon that is given wins (also `null`, for none); only an error that is given none gets the standard one.
  const shownIcon = icon === undefined && variant === "error" ? ERROR_ICON : icon;
  const content = (
    <>
      {shownIcon && (
        <div className="at-empty-state__icon" aria-hidden="true">
          {shownIcon}
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
