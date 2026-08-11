import { useEffect, useState } from "react";
import { useDropdownMenu } from "./useDropdownMenu.js";
import { findPhoneCountryByDialCode, PHONE_COUNTRIES, type PhoneCountry } from "../utils/phoneCountries.js";
import "./phone-country-select.css";

interface PhoneCountrySelectProps {
  id: string;
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (dialCode: string) => void;
}

function matchesQuery(country: PhoneCountry, query: string): boolean {
  if (country.name.toLowerCase().includes(query)) return true;
  return country.dialCode.replace("+", "").startsWith(query.replace(/^\+/, ""));
}

/** Searchable country-code picker for the internal staff phone number field - a plain `<select>`
 * with 250+ options is unusable, so this is a disclosure button (same trigger/panel/outside-click
 * mechanism as FiltersMenu) whose panel holds a search box and a flag+name+code list, styled
 * after the Venue address search's own suggestion list. */
export function PhoneCountrySelect({ id, label, value, disabled, onChange }: Readonly<PhoneCountrySelectProps>) {
  const { open, setOpen, close, openUpward, panelStyle, rootRef, triggerRef, panelRef } = useDropdownMenu<
    HTMLButtonElement,
    HTMLDivElement
  >({ align: "start", matchTriggerWidth: true, minWidth: 260 });
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const selected = value ? findPhoneCountryByDialCode(value) : undefined;
  const normalizedQuery = query.trim().toLowerCase();
  const results = normalizedQuery
    ? PHONE_COUNTRIES.filter((c) => matchesQuery(c, normalizedQuery))
    : PHONE_COUNTRIES;

  function handleSelect(country: PhoneCountry): void {
    onChange(country.dialCode);
    close();
  }

  // aria-label (not a <label for>, which a button's own subtree content would win over per the
  // accessible-name spec, silencing the selected value) - states the field's purpose *and*
  // current selection together, since the trigger sits flush beside the phone number input
  // under one shared visible "Phone number" label rather than having its own visible caption.
  const triggerLabel = selected
    ? `${label}, ${selected.name} ${selected.dialCode}`
    : `${label}, no code selected`;

  return (
    <div className="at-field phone-country-select" ref={rootRef}>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className="phone-country-select__trigger"
        disabled={disabled}
        aria-expanded={open}
        aria-label={triggerLabel}
        onClick={() => setOpen((current) => !current)}
      >
        {selected ? (
          <>
            <span className="phone-country-select__flag" aria-hidden="true">{selected.flag}</span>
            <span>{selected.dialCode}</span>
          </>
        ) : (
          <span className="phone-country-select__placeholder">No code</span>
        )}
        <i className="ti ti-chevron-down phone-country-select__chevron" aria-hidden="true" />
      </button>
      {open && (
        <div
          className={`phone-country-select__panel${openUpward ? " phone-country-select__panel--up" : ""}`}
          ref={panelRef}
          style={panelStyle}
        >
          <input
            type="text"
            id={`${id}-search`}
            name={`${id}-search`}
            className="phone-country-select__search"
            placeholder="Search country or code"
            aria-label="Search country or dial code"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results.length > 0) {
                e.preventDefault();
                handleSelect(results[0]!);
              }
            }}
          />
          <ul className="phone-country-select__list" aria-label="Countries">
            {results.length === 0 ? (
              <li className="phone-country-select__empty">No countries match.</li>
            ) : (
              results.map((c) => (
                <li key={c.iso2}>
                  <button
                    type="button"
                    className="phone-country-select__option"
                    aria-label={`${c.name} ${c.dialCode}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelect(c)}
                  >
                    <span className="phone-country-select__flag" aria-hidden="true">{c.flag}</span>
                    <span className="phone-country-select__name">{c.name}</span>
                    <span className="phone-country-select__code">{c.dialCode}</span>
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
