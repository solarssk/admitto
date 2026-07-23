import type { HTMLAttributes } from "react";

export type SpinnerSize = "sm" | "md" | "lg";

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: SpinnerSize;
  label?: string;
}

/** Inline loading indicator with size variants and an accessible status label. */
export function Spinner({
  size = "md",
  label = "Loading",
  className,
  ...rest
}: Readonly<SpinnerProps>) {
  const cls = ["at-spinner", `at-spinner--${size}`, className].filter(Boolean).join(" ");
  return (
    <output className={cls} aria-label={label} {...rest}>
      <span className="at-spinner__ring" aria-hidden="true" />
    </output>
  );
}
