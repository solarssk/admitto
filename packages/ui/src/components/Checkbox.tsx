import type { InputHTMLAttributes } from "react";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
}

export function Checkbox({ label, id, className, ...rest }: CheckboxProps) {
  const autoId = id || (label ? `cb-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  return (
    <label className="at-check">
      <input id={autoId} type="checkbox" className={["at-check__input", className].filter(Boolean).join(" ")} {...rest} />
      {label && <span className="at-check__label">{label}</span>}
    </label>
  );
}
