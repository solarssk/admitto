import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success" | "warning";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  /** Adds a trailing chevron-down — use on any button that opens a menu/submenu, so it always reads as "has more options" the same way. Takes precedence over iconRight. */
  hasMenu?: boolean;
  /**
   * This button's own action is in flight. It gets `aria-busy` and `aria-disabled` (not `disabled`)
   * and shows a spinner immediately, with no delay: the user just clicked, so the reaction must be
   * instant. A click on it does nothing, so it cannot be double-fired. It stays focusable on purpose:
   * browsers drop the focus of a button that becomes `disabled`, so a keyboard user would lose their
   * place the moment they pressed it and not be back on it when the work ends. So while busy it is
   * never `disabled`, even when `disabled` is also set (callers often pass the same flag to both):
   * `disabled` takes effect again when the work ends. Its width never changes. One flag per action:
   * two buttons that can run independently must not share one `loading` state.
   */
  loading?: boolean;
  /**
   * Label shown while `loading` ("Sending…", "Testing…"): the verb of this action, never a generic
   * "Working…". Optional. The button keeps the width of the longer of the two labels, so switching
   * never shifts the layout next to it, which also means a busy label LONGER than the label at rest
   * ("Save" → "Saving…") makes the button that much wider all the time. Pass one only when it is
   * not longer; otherwise leave it out: the spinner replaces the icon, or covers the label when
   * there is no icon, and the button stays as wide as it is at rest.
   */
  loadingLabel?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    block = false,
    icon = null,
    iconRight = null,
    hasMenu = false,
    loading: loadingProp,
    loadingLabel,
    disabled = false,
    type = "button",
    children,
    className,
    onClick,
    ...rest
  },
  ref,
) {
  // `undefined` means the caller never opted into loading: those buttons render exactly as before.
  const loadingAware = loadingProp !== undefined;
  const loading = loadingProp === true;
  const hasLoadingLabel = Boolean(children) && loadingLabel !== undefined && loadingLabel !== null;
  // No icon slot to swap and no second label to show: the spinner overlays the (hidden) label.
  const overlaySpinner = loading && !icon && !hasLoadingLabel;
  const cls = [
    "at-btn",
    `at-btn--${variant}`,
    size !== "md" && `at-btn--${size}`,
    block && "at-btn--block",
    loading && "at-btn--loading",
    overlaySpinner && "at-btn--loading-solo",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  // What `disabled` used to do for a busy button, without losing its focus: the click (and Enter or Space,
  // which become one) is swallowed whole, so it neither runs the action again, nor submits a form it is
  // the submit button of, nor reaches a clickable ancestor.
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (loading) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  };

  const spinner = <span className="at-btn__spinner" aria-hidden="true" />;
  const trailingIcon = hasMenu ? <i className="ti ti-chevron-down" aria-hidden="true" /> : iconRight;

  let label: ReactNode = null;
  if (hasLoadingLabel) {
    // Both labels stay in the layout (stacked in one grid cell) so the width is the wider one;
    // only the active one is exposed to assistive tech.
    label = (
      <span className="at-btn__label">
        <span className="at-btn__label-idle" aria-hidden={loading}>
          {children}
        </span>
        <span className="at-btn__label-busy" aria-hidden={!loading}>
          {icon ? null : spinner}
          {loadingLabel}
        </span>
      </span>
    );
  } else if (children) {
    label = <span>{children}</span>;
  }

  return (
    <button
      ref={ref}
      type={type}
      className={cls}
      disabled={disabled && !loading}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      onClick={handleClick}
      {...rest}
    >
      {icon && (
        <span className={loadingAware ? "at-btn__icon at-btn__icon--swap" : "at-btn__icon"} aria-hidden="true">
          {loadingAware ? (
            // Icon and spinner share one grid cell, so the slot is always as wide as the larger of
            // the two and toggling `loading` never moves the label.
            <>
              <span className="at-btn__icon-face">{icon}</span>
              {spinner}
            </>
          ) : (
            icon
          )}
        </span>
      )}
      {label}
      {overlaySpinner && <span className="at-btn__spinner at-btn__spinner--overlay" aria-hidden="true" />}
      {trailingIcon && (
        <span className="at-btn__icon" aria-hidden="true">
          {trailingIcon}
        </span>
      )}
    </button>
  );
});
