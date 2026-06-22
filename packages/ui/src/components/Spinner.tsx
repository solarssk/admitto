import type { HTMLAttributes } from "react";

export type SpinnerSize = "sm" | "md" | "lg";

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: SpinnerSize;
  label?: string;
}

export function Spinner({ size = "md", label = "Loading", className, ...rest }: SpinnerProps) {
  const cls = ["at-spinner", `at-spinner--${size}`, className].filter(Boolean).join(" ");
  return (
    <span className={cls} role="status" aria-label={label} {...rest}>
      <span className="at-spinner__ring" aria-hidden="true" />
    </span>
  );
}
