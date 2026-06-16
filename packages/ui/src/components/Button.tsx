import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  block = false,
  icon = null,
  iconRight = null,
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

  return (
    <button type={type} className={cls} disabled={disabled} {...rest}>
      {icon && (
        <span className="at-btn__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {children && <span>{children}</span>}
      {iconRight && (
        <span className="at-btn__icon" aria-hidden="true">
          {iconRight}
        </span>
      )}
    </button>
  );
}
