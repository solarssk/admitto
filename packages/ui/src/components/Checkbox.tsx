import type { InputHTMLAttributes } from "react";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
}

export function Checkbox({ label, id, className, ...rest }: Readonly<CheckboxProps>) {
  const autoId = id || (label ? `cb-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  return (
    <label className="at-check">
      <input id={autoId} type="checkbox" className={["at-check__input", className].filter(Boolean).join(" ")} {...rest} />
      <span className="at-check__box" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
      {label && <span className="at-check__label">{label}</span>}
    </label>
  );
}
