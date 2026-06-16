import type { ReactNode, SelectHTMLAttributes } from "react";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  children?: ReactNode;
}

export function Select({ label, hint, id, children, className, ...rest }: SelectProps) {
  const autoId = id || (label ? `f-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  return (
    <div className="at-field">
      {label && (
        <label className="at-label" htmlFor={autoId}>
          {label}
        </label>
      )}
      <select id={autoId} className={["at-select", className].filter(Boolean).join(" ")} {...rest}>
        {children}
      </select>
      {hint && <span className="at-hint">{hint}</span>}
    </div>
  );
}
