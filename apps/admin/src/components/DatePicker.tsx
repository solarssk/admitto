import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  formatCalendarMonth,
  formatIsoCalendarDate,
  getWeekdayLabelsShort,
  todayIsoDate,
} from "../utils/event-dates.js";

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
  placeholder = "Pick a date…",
  hint,
  error,
}: DatePickerProps) {
  const autoId = useId();
  const controlId = id ?? `dp-${autoId}`;
  const parsed = parseIsoDate(value);
  const today = todayIsoDate();
  const todayParts = parseIsoDate(today)!;

  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => parsed?.y ?? todayParts.y);
  const [viewMonth, setViewMonth] = useState(() => parsed?.m ?? todayParts.m);
  const [highlightDay, setHighlightDay] = useState(() => parsed?.d ?? todayParts.d);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const weekdayLabels = getWeekdayLabelsShort();
  const monthLabel = formatCalendarMonth(viewYear, viewMonth);
  const days = daysInMonth(viewYear, viewMonth);
  const offset = mondayFirstOffset(viewYear, viewMonth);

  const closePanel = () => {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (!open) return;
    const parts = parseIsoDate(value);
    if (parts) {
      setViewYear(parts.y);
      setViewMonth(parts.m);
      setHighlightDay(parts.d);
      return;
    }
    if (viewYear === todayParts.y && viewMonth === todayParts.m) {
      setHighlightDay(todayParts.d);
      return;
    }
    setHighlightDay(1);
  }, [open, value, todayParts.d, todayParts.m, todayParts.y, viewMonth, viewYear]);

  useEffect(() => {
    if (!open) return;
    const cell = panelRef.current?.querySelector(
      `[data-day="${highlightDay}"]`,
    ) as HTMLElement | undefined;
    cell?.focus();
  }, [highlightDay, open, viewMonth, viewYear]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        closePanel();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const selectDate = (day: number) => {
    onChange(toIsoDate(viewYear, viewMonth, day));
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

  const isInvalid = Boolean(error);

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

      <button
        ref={triggerRef}
        type="button"
        id={controlId}
        className={["date-picker__trigger", isInvalid && "date-picker__trigger--invalid"]
          .filter(Boolean)
          .join(" ")}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-invalid={isInvalid || undefined}
        aria-required={required || undefined}
        onClick={() => {
          if (!disabled) setOpen((prev) => !prev);
        }}
      >
        <i className="ti ti-calendar date-picker__icon" aria-hidden="true" />
        <span className={value ? "date-picker__value" : "date-picker__placeholder"}>
          {value ? formatIsoCalendarDate(value) : placeholder}
        </span>
        <i className="ti ti-chevron-down date-picker__chevron" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={panelRef}
          className="date-picker__panel"
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

      {error ? (
        <span className="at-hint at-hint--error">{error}</span>
      ) : hint ? (
        <span className="at-hint">{hint}</span>
      ) : null}
    </div>
  );
}
