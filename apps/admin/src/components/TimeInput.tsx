import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useClickOutside, type OutsideInteraction } from "./useClickOutside.js";
import { getPreferredTimeFormat } from "../utils/locale-store.js";
import "../staff.css";

type TimeParts = { hours: number; minutes: number };

const TWELVE_HOUR_OPTIONS = Array.from({ length: 12 }, (_, index) => index + 1);
const TWENTY_FOUR_HOUR_OPTIONS = Array.from({ length: 24 }, (_, index) => index);
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, index) => index);
const MERIDIEM_OPTIONS = ["AM", "PM"] as const;
type Meridiem = (typeof MERIDIEM_OPTIONS)[number];

function joinClassNames(...classNames: Array<string | false | undefined>): string {
  return classNames.filter(Boolean).join(" ");
}

function parseTimeParts(digits: string, minutesPart?: string): TimeParts {
  if (minutesPart) {
    return {
      hours: Number.parseInt(digits, 10),
      minutes: Number.parseInt(minutesPart, 10),
    };
  }

  if (digits.length <= 2) {
    return { hours: Number.parseInt(digits, 10), minutes: 0 };
  }

  return {
    hours: Number.parseInt(digits.slice(0, -2), 10),
    minutes: Number.parseInt(digits.slice(-2), 10),
  };
}

function toTwentyFourHour(hours: number, meridiem?: string): number {
  if (!meridiem) return hours;

  const baseHour = hours % 12;
  return meridiem === "pm" ? baseHour + 12 : baseHour;
}

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
  const { hours, minutes } = parseTimeParts(digits, match[2]);

  if (minutes > 59 || (meridiem ? hours < 1 || hours > 12 : hours > 23)) return null;
  const twentyFourHour = toTwentyFourHour(hours, meridiem);
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

function resolveTwelveHourFormat(
  hourCycle: TimeInputProps["hourCycle"],
  preferredTimeFormat: ReturnType<typeof getPreferredTimeFormat>,
): boolean {
  if (hourCycle) return hourCycle === "12h";
  if (preferredTimeFormat) return preferredTimeFormat === "12h";
  return usesTwelveHourTime();
}

function getPickerHour(time: TimeParts, twelveHour: boolean): number {
  if (!twelveHour) return time.hours;
  return time.hours % 12 || 12;
}

function getMeridiem(hours: number): Meridiem {
  return hours < 12 ? "AM" : "PM";
}

function pickerOptionClassName(selected: boolean): string {
  return joinClassNames(
    "time-input__picker-option",
    selected && "time-input__picker-option--selected",
  );
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
  /** Keep a popover inside the available edge of a paired field row. */
  pickerAlign?: "start" | "end";
  /** Reports whether the current typed value can safely be submitted. */
  onValidityChange?: (valid: boolean) => void;
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
  pickerAlign = "start",
  onValidityChange,
}: Readonly<TimeInputProps>) {
  const uid = useId();
  const controlId = id ?? `ti-${uid}`;
  // Time format is deliberately independent from the date's Regional format. With no account
  // choice, Intl uses the browser default, matching the wording in My account.
  const preferredTimeFormat = getPreferredTimeFormat();
  const twelveHour = resolveTwelveHourFormat(hourCycle, preferredTimeFormat);
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

  function setTypedValidity(valid: boolean): void {
    setTypedInvalid(!valid);
    onValidityChange?.(valid);
  }

  function commit(raw: string): boolean {
    if (!raw.trim()) {
      setTypedValidity(true);
      onChange("");
      return true;
    }
    const parsed = parseFlexibleTime(raw);
    if (!parsed) {
      setTypedValidity(false);
      return false;
    }
    setTypedValidity(true);
    setText(formatTime(parsed, twelveHour));
    setPickerTime(splitTime(parsed));
    onChange(parsed);
    return true;
  }

  function chooseTime(next: TimeParts): void {
    const canonical = `${String(next.hours).padStart(2, "0")}:${String(next.minutes).padStart(2, "0")}`;
    setPickerTime(next);
    setText(formatTime(canonical, twelveHour));
    setTypedValidity(true);
    onChange(canonical);
  }

  function handleIconClick(): void {
    if (suppressNextIconClickRef.current) {
      suppressNextIconClickRef.current = false;
      return;
    }
    setPickerOpen((open) => !open);
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>): void {
    setText(event.target.value);
    if (typedInvalid) setTypedValidity(true);
    // Do not publish a partial value. In particular, `2` may be the start of `23`;
    // publishing it here would rerender the parent and replace the operator's text with
    // 02:00 before they can type the next digit. Blur or Enter performs the conversion.
  }

  function handleInputBlur(event: FocusEvent<HTMLInputElement>): void {
    commit(event.target.value);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      event.preventDefault();
      if (commit((event.target as HTMLInputElement).value)) closePicker();
      return;
    }
    if (event.key === "Escape") {
      closePicker();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setPickerOpen(true);
    }
  }

  function handleHourClick(event: MouseEvent<HTMLButtonElement>): void {
    const hour = Number(event.currentTarget.value);
    if (!twelveHour) {
      chooseTime({ ...pickerTime, hours: hour });
      return;
    }
    const nextHour = getMeridiem(pickerTime.hours) === "PM" ? hour % 12 + 12 : hour % 12;
    chooseTime({ ...pickerTime, hours: nextHour });
  }

  function handleMinuteClick(event: MouseEvent<HTMLButtonElement>): void {
    chooseTime({ ...pickerTime, minutes: Number(event.currentTarget.value) });
  }

  function handleMeridiemClick(event: MouseEvent<HTMLButtonElement>): void {
    const period = event.currentTarget.value as Meridiem;
    const hour = pickerTime.hours % 12;
    chooseTime({ ...pickerTime, hours: period === "PM" ? hour + 12 : hour });
  }

  const hours = twelveHour ? TWELVE_HOUR_OPTIONS : TWENTY_FOUR_HOUR_OPTIONS;
  const pickerHour = getPickerHour(pickerTime, twelveHour);
  const meridiem = getMeridiem(pickerTime.hours);
  let fieldMessage: ReactNode = null;
  if (error) {
    fieldMessage = <span id={errorId} className="at-hint at-hint--error">{error}</span>;
  } else if (typedInvalid) {
    fieldMessage = <span id={invalidHintId} className="at-hint at-hint--error">Use a time such as 18:00 or 6:00 PM.</span>;
  } else if (hint) {
    fieldMessage = <span id={hintId} className="at-hint">{hint}</span>;
  }

  return (
    <div
      className={joinClassNames("at-field", "time-input", pickerAlign === "end" && "time-input--picker-end")}
      ref={containerRef}
    >
      {label ? <label className="at-label" htmlFor={controlId}>{label}</label> : null}
      <div className={joinClassNames("time-input__control", isInvalid && "time-input__control--invalid")}>
        <button
          type="button"
          className="time-input__icon"
          disabled={disabled}
          aria-label={pickerOpen ? "Close time picker" : "Open time picker"}
          aria-expanded={pickerOpen}
          aria-controls={`${controlId}-picker`}
          onClick={handleIconClick}
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
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          onKeyDown={handleInputKeyDown}
        />
      </div>
      {pickerOpen ? (
        <div
          ref={pickerRef}
          id={`${controlId}-picker`}
          className={joinClassNames(
            "time-input__picker",
            twelveHour ? "time-input__picker--twelve-hour" : "time-input__picker--twenty-four-hour",
          )}
          role="dialog"
          aria-label="Choose time"
        >
          <div className="time-input__picker-column">
            <span className="time-input__picker-label">Hour</span>
            <div className="time-input__picker-scroll" aria-label="Hour">
              {hours.map((hour) => (
                <button
                  key={hour}
                  type="button"
                  value={hour}
                  className={pickerOptionClassName(pickerHour === hour)}
                  onClick={handleHourClick}
                >
                  {String(hour).padStart(2, "0")}
                </button>
              ))}
            </div>
          </div>
          <div className="time-input__picker-column">
            <span className="time-input__picker-label">Minute</span>
            <div className="time-input__picker-scroll" aria-label="Minute">
              {MINUTE_OPTIONS.map((minute) => (
                <button
                  key={minute}
                  type="button"
                  value={minute}
                  className={pickerOptionClassName(pickerTime.minutes === minute)}
                  onClick={handleMinuteClick}
                >
                  {String(minute).padStart(2, "0")}
                </button>
              ))}
            </div>
          </div>
          {twelveHour ? (
            <div className="time-input__picker-column time-input__picker-column--meridiem">
              <span className="time-input__picker-label">AM/PM</span>
              <div className="time-input__picker-scroll" aria-label="AM or PM">
              {MERIDIEM_OPTIONS.map((period) => (
                <button
                  key={period}
                  type="button"
                  value={period}
                  className={pickerOptionClassName(meridiem === period)}
                  onClick={handleMeridiemClick}
                >
                  {period}
                </button>
              ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {fieldMessage}
    </div>
  );
}
