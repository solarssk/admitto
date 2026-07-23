import { useId, type ReactNode, type SelectHTMLAttributes } from "react";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  children?: ReactNode;
}

export function Select({ label, hint, id, children, className, ...rest }: Readonly<SelectProps>) {
  const uid = useId();
  const autoId = id ?? (label ? `f-${uid}` : undefined);
  const hintId = hint ? `${uid}-hint` : undefined;
  return (
    <div className="at-field">
      {label && (
        <label className="at-label" htmlFor={autoId}>
          {label}
        </label>
      )}
      <select
        id={autoId}
        className={["at-select", className].filter(Boolean).join(" ")}
        aria-describedby={hintId}
        {...rest}
      >
        {children}
      </select>
      {hint && (
        <span id={hintId} className="at-hint">
          {hint}
        </span>
      )}
    </div>
  );
}
