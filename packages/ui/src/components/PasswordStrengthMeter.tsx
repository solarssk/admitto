import { scorePasswordStrength } from "@admitto/auth/password-strength";
import { useId, type HTMLAttributes } from "react";

export interface PasswordStrengthMeterProps extends HTMLAttributes<HTMLDivElement> {
  password: string;
}

/** Accessible password strength meter — text label plus segmented bar (not color-only). */
export function PasswordStrengthMeter({
  password,
  className,
  ...rest
}: PasswordStrengthMeterProps) {
  const uid = useId();
  const result = scorePasswordStrength(password);
  if (result.level === "empty") return null;

  return (
    <div
      {...rest}
      id={`${uid}-strength`}
      className={["at-password-strength", className].filter(Boolean).join(" ")}
      role="status"
      aria-live="polite"
      aria-label={`Password strength: ${result.label}`}
    >
      <div className="at-password-strength__bar" aria-hidden="true">
        {[1, 2, 3, 4].map((segment) => (
          <span
            key={segment}
            className={[
              "at-password-strength__segment",
              segment <= result.score && `at-password-strength__segment--${result.level}`,
            ]
              .filter(Boolean)
              .join(" ")}
          />
        ))}
      </div>
      <span
        className={[
          "at-password-strength__label",
          `at-password-strength__label--${result.level}`,
        ].join(" ")}
      >
        {result.label}
      </span>
    </div>
  );
}
