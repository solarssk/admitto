import { useRef } from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  /** Optional id applied to the first digit input for label association. */
  id?: string;
}

/**
 * Six individual digit boxes for TOTP entry — mirrors the auth wizard experience.
 * Auto-advances focus on each digit entry; backspace moves to the previous box.
 * Handles paste of a full 6-digit code.
 */
export function TotpDigitInput({ value, onChange, disabled, id }: Readonly<Props>) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? "");

  function handleChange(i: number, raw: string) {
    const clean = raw.replace(/\D/g, "");
    if (clean.length > 1) {
      // Multi-char (paste via change event): fill from this position onward
      const next = [...digits];
      clean.slice(0, 6 - i).split("").forEach((c, j) => {
        next[i + j] = c;
      });
      onChange(next.join(""));
      inputRefs.current[Math.min(i + clean.length - 1, 5)]?.focus();
      return;
    }
    const digit = clean.slice(-1);
    const next = [...digits];
    next[i] = digit;
    onChange(next.join(""));
    if (digit && i < 5) inputRefs.current[i + 1]?.focus();
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      const next = [...digits];
      next[i - 1] = "";
      onChange(next.join(""));
      inputRefs.current[i - 1]?.focus();
    }
    if (e.key === "ArrowLeft" && i > 0) inputRefs.current[i - 1]?.focus();
    if (e.key === "ArrowRight" && i < 5) inputRefs.current[i + 1]?.focus();
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!text) return;
    e.preventDefault();
    const next = Array.from({ length: 6 }, (_, i) => text[i] ?? "");
    onChange(next.join(""));
    inputRefs.current[Math.min(text.length - 1, 5)]?.focus();
  }

  return (
    <div className="account-otp-digits">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            inputRefs.current[i] = el;
          }}
          id={i === 0 ? id : undefined}
          className="account-otp-digit"
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={d}
          disabled={disabled}
          autoComplete={i === 0 ? "one-time-code" : "off"}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
        />
      ))}
    </div>
  );
}
