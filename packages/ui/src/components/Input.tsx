import type { InputHTMLAttributes, ReactNode } from "react";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  hint?: string;
  error?: string;
  icon?: ReactNode;
  invalid?: boolean;
}

export function Input({
  label,
  hint,
  error,
  icon = null,
  id,
  invalid = false,
  className,
  ...rest
}: InputProps) {
  const autoId = id || (label ? `f-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  const isInvalid = invalid || !!error;
  const field = (
    <input
      id={autoId}
      className={["at-input", isInvalid && "at-input--invalid", className].filter(Boolean).join(" ")}
      aria-invalid={isInvalid || undefined}
      {...rest}
    />
  );
  return (
    <div className="at-field">
      {label && (
        <label className="at-label" htmlFor={autoId}>
          {label}
        </label>
      )}
      {icon ? (
        <div className="at-inputgroup">
          <span className="at-inputgroup__icon" aria-hidden="true">
            {icon}
          </span>
          {field}
        </div>
      ) : (
        field
      )}
      {error ? (
        <span className="at-hint at-hint--error">{error}</span>
      ) : hint ? (
        <span className="at-hint">{hint}</span>
      ) : null}
    </div>
  );
}
