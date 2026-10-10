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
   * Label for the busy state ("Sending…", "Testing…"): the verb of this action, never a generic
   * "Working…". Optional. On a button with an icon it is shown in place of the label, and the button
   * keeps the width of the longer of the two, so a busy label LONGER than the label at rest
   * ("Save" → "Saving…") makes the button that much wider all the time: pass one only when it is
   * not longer. On a button without an icon the spinner covers the label and the busy label is only
   * what assistive tech hears, so it never changes the width.
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
    "aria-disabled": ariaDisabled,
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
  // A button that is off at the end of its range (a pager's Previous on page 1) passes `aria-disabled` instead of
  // `disabled` to keep its focus, and is treated like a busy one: same attribute, same swallowed click. It is taken
  // out of `rest` so that spreading it last can never replace the attribute a busy button has just been given.
  const inert = loading || ariaDisabled === true || ariaDisabled === "true";
  const hasLoadingLabel = Boolean(children) && loadingLabel !== undefined && loadingLabel !== null;
  // No icon slot to swap: the spinner overlays the hidden label. A `loadingLabel` of such a button is only what assistive tech
  // hears: showing it beside a spinner would have to reserve room for both all the time, and "Export log" was a third wider
  // than its text for that.
  const overlaySpinner = loading && !icon;
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
    if (inert) {
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
      <span className={icon ? "at-btn__label" : "at-btn__label at-btn__label--text"}>
        <span className="at-btn__label-idle" aria-hidden={loading}>
          {children}
        </span>
        <span className="at-btn__label-busy" aria-hidden={!loading}>
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
      aria-disabled={inert || undefined}
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
