import type { HTMLAttributes, ReactNode } from "react";
import type { BadgeVariant } from "../status-map.js";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  dot?: boolean;
  outline?: boolean;
  children?: ReactNode;
}

export function Badge({
  variant = "neutral",
  dot = false,
  outline = false,
  children,
  className,
  ...rest
}: BadgeProps) {
  const cls = ["at-badge", `at-badge--${variant}`, outline && "at-badge--outline", className]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={cls} {...rest}>
      {dot && <span className="at-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
