import { useEffect, useId, useRef, useState } from "react";
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
  const containerRef = useRef<HTMLDivElement>(null);

  const weekdayLabels = getWeekdayLabelsShort();
  const monthLabel = formatCalendarMonth(viewYear, viewMonth);
  const days = daysInMonth(viewYear, viewMonth);
  const offset = mondayFirstOffset(viewYear, viewMonth);

  useEffect(() => {
    if (!open) return;
    const parts = parseIsoDate(value);
    if (parts) {
      setViewYear(parts.y);
      setViewMonth(parts.m);
    }
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const selectDate = (day: number) => {
    onChange(toIsoDate(viewYear, viewMonth, day));
    setOpen(false);
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
        type="button"
        id={controlId}
        className={["date-picker__trigger", isInvalid && "date-picker__trigger--invalid"]
          .filter(Boolean)
          .join(" ")}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-invalid={isInvalid || undefined}
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
        <div className="date-picker__panel" role="dialog" aria-label="Choose date">
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
                  className={[
                    "date-picker__day",
                    selected && "date-picker__day--selected",
                    isToday && "date-picker__day--today",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-selected={selected}
                  aria-label={formatIsoCalendarDate(iso)}
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
                setOpen(false);
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
                setOpen(false);
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

      {required ? (
        <input
          tabIndex={-1}
          aria-hidden="true"
          className="date-picker__validator"
          value={value}
          required
          onChange={() => {}}
        />
      ) : null}
    </div>
  );
}
