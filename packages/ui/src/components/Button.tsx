import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  /** Adds a trailing chevron-down — use on any button that opens a menu/submenu, so it always reads as "has more options" the same way. Takes precedence over iconRight. */
  hasMenu?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  block = false,
  icon = null,
  iconRight = null,
  hasMenu = false,
  disabled = false,
  type = "button",
  children,
  className,
  ...rest
}: ButtonProps) {
  const cls = [
    "at-btn",
    `at-btn--${variant}`,
    size !== "md" && `at-btn--${size}`,
    block && "at-btn--block",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const trailingIcon = hasMenu ? <i className="ti ti-chevron-down" aria-hidden="true" /> : iconRight;

  return (
    <button type={type} className={cls} disabled={disabled} {...rest}>
      {icon && (
        <span className="at-btn__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {children && <span>{children}</span>}
      {trailingIcon && (
        <span className="at-btn__icon" aria-hidden="true">
          {trailingIcon}
        </span>
      )}
    </button>
  );
}
