import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import {
  formatCalendarMonth,
  formatIsoCalendarDate,
  getWeekdayLabelsShort,
  calendarDateValidationHint,
  localeDateInputPattern,
  parseFlexibleCalendarDate,
  todayIsoDate,
} from "../utils/event-dates.js";
import { useModalFocusTrap } from "./useModalFocusTrap.js";
import { useClickOutside, type OutsideInteraction } from "./useClickOutside.js";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(iso: string): { y: number; m: number; d: number } | null {
  if (!ISO_DATE_RE.test(iso)) return null;
  const [y, m, d] = iso.split("-").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(y) || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

function toIsoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function mondayFirstOffset(y: number, m: number): number {
  const dow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return dow === 0 ? 6 : dow - 1;
}

function shiftMonth(year: number, month: number, delta: number): { y: number; m: number } {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1 };
}

function addDays(
  year: number,
  month: number,
  day: number,
  delta: number,
): { y: number; m: number; d: number } {
  const date = new Date(Date.UTC(year, month - 1, day + delta));
  return {
    y: date.getUTCFullYear(),
    m: date.getUTCMonth() + 1,
    d: date.getUTCDate(),
  };
}

export interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  id?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  error?: string;
}

export function DatePicker({
  value,
  onChange,
  label,
  id,
  disabled,
  required,
  placeholder,
  hint,
  error,
}: DatePickerProps) {
  const autoId = useId();
  const controlId = id ?? `dp-${autoId}`;
  const parsed = parseIsoDate(value);
  const today = todayIsoDate();
  const todayParts = parseIsoDate(today)!;
  const inputPattern = localeDateInputPattern();
  const resolvedPlaceholder = placeholder ?? inputPattern;

  const [open, setOpen] = useState(false);
  const [panelAbove, setPanelAbove] = useState(false);
  const [text, setText] = useState(() => (value ? formatIsoCalendarDate(value) : ""));
  const [typing, setTyping] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [viewYear, setViewYear] = useState(() => parsed?.y ?? todayParts.y);
  const [viewMonth, setViewMonth] = useState(() => parsed?.m ?? todayParts.m);
  const [highlightDay, setHighlightDay] = useState(() => parsed?.d ?? todayParts.d);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const calendarRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const weekdayLabels = getWeekdayLabelsShort();
  const monthLabel = formatCalendarMonth(viewYear, viewMonth);
  const days = daysInMonth(viewYear, viewMonth);
  const offset = mondayFirstOffset(viewYear, viewMonth);

  // `reason === "focus"` means the user already tabbed focus elsewhere on purpose — pulling
  // it back to this input would trap keyboard navigation, so only restore focus for every
  // other close path (Escape, picking a date, an outside pointerdown, typing a valid date).
  const closePanel = (reason?: OutsideInteraction) => {
    setOpen(false);
    if (reason !== "focus") window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (typing || parseError) return;
    setText(value ? formatIsoCalendarDate(value) : "");
  }, [typing, value, parseError]);

  useEffect(() => {
    if (!open) return;
    const parts = parseIsoDate(value);
    if (parts) {
      setViewYear(parts.y);
      setViewMonth(parts.m);
      setHighlightDay(parts.d);
      return;
    }
    setViewYear(todayParts.y);
    setViewMonth(todayParts.m);
    setHighlightDay(todayParts.d);
  }, [open, value, todayParts.d, todayParts.m, todayParts.y]);

  useEffect(() => {
    if (!open) return;
    const cell = panelRef.current?.querySelector(
      `[data-day="${highlightDay}"]`,
    ) as HTMLElement | undefined;
    cell?.focus();
  }, [highlightDay, open, viewMonth, viewYear]);

  useClickOutside(containerRef, open, closePanel);

  useEffect(() => {
    if (!open || !containerRef.current || !panelRef.current) return;
    const updatePlacement = () => {
      const rect = containerRef.current!.getBoundingClientRect();
      const panelHeight = panelRef.current!.offsetHeight;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setPanelAbove(spaceBelow < panelHeight + 8 && spaceAbove > spaceBelow);
    };
    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [open, viewMonth, viewYear]);

  const commitText = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setParseError(null);
      onChange("");
      setText("");
      setTyping(false);
      return true;
    }
    if (value && trimmed === formatIsoCalendarDate(value)) {
      setParseError(null);
      setTyping(false);
      return true;
    }
    const iso = parseFlexibleCalendarDate(trimmed);
    if (!iso) {
      setParseError(`Use a valid date (${calendarDateValidationHint(inputPattern)}).`);
      setText(trimmed);
      onChange("");
      setTyping(false);
      return false;
    }
    setParseError(null);
    onChange(iso);
    setText(formatIsoCalendarDate(iso));
    setTyping(false);
    return true;
  };

  const selectDate = (day: number) => {
    const iso = toIsoDate(viewYear, viewMonth, day);
    onChange(iso);
    setText(formatIsoCalendarDate(iso));
    setParseError(null);
    setTyping(false);
    closePanel();
  };

  const moveHighlight = (deltaDays: number) => {
    const next = addDays(viewYear, viewMonth, highlightDay, deltaDays);
    setViewYear(next.y);
    setViewMonth(next.m);
    setHighlightDay(next.d);
  };

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePanel();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveHighlight(-1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveHighlight(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(-7);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveHighlight(7);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      selectDate(highlightDay);
    }
  };

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    setTyping(true);
    setText(event.target.value);
    setParseError(null);
  };

  useModalFocusTrap(panelRef, open, closePanel);

  const displayError = error ?? parseError;
  const isInvalid = Boolean(displayError);

  return (
    <div className="at-field date-picker" ref={containerRef}>
      {label ? (
        <label className="at-label" htmlFor={controlId}>
          {label}
          {required ? (
            <>
              {" "}
              <span aria-hidden="true">*</span>
            </>
          ) : null}
        </label>
      ) : null}

      <div
        className={["date-picker__control", isInvalid && "date-picker__control--invalid"]
          .filter(Boolean)
          .join(" ")}
      >
        <button
          ref={calendarRef}
          type="button"
          className="date-picker__calendar-btn"
          disabled={disabled}
          aria-label={open ? "Close calendar" : "Open calendar"}
          aria-expanded={open}
          aria-controls={`${controlId}-panel`}
          onClick={() => {
            if (!disabled) setOpen((prev) => !prev);
          }}
        >
          <i className="ti ti-calendar" aria-hidden="true" />
        </button>
        <input
          ref={inputRef}
          id={controlId}
          className="date-picker__input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          aria-invalid={isInvalid || undefined}
          aria-required={required || undefined}
          placeholder={resolvedPlaceholder}
          value={text}
          onChange={onInputChange}
          onBlur={() => {
            if (typing) void commitText(text);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (typing) {
                if (commitText(text)) closePanel();
              }
              return;
            }
            if (event.key === "ArrowDown" && !open) {
              event.preventDefault();
              setOpen(true);
            }
          }}
        />
      </div>

      {open && (
        <div
          ref={panelRef}
          id={`${controlId}-panel`}
          className={[
            "date-picker__panel",
            panelAbove && "date-picker__panel--above",
          ]
            .filter(Boolean)
            .join(" ")}
          role="dialog"
          aria-label="Choose date"
          aria-modal="true"
          onKeyDown={onPanelKeyDown}
        >
          <div className="date-picker__header">
            <button
              type="button"
              className="date-picker__nav"
              aria-label="Previous month"
              onClick={() => {
                const next = shiftMonth(viewYear, viewMonth, -1);
                setViewYear(next.y);
                setViewMonth(next.m);
              }}
            >
              <i className="ti ti-chevron-left" aria-hidden="true" />
            </button>
            <span className="date-picker__month">{monthLabel}</span>
            <button
              type="button"
              className="date-picker__nav"
              aria-label="Next month"
              onClick={() => {
                const next = shiftMonth(viewYear, viewMonth, 1);
                setViewYear(next.y);
                setViewMonth(next.m);
              }}
            >
              <i className="ti ti-chevron-right" aria-hidden="true" />
            </button>
          </div>

          <div className="date-picker__weekdays" aria-hidden="true">
            {weekdayLabels.map((name) => (
              <span key={name} className="date-picker__weekday">
                {name}
              </span>
            ))}
          </div>

          <div className="date-picker__grid" role="grid">
            {Array.from({ length: offset }, (_, i) => (
              <span key={`pad-${i}`} className="date-picker__day date-picker__day--empty" />
            ))}
            {Array.from({ length: days }, (_, i) => {
              const day = i + 1;
              const iso = toIsoDate(viewYear, viewMonth, day);
              const selected = value === iso;
              const isToday = today === iso;
              return (
                <button
                  key={day}
                  type="button"
                  role="gridcell"
                  data-day={day}
                  tabIndex={day === highlightDay ? 0 : -1}
                  className={[
                    "date-picker__day",
                    selected && "date-picker__day--selected",
                    isToday && "date-picker__day--today",
                    day === highlightDay && "date-picker__day--highlighted",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-selected={selected}
                  aria-label={formatIsoCalendarDate(iso)}
                  onMouseEnter={() => setHighlightDay(day)}
                  onClick={() => selectDate(day)}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className="date-picker__footer">
            <button
              type="button"
              className="date-picker__footer-btn"
              onClick={() => {
                onChange("");
                setText("");
                setParseError(null);
                setTyping(false);
                closePanel();
              }}
            >
              Clear
            </button>
            <button
              type="button"
              className="date-picker__footer-btn date-picker__footer-btn--primary"
              onClick={() => {
                onChange(today);
                setText(formatIsoCalendarDate(today));
                setParseError(null);
                setTyping(false);
                const parts = parseIsoDate(today)!;
                setViewYear(parts.y);
                setViewMonth(parts.m);
                closePanel();
              }}
            >
              Today
            </button>
          </div>
        </div>
      )}

      {displayError ? (
        <span className="at-hint at-hint--error" role="alert" aria-live="polite">
          {displayError}
        </span>
      ) : hint ? (
        <span className="at-hint">{hint}</span>
      ) : null}
    </div>
  );
}
