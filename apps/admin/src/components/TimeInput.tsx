import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";

/** Accepts "18", "1800", "18:00", "18.00" and normalizes to zero-padded 24h "HH:MM".
 * Returns null when the text cannot be parsed as a valid time. */
function parseFlexibleTime(raw: string): string | null {
  const digitsOnly = raw.trim().replace(/[.: ]/g, "");
  if (!/^\d{1,4}$/.test(digitsOnly)) return null;
  const hours = digitsOnly.length <= 2 ? Number.parseInt(digitsOnly, 10) : Number.parseInt(digitsOnly.slice(0, -2), 10);
  const minutes = digitsOnly.length <= 2 ? 0 : Number.parseInt(digitsOnly.slice(-2), 10);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export interface TimeInputProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  /** Accessible name for the input when there's no visible `label`. */
  ariaLabel?: string;
  id?: string;
  disabled?: boolean;
  hint?: string;
  error?: string;
}

/** 24-hour "HH:MM" text field styled like DatePicker (icon in a grey box, plain typed input) -
 * avoids the browser's own native time picker, whose look (and 12h/24h AM-PM columns) varies by
 * OS/browser. The stored value is always 24-hour, typed input is parsed flexibly ("1800", "18:00"). */
export function TimeInput({ value, onChange, label, ariaLabel, id, disabled, hint, error }: Readonly<TimeInputProps>) {
  const uid = useId();
  const controlId = id ?? `ti-${uid}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value);
  const [typedInvalid, setTypedInvalid] = useState(false);

  useEffect(() => {
    setText(value);
    setTypedInvalid(false);
  }, [value]);

  const isInvalid = Boolean(error) || typedInvalid;
  const hintId = hint && !error ? `${uid}-hint` : undefined;
  const errorId = error ? `${uid}-error` : undefined;
  const invalidHintId = typedInvalid && !error ? `${uid}-invalid` : undefined;

  /** Reformats the displayed text to zero-padded "HH:MM" once it fully parses (blur / Enter) -
   * every keystroke already propagated the raw text via onChange below, so this only cleans up
   * what's shown and flags text that still doesn't parse into a valid time. */
  function normalizeOnCommit(raw: string): void {
    if (!raw.trim()) {
      setTypedInvalid(false);
      return;
    }
    const parsed = parseFlexibleTime(raw);
    if (!parsed) {
      setTypedInvalid(true);
      return;
    }
    setTypedInvalid(false);
    setText(parsed);
    onChange(parsed);
  }

  return (
    <div className="at-field">
      {label ? (
        <label className="at-label" htmlFor={controlId}>
          {label}
        </label>
      ) : null}
      <div className={["time-input__control", isInvalid && "time-input__control--invalid"].filter(Boolean).join(" ")}>
        <span className="time-input__icon" aria-hidden="true">
          <i className="ti ti-clock" aria-hidden="true" />
        </span>
        <input
          ref={inputRef}
          id={controlId}
          className="time-input__input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="--:--"
          disabled={disabled}
          aria-label={label ? undefined : ariaLabel}
          aria-invalid={isInvalid || undefined}
          aria-describedby={[errorId, hintId, invalidHintId].filter(Boolean).join(" ") || undefined}
          value={text}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            setText(event.target.value);
            onChange(event.target.value);
          }}
          onBlur={(event) => normalizeOnCommit(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Enter") {
              event.preventDefault();
              normalizeOnCommit((event.target as HTMLInputElement).value);
            }
          }}
        />
      </div>
      {error ? (
        <span id={errorId} className="at-hint at-hint--error">
          {error}
        </span>
      ) : typedInvalid ? (
        <span id={invalidHintId} className="at-hint at-hint--error">
          Use 24-hour time, e.g. 18:00.
        </span>
      ) : hint ? (
        <span id={hintId} className="at-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
