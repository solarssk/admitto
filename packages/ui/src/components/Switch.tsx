import type { InputHTMLAttributes } from "react";

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
}

export function Switch({ label, id, className, ...rest }: SwitchProps) {
  const autoId = id || (label ? `sw-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  return (
    <label className="at-switch">
      <input id={autoId} type="checkbox" role="switch" className={["at-switch__input", className].filter(Boolean).join(" ")} {...rest} />
      <span className="at-switch__track" aria-hidden="true" />
      {label && <span className="at-switch__label">{label}</span>}
    </label>
  );
}
