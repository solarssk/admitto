import { useEffect, useState } from "react";
import { useDropdownMenu } from "./useDropdownMenu.js";
import "./searchable-select.css";

export interface SearchableSelectOption {
  id: string;
  label: string;
  /** Tabler icon name (without the `ti-` prefix), shown before the label in both the trigger
   * and each option row - e.g. "calendar-event" for an event, "building" for an organization. */
  icon?: string;
}

interface SearchableSelectProps {
  id: string;
  label: string;
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  value: string;
  options: readonly SearchableSelectOption[];
  disabled?: boolean;
  /** Native tooltip on the trigger, e.g. explaining why the field is disabled. */
  title?: string;
  onChange: (id: string) => void;
}

/** Generic searchable combobox: a disclosure button (same trigger/panel/outside-click mechanism
 * as FiltersMenu) whose panel holds a search box and an icon+label list - the same shape as
 * PhoneCountrySelect, generalized past phone-country data for any options list too long for a
 * plain `<select>` to stay usable (e.g. picking one event out of dozens). */
export function SearchableSelect({
  id,
  label,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  value,
  options,
  disabled,
  title,
  onChange,
}: Readonly<SearchableSelectProps>) {
  const { open, setOpen, close, openUpward, rootRef, triggerRef, panelRef } = useDropdownMenu<
    HTMLButtonElement,
    HTMLDivElement
  >();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const selected = value ? options.find((o) => o.id === value) : undefined;
  const normalizedQuery = query.trim().toLowerCase();
  const results = normalizedQuery
    ? options.filter((o) => o.label.toLowerCase().includes(normalizedQuery))
    : options;

  function handleSelect(option: SearchableSelectOption): void {
    onChange(option.id);
    close();
  }

  // aria-label (not a <label for>, which a button's own subtree content would win over per the
  // accessible-name spec, silencing the selected value) - states the field's purpose *and*
  // current selection together, matching PhoneCountrySelect's own trigger.
  const triggerLabel = selected ? `${label}, ${selected.label}` : `${label}, none selected`;

  return (
    <div className="at-field searchable-select" ref={rootRef}>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className="searchable-select__trigger"
        disabled={disabled}
        title={title}
        aria-expanded={open}
        aria-label={triggerLabel}
        onClick={() => setOpen((current) => !current)}
      >
        {selected ? (
          <>
            {selected.icon && <i className={`ti ti-${selected.icon}`} aria-hidden="true" />}
            <span className="searchable-select__label">{selected.label}</span>
          </>
        ) : (
          <span className="searchable-select__placeholder">{placeholder}</span>
        )}
        <i className="ti ti-chevron-down searchable-select__chevron" aria-hidden="true" />
      </button>
      {open && (
        <div
          className={`searchable-select__panel${openUpward ? " searchable-select__panel--up" : ""}`}
          ref={panelRef}
        >
          <input
            type="text"
            id={`${id}-search`}
            name={`${id}-search`}
            className="searchable-select__search"
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results.length > 0) {
                e.preventDefault();
                handleSelect(results[0]!);
              }
            }}
          />
          <ul className="searchable-select__list" aria-label={label}>
            {results.length === 0 ? (
              <li className="searchable-select__empty">{emptyLabel}</li>
            ) : (
              results.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    className="searchable-select__option"
                    aria-label={o.label}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelect(o)}
                  >
                    {o.icon && <i className={`ti ti-${o.icon}`} aria-hidden="true" />}
                    <span className="searchable-select__name">{o.label}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
