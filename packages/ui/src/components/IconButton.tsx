import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";

export type IconButtonSize = "sm" | "md";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
  size?: IconButtonSize;
  /**
   * This button's own action is in flight: the same contract as `<Button loading>`. A spinner takes the
   * icon's place at once (the button has a fixed size, so nothing moves), it gets `aria-busy` and
   * `aria-disabled` (not `disabled`) and a click does nothing. It stays focusable on purpose: a browser
   * drops the focus of a button that becomes `disabled`, so a keyboard user would lose their place the
   * moment they pressed it. While busy it is never `disabled`, even when `disabled` is also set; that
   * applies again when the work ends.
   */
  loading?: boolean;
  /**
   * The accessible name while `loading`, the verb of this action ("Marking…"), as `Button`'s `loadingLabel`:
   * there is no visible text to swap, so this is what assistive tech hears for the wait. Defaults to `label`.
   */
  loadingLabel?: string;
}

export function IconButton({
  icon,
  size = "md",
  label,
  className,
  loading: loadingProp,
  loadingLabel,
  disabled = false,
  onClick,
  ...rest
}: Readonly<IconButtonProps>) {
  const loading = loadingProp === true;
  const cls = ["at-iconbtn", size !== "md" && `at-iconbtn--${size}`, className].filter(Boolean).join(" ");
  // What `disabled` used to do for a busy button, without losing its focus: the click is swallowed whole, so it
  // neither runs the action again nor reaches a clickable parent.
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (loading) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  };
  return (
    <button
      type="button"
      className={cls}
      aria-label={loading && loadingLabel ? loadingLabel : label}
      disabled={disabled && !loading}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      onClick={handleClick}
      {...rest}
    >
      {loading ? <span className="at-iconbtn__spinner" aria-hidden="true" /> : icon}
    </button>
  );
}
