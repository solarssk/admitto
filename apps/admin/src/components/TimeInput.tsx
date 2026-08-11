import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { useClickOutside, type OutsideInteraction } from "./useClickOutside.js";
import { getPreferredTimeFormat } from "../utils/locale-store.js";

type TimeParts = { hours: number; minutes: number };

/** Accepts complete 24-hour input ("18", "1800", "18:00") and 12-hour input
 * ("6pm", "6:30 PM", "630p.m."), then returns the canonical stored "HH:MM" value. */
function parseFlexibleTime(raw: string): string | null {
  const normalized = raw.trim().toLowerCase().replaceAll(".", "");
  if (!normalized) return null;
  // The input permits at most four digits, so the optional groups are bounded.
  // eslint-disable-next-line security/detect-unsafe-regex -- bounded numeric time parser
  const match = /^(\d{1,4})(?:[: ](\d{1,2}))?\s*(am|pm)?$/.exec(normalized);
  if (!match) return null;

  const digits = match[1] ?? "";
  const hasSeparator = Boolean(match[2]);
  const meridiem = match[3];
  // A lone digit is normally an unfinished 24-hour value (the operator may still be typing
  // "23"). Do not silently turn it into 02:00/06:00. `6 PM` remains an unambiguous exception.
  if (!hasSeparator && !meridiem && digits.length < 2) return null;
  const hours = hasSeparator || digits.length <= 2
    ? Number.parseInt(digits, 10)
    : Number.parseInt(digits.slice(0, -2), 10);
  const minutes = hasSeparator
    ? Number.parseInt(match[2] ?? "0", 10)
    : digits.length <= 2
      ? 0
      : Number.parseInt(digits.slice(-2), 10);

  if (minutes > 59 || (meridiem ? hours < 1 || hours > 12 : hours > 23)) return null;
  const twentyFourHour = meridiem
    ? (hours % 12) + (meridiem === "pm" ? 12 : 0)
    : hours;
  return `${String(twentyFourHour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function splitTime(value: string): TimeParts {
  const parsed = parseFlexibleTime(value);
  if (!parsed) return { hours: 9, minutes: 0 };
  const [hours, minutes] = parsed.split(":").map(Number);
  return { hours: hours ?? 9, minutes: minutes ?? 0 };
}

function formatTime(value: string, twelveHour: boolean): string {
  if (!value || !twelveHour) return value;
  const { hours, minutes } = splitTime(value);
  const suffix = hours < 12 ? "AM" : "PM";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function usesTwelveHourTime(locale?: string): boolean {
  const cycle = Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions().hourCycle;
  return cycle === "h11" || cycle === "h12";
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
  /** Override the account regional format when an embedding form needs a specific display. */
  hourCycle?: "12h" | "24h";
}

/** A browser-independent time control. It stores 24-hour HH:MM, while typing and the picker
 * follow the operator's 12/24-hour preference so AM/PM users do not have to translate times. */
export function TimeInput({
  value,
  onChange,
  label,
  ariaLabel,
  id,
  disabled,
  hint,
  error,
  hourCycle,
}: Readonly<TimeInputProps>) {
  const uid = useId();
  const controlId = id ?? `ti-${uid}`;
  // Time format is deliberately independent from the date's Regional format. With no account
  // choice, Intl uses the browser default, matching the wording in My account.
  const preferredTimeFormat = getPreferredTimeFormat();
  const twelveHour = hourCycle
    ? hourCycle === "12h"
    : preferredTimeFormat
      ? preferredTimeFormat === "12h"
      : usesTwelveHourTime();
  const containerRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  // A click-away is observed on pointerdown. If the following click belongs to the same
  // trigger gesture, it must not reopen the picker that pointerdown just closed.
  const suppressNextIconClickRef = useRef(false);
  const [text, setText] = useState(() => formatTime(value, twelveHour));
  const [typedInvalid, setTypedInvalid] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTime, setPickerTime] = useState(() => splitTime(value));

  useEffect(() => {
    setText(formatTime(value, twelveHour));
    setPickerTime(splitTime(value));
    setTypedInvalid(false);
  }, [value, twelveHour]);

  useEffect(() => {
    if (!pickerOpen) return;
    const selected = pickerRef.current?.querySelectorAll(".time-input__picker-option--selected");
    selected?.forEach((option) => {
      option.scrollIntoView?.({ block: "center" });
    });
  }, [pickerOpen, pickerTime]);

  const isInvalid = Boolean(error) || typedInvalid;
  const hintId = hint && !error ? `${uid}-hint` : undefined;
  const errorId = error ? `${uid}-error` : undefined;
  const invalidHintId = typedInvalid && !error ? `${uid}-invalid` : undefined;
  const closePicker = (reason?: OutsideInteraction) => {
    setPickerOpen(false);
    if (reason === "pointer") {
      suppressNextIconClickRef.current = true;
      window.setTimeout(() => {
        suppressNextIconClickRef.current = false;
      }, 0);
    }
  };

  useClickOutside(containerRef, pickerOpen, closePicker, [pickerRef]);

  function commit(raw: string): boolean {
    if (!raw.trim()) {
      setTypedInvalid(false);
      onChange("");
      return true;
    }
    const parsed = parseFlexibleTime(raw);
    if (!parsed) {
      setTypedInvalid(true);
      return false;
    }
    setTypedInvalid(false);
    setText(formatTime(parsed, twelveHour));
    setPickerTime(splitTime(parsed));
    onChange(parsed);
    return true;
  }

  function chooseTime(next: TimeParts): void {
    const canonical = `${String(next.hours).padStart(2, "0")}:${String(next.minutes).padStart(2, "0")}`;
    setPickerTime(next);
    setText(formatTime(canonical, twelveHour));
    setTypedInvalid(false);
    onChange(canonical);
  }

  const hours = twelveHour ? Array.from({ length: 12 }, (_, i) => i + 1) : Array.from({ length: 24 }, (_, i) => i);
  const pickerHour = twelveHour ? pickerTime.hours % 12 || 12 : pickerTime.hours;
  const meridiem = pickerTime.hours < 12 ? "AM" : "PM";

  return (
    <div className="at-field time-input" ref={containerRef}>
      {label ? <label className="at-label" htmlFor={controlId}>{label}</label> : null}
      <div className={["time-input__control", isInvalid && "time-input__control--invalid"].filter(Boolean).join(" ")}>
        <button
          type="button"
          className="time-input__icon"
          disabled={disabled}
          aria-label={pickerOpen ? "Close time picker" : "Open time picker"}
          aria-expanded={pickerOpen}
          aria-controls={`${controlId}-picker`}
          onClick={() => {
            if (suppressNextIconClickRef.current) {
              suppressNextIconClickRef.current = false;
              return;
            }
            setPickerOpen((open) => !open);
          }}
        >
          <i className="ti ti-clock" aria-hidden="true" />
        </button>
        <input
          id={controlId}
          className="time-input__input"
          type="text"
          inputMode="text"
          autoComplete="off"
          placeholder={twelveHour ? "--:-- AM" : "--:--"}
          disabled={disabled}
          aria-label={label ? undefined : ariaLabel}
          aria-invalid={isInvalid || undefined}
          aria-describedby={[errorId, hintId, invalidHintId].filter(Boolean).join(" ") || undefined}
          value={text}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            const nextText = event.target.value;
            setText(nextText);
            setTypedInvalid(false);
            // Do not publish a partial value. In particular, `2` may be the start of `23`;
            // publishing it here would rerender the parent and replace the operator's text with
            // 02:00 before they can type the next digit. Blur or Enter performs the conversion.
          }}
          onBlur={(event) => { commit(event.target.value); }}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (commit((event.target as HTMLInputElement).value)) closePicker();
            }
            if (event.key === "Escape") closePicker();
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setPickerOpen(true);
            }
          }}
        />
      </div>
      {pickerOpen ? (
        <div
          ref={pickerRef}
          id={`${controlId}-picker`}
          className={[
            "time-input__picker",
            twelveHour ? "time-input__picker--twelve-hour" : "time-input__picker--twenty-four-hour",
          ].join(" ")}
          role="dialog"
          aria-label="Choose time"
        >
          <div className="time-input__picker-column">
            <span className="time-input__picker-label">Hour</span>
            <div className="time-input__picker-scroll" aria-label="Hour">
              {hours.map((hour) => (
                <button key={hour} type="button" className={pickerHour === hour ? "time-input__picker-option time-input__picker-option--selected" : "time-input__picker-option"} onClick={() => chooseTime({ ...pickerTime, hours: twelveHour ? (meridiem === "PM" ? hour % 12 + 12 : hour % 12) : hour })}>
                  {String(hour).padStart(2, "0")}
                </button>
              ))}
            </div>
          </div>
          <div className="time-input__picker-column">
            <span className="time-input__picker-label">Minute</span>
            <div className="time-input__picker-scroll" aria-label="Minute">
              {Array.from({ length: 60 }, (_, minute) => minute).map((minute) => (
                <button key={minute} type="button" className={pickerTime.minutes === minute ? "time-input__picker-option time-input__picker-option--selected" : "time-input__picker-option"} onClick={() => chooseTime({ ...pickerTime, minutes: minute })}>
                  {String(minute).padStart(2, "0")}
                </button>
              ))}
            </div>
          </div>
          {twelveHour ? (
            <div className="time-input__picker-column time-input__picker-column--meridiem">
              <span className="time-input__picker-label">AM/PM</span>
              <div className="time-input__picker-scroll" aria-label="AM or PM">
              {(["AM", "PM"] as const).map((period) => (
                <button key={period} type="button" className={meridiem === period ? "time-input__picker-option time-input__picker-option--selected" : "time-input__picker-option"} onClick={() => chooseTime({ ...pickerTime, hours: period === "PM" ? pickerTime.hours % 12 + 12 : pickerTime.hours % 12 })}>
                  {period}
                </button>
              ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? <span id={errorId} className="at-hint at-hint--error">{error}</span> : typedInvalid ? <span id={invalidHintId} className="at-hint at-hint--error">Use a time such as 18:00 or 6:00 PM.</span> : hint ? <span id={hintId} className="at-hint">{hint}</span> : null}
    </div>
  );
}
