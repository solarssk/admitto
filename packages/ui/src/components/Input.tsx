import { useId, forwardRef, type InputHTMLAttributes, type ReactNode } from "react";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  hint?: string;
  error?: string;
  icon?: ReactNode;
  invalid?: boolean;
  /** Safari / password-manager hint (maps to HTML `passwordrules`). */
  passwordRules?: string;
}

/** Labeled text field with optional hint, error state, and icon; forwards ref to the native input. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    hint,
    error,
    icon = null,
    id,
    invalid = false,
    className,
    ...rest
  },
  ref,
) {
  const uid = useId();
  const autoId = id ?? (label ? `f-${uid}` : undefined);
  const isInvalid = invalid || !!error;
  const hintId = hint && !error ? `${uid}-hint` : undefined;
  const errorId = error ? `${uid}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  const field = (
    <input
      ref={ref}
      id={autoId}
      className={["at-input", isInvalid && "at-input--invalid", className].filter(Boolean).join(" ")}
      aria-invalid={isInvalid || undefined}
      aria-describedby={describedBy}
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
        <span id={errorId} className="at-hint at-hint--error">
          {error}
        </span>
      ) : hint ? (
        <span id={hintId} className="at-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
});
