import { useEffect, useState } from "react";
import { Checkbox } from "@admitto/ui";
import { useDropdownMenu } from "./useDropdownMenu.js";
import { SearchableSelectSearchBox } from "./SearchableSelectSearchBox.js";
import type { SearchableSelectOption } from "./SearchableSelect.js";
import "./searchable-select.css";
import "./multi-select.css";

/** Same threshold as SearchableSelect — a search box earns its keep above this option count. */
const SEARCH_THRESHOLD = 6;

/** Closed-trigger summary: the placeholder with nothing selected, the one selected option's own
 * label (falling back to the placeholder if that id is no longer in `options`, e.g. a filter
 * still referencing a deleted ticket type), or a plain count once there's more than one. */
function triggerSummary(
  value: readonly string[],
  placeholder: string,
  options: readonly SearchableSelectOption[],
): string {
  if (value.length === 0) return placeholder;
  if (value.length === 1) return options.find((o) => o.id === value[0])?.label ?? placeholder;
  return `${value.length} selected`;
}

interface MultiSelectProps {
  id: string;
  label: string;
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  value: readonly string[];
  options: readonly SearchableSelectOption[];
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  hint?: string;
  title?: string;
  minWidth?: number;
  showLabel?: boolean;
  /** Row above the option list toggling every option at once — hidden for a single-option list,
   * where "select all" and "select the one option" are the same action. */
  selectAllLabel?: string;
  clearLabel?: string;
  onChange: (ids: string[]) => void;
}

/** MultiSelect variant of `SearchableSelect` — same trigger/panel/search mechanism, but the
 * panel holds a checkbox list instead of a single-click option list: a row toggles membership
 * and keeps the panel open (closing on every click, as `SearchableSelect` does, would force one
 * open/close cycle per value picked). The closed trigger summarizes the selection instead of
 * showing one label, since there can be more than one. */
export function MultiSelect({
  id,
  label,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  value,
  options,
  disabled,
  invalid,
  describedBy,
  hint,
  title,
  showLabel = true,
  minWidth = 260,
  selectAllLabel = "Select all",
  clearLabel = "Clear",
  onChange,
}: Readonly<MultiSelectProps>) {
  const { open, setOpen, openUpward, panelStyle, rootRef, triggerRef, panelRef } = useDropdownMenu<
    HTMLButtonElement,
    HTMLDivElement
  >({ align: "start", matchTriggerWidth: true, minWidth });
  const [query, setQuery] = useState("");
  const showSearch = options.length > SEARCH_THRESHOLD;

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const selectedSet = new Set(value);
  const normalizedQuery = showSearch ? query.trim().toLowerCase() : "";
  const results = normalizedQuery
    ? options.filter((o) => o.label.toLowerCase().includes(normalizedQuery))
    : options;

  function toggle(optionId: string): void {
    onChange(
      selectedSet.has(optionId) ? value.filter((id) => id !== optionId) : [...value, optionId],
    );
  }

  const triggerText = triggerSummary(value, placeholder, options);

  const hintId = hint ? `${id}-hint` : undefined;
  const triggerDescribedBy = [describedBy, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="at-field searchable-select" ref={rootRef}>
      {showLabel && (
        <label className="at-label" htmlFor={id}>
          {label}
        </label>
      )}
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className={`searchable-select__trigger${invalid ? " searchable-select__trigger--invalid" : ""}`}
        disabled={disabled}
        title={title}
        aria-expanded={open}
        aria-describedby={triggerDescribedBy}
        aria-label={`${label}, ${value.length === 0 ? "none selected" : triggerText}`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={value.length === 0 ? "searchable-select__placeholder" : "searchable-select__label"}>
          {triggerText}
        </span>
        <i className="ti ti-chevron-down searchable-select__chevron" aria-hidden="true" />
      </button>
      {hint && (
        <span id={hintId} className="at-hint">
          {hint}
        </span>
      )}
      {open && (
        <div
          className={`searchable-select__panel${openUpward ? " searchable-select__panel--up" : ""}`}
          ref={panelRef}
          style={panelStyle}
        >
          {showSearch && (
            <SearchableSelectSearchBox
              id={id}
              searchPlaceholder={searchPlaceholder}
              query={query}
              onQueryChange={setQuery}
              onEnter={() => {
                if (results.length > 0) toggle(results[0]!.id);
              }}
            />
          )}
          {options.length > 1 && (
            <div className="multi-select__actions">
              <button type="button" onClick={() => onChange(options.map((o) => o.id))}>
                {selectAllLabel}
              </button>
              <button type="button" onClick={() => onChange([])}>
                {clearLabel}
              </button>
            </div>
          )}
          <ul className="searchable-select__list" aria-label={label}>
            {results.length === 0 ? (
              <li className="searchable-select__empty">{emptyLabel}</li>
            ) : (
              results.map((o) => (
                <li key={o.id} className="multi-select__option">
                  <Checkbox
                    label={o.label}
                    checked={selectedSet.has(o.id)}
                    onChange={() => toggle(o.id)}
                  />
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
