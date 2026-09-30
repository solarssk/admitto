import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

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
   * This button's own action is in flight. The button is disabled (so it cannot be double-fired),
   * gets `aria-busy`, and shows a spinner immediately, with no delay: the user just clicked, so
   * the reaction must be instant. Its width never changes. One flag per action: two buttons that
   * can run independently must not share one `loading` state.
   */
  loading?: boolean;
  /**
   * Label shown while `loading` ("Saving…", "Sending…", "Testing…"): the verb of this action,
   * never a generic "Working…". Optional. The button keeps the width of the longer of the two
   * labels, so switching never shifts the layout next to it.
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
      disabled={disabled || loading}
      aria-busy={loading || undefined}
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
