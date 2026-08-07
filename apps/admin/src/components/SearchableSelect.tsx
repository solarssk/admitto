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

/** Above this option count, a search box earns its keep; at or below it, a short list (e.g. the
 * 4 possible staff roles) is faster to scan in full than to type into (PO report: a search field
 * with no indication of what it searches, on a 4-option list, read as pure friction). */
const SEARCH_THRESHOLD = 6;

interface SearchableSelectProps {
  id: string;
  label: string;
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  value: string;
  options: readonly SearchableSelectOption[];
  disabled?: boolean;
  /** Gives the trigger the same error border styling as `Input`'s own `invalid` prop
   * (`@admitto/ui`). Pair with `describedBy` pointing at the visible error text - unlike
   * `Input`'s native `<input>` (role `textbox`), this trigger is a `<button>`, and
   * `aria-invalid` isn't a supported property of role `button` (SonarCloud S6811), so the error
   * is conveyed to assistive tech via `aria-describedby` instead. */
  invalid?: boolean;
  /** Id of the element (usually the visible error message) this trigger's `aria-describedby`
   * should point at - see `invalid`'s own comment for why this replaces `aria-invalid` here. */
  describedBy?: string;
  /** Native tooltip on the trigger, e.g. explaining why the field is disabled. */
  title?: string;
  /** Floor for the panel's width, in px - default 260 fits most option sets, but a list of long
   * labels (e.g. audit log action names like "Bounce detection check run manually") truncates
   * more than is comfortable at that width even though it's technically working as designed
   * (PO report). Raise it per call site instead of widening the shared default for every short
   * list too. */
  minWidth?: number;
  /** False for callers that already render their own visible `<label htmlFor>` around this
   * field (e.g. a FiltersMenu panel's own field wrapper) - default true renders one here, since
   * most callers don't have one of their own (PO report: the Invite/Edit user role picker had
   * no visible caption at all). Either way the button's own aria-label (below) carries the
   * accessible name. */
  showLabel?: boolean;
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
  invalid,
  describedBy,
  title,
  showLabel = true,
  minWidth = 260,
  onChange,
}: Readonly<SearchableSelectProps>) {
  const { open, setOpen, close, openUpward, panelStyle, rootRef, triggerRef, panelRef } = useDropdownMenu<
    HTMLButtonElement,
    HTMLDivElement
  >({ align: "start", matchTriggerWidth: true, minWidth });
  const [query, setQuery] = useState("");
  const showSearch = options.length > SEARCH_THRESHOLD;

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const selected = value ? options.find((o) => o.id === value) : undefined;
  const normalizedQuery = showSearch ? query.trim().toLowerCase() : "";
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
      {/* Visible caption - the button's own aria-label above carries the accessible name (a
       * <label for> a button would lose to the button's own subtree content per the accname
       * spec), but sighted users still need to see what this field picks (PO report: "None"
       * with no caption gave no clue this was the role picker). Skipped when the caller already
       * renders its own (showLabel: false) - see that prop's own comment. */}
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
        aria-describedby={describedBy}
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
          style={panelStyle}
        >
          {showSearch && (
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
          )}
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
