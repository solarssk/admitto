interface SearchableSelectSearchBoxProps {
  id: string;
  searchPlaceholder: string;
  query: string;
  onQueryChange: (value: string) => void;
  /** Called on Enter regardless of whether anything is currently visible to act on - the
   * caller (which already has the filtered `results` list) decides whether Enter should do
   * anything. Not gating here is what SearchableSelect and MultiSelect actually differ on:
   * one selects-and-closes the top result, the other toggles it and stays open. */
  onEnter: () => void;
}

/** The optional search `<input>` shown inside a SearchableSelect/MultiSelect panel once its
 * option list is too long to scan by eye (SEARCH_THRESHOLD in both) - identical between the
 * two down to the Enter-key shortcut, so it lives here once instead of twice. */
export function SearchableSelectSearchBox({
  id,
  searchPlaceholder,
  query,
  onQueryChange,
  onEnter,
}: Readonly<SearchableSelectSearchBoxProps>) {
  return (
    <div className="at-control">
      <input
        type="text"
        id={`${id}-search`}
        name={`${id}-search`}
        className="searchable-select__search"
        placeholder={searchPlaceholder}
        aria-label={searchPlaceholder}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          onEnter();
        }}
      />
    </div>
  );
}
