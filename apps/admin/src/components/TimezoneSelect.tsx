/**
 * Searchable timezone picker backed by the full IANA tz database.
 *
 * Default browse order: west → east by current UTC offset (not alphabetical).
 * Search: city, country alias, region, abbreviation, or numeric offset.
 */
import {
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { useClickOutside, type OutsideInteraction } from "./useClickOutside.js";
import { attachFixedOverlayLifecycle } from "../utils/fixed-overlay-lifecycle.js";

/** Worst-case open panel height (search + hint + 16rem list + chrome) for pre-open estimate. */
const TIMEZONE_PANEL_MAX_ESTIMATE_PX = 352;
const PANEL_GAP_PX = 6;
const VIEWPORT_PAD_PX = 8;

const HIDDEN_FIXED_PANEL: CSSProperties = {
  position: "fixed",
  visibility: "hidden",
  zIndex: 1100,
};

interface TzEntry {
  iana: string;
  city: string;
  abbr: string;
  offsetLabel: string;
  offsetHours: number;
  searchText: string;
}

type TimezoneListItem =
  | { kind: "group"; id: string; label: string }
  | { kind: "option"; id: string; entry: TzEntry; optionIndex: number };

const FALLBACK_TIMEZONES = [
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Warsaw",
  "Europe/Moscow",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Asia/Dubai",
  "Asia/Calcutta",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Australia/Sydney",
  "Pacific/Auckland",
];

const MAX_SEARCH_RESULTS = 120;

const RUSSIA_IANAS = [
  "Europe/Kaliningrad",
  "Europe/Moscow",
  "Europe/Samara",
  "Europe/Volgograd",
  "Asia/Yekaterinburg",
  "Asia/Omsk",
  "Asia/Novosibirsk",
  "Asia/Krasnoyarsk",
  "Asia/Irkutsk",
  "Asia/Yakutsk",
  "Asia/Vladivostok",
  "Asia/Magadan",
  "Asia/Sakhalin",
  "Asia/Kamchatka",
  "Asia/Anadyr",
];

const INDIA_SEARCH_ALIASES = [
  "india",
  "indian",
  "delhi",
  "mumbai",
  "bombay",
  "bangalore",
  "chennai",
  "kolkata",
  "calcutta",
  "hyderabad",
  "pune",
  "ist",
];

/** Extra search terms for common country/city queries not present in IANA paths. */
const IANA_SEARCH_ALIASES: Record<string, string[]> = {
  "Asia/Kolkata": INDIA_SEARCH_ALIASES,
  "Asia/Calcutta": INDIA_SEARCH_ALIASES,
  "Europe/Warsaw": ["poland", "polish", "krakow", "wroclaw", "gdansk"],
  "Europe/Moscow": ["russia", "russian", "moscow", "msk"],
  "Europe/London": ["uk", "britain", "british", "england", "gmt", "bst"],
  "Europe/Berlin": ["germany", "german", "deutschland", "munich", "frankfurt"],
  "Europe/Paris": ["france", "french", "cet"],
  "America/New_York": ["usa", "us", "eastern", "nyc", "newyork"],
  "America/Los_Angeles": ["pacific", "la", "california", "westcoast"],
  "America/Chicago": ["central", "chicago"],
  "Asia/Dubai": ["uae", "emirates", "dubai"],
  "Asia/Tokyo": ["japan", "japanese", "jst"],
  "Asia/Shanghai": ["china", "chinese", "beijing", "shanghai", "cst"],
  "Asia/Singapore": ["singapore", "sgt"],
  "Asia/Bangkok": ["thailand", "thai"],
  "Asia/Seoul": ["korea", "korean", "southkorea"],
  "Australia/Sydney": ["australia", "australian", "aest"],
  "Africa/Cairo": ["egypt", "egyptian"],
  "Africa/Johannesburg": ["southafrica"],
  "America/Toronto": ["canada", "canadian", "toronto"],
  "America/Mexico_City": ["mexico", "mexican"],
  "America/Sao_Paulo": ["brazil", "brazilian"],
};

/** Country/region search returns all relevant IANA zones, sorted by offset. */
const COUNTRY_SEARCH_BUNDLES: Record<string, string[]> = {
  russia: RUSSIA_IANAS,
  russian: RUSSIA_IANAS,
  india: ["Asia/Calcutta", "Asia/Kolkata"],
  indian: ["Asia/Calcutta", "Asia/Kolkata"],
};

function buildTzEntry(iana: string, now: Date): TzEntry {
  const abbrParts = new Intl.DateTimeFormat("en", {
    timeZone: iana,
    timeZoneName: "short",
  }).formatToParts(now);
  const abbr = abbrParts.find((p) => p.type === "timeZoneName")?.value ?? "";

  const offsetParts = new Intl.DateTimeFormat("en", {
    timeZone: iana,
    timeZoneName: "shortOffset",
  }).formatToParts(now);
  const offsetRaw =
    offsetParts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  // Product convention: always show numeric offsets as UTC±N (not GMT), same as event-dates.
  const offsetLabel = offsetRaw.replace(/^GMT/i, "UTC");

  // eslint-disable-next-line security/detect-unsafe-regex -- bounded input; validated pattern
  const m = /(?:GMT|UTC)([+-])(\d+)(?::(\d+))?/i.exec(offsetRaw);
  const offsetSign = m?.[1] === "+" ? 1 : -1;
  const offsetHours = m
    ? offsetSign *
      (Number.parseInt(m[2] ?? "0", 10) + Number.parseInt(m[3] ?? "0", 10) / 60)
    : 0;

  const segments = iana.split("/");
  const city = (segments.at(-1) ?? iana).replaceAll("_", " ");
  const aliases = IANA_SEARCH_ALIASES[iana] ?? [];

  const searchText = [
    iana,
    city,
    segments[0] ?? "",
    abbr,
    offsetLabel,
    offsetRaw,
    offsetLabel.replace(/^UTC/i, ""),
    offsetRaw.replace(/^GMT/i, ""),
    ...aliases,
  ]
    .join(" ")
    .toLowerCase()
    .replace(/\s/g, "");

  return { iana, city, abbr, offsetLabel, offsetHours, searchText };
}

function sortByOffset(entries: TzEntry[]): TzEntry[] {
  return [...entries].sort((a, b) => {
    if (a.offsetHours !== b.offsetHours) return a.offsetHours - b.offsetHours;
    return a.city.localeCompare(b.city, undefined, { sensitivity: "base" });
  });
}

function buildTzIndex(): TzEntry[] {
  const now = new Date();
  const ianaList =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : FALLBACK_TIMEZONES;
  const entries = ianaList.map((iana) => buildTzEntry(iana, now));
  if (!entries.some((e) => e.iana === "UTC")) {
    entries.push(buildTzEntry("UTC", now));
  }
  return sortByOffset(entries);
}

let tzIndex: TzEntry[] | null = null;

function getTzIndex(): TzEntry[] {
  tzIndex ??= buildTzIndex();
  return tzIndex;
}

function entriesForIanas(index: TzEntry[], ianas: string[]): TzEntry[] {
  const out: TzEntry[] = [];
  const seen = new Set<string>();
  for (const iana of ianas) {
    const entry = findTzEntry(index, iana);
    if (entry && !seen.has(entry.iana)) {
      seen.add(entry.iana);
      out.push(entry);
    }
  }
  return sortByOffset(out);
}

function searchTz(index: TzEntry[], query: string): TzEntry[] {
  const q = query.trim().toLowerCase().replace(/\s/g, "");
  if (!q) return index;

  const bundle = COUNTRY_SEARCH_BUNDLES[q];
  if (bundle) {
    return entriesForIanas(index, bundle);
  }

  // eslint-disable-next-line security/detect-unsafe-regex -- bounded input; validated pattern
  const om = /^(gmt)?([+-])(\d{1,2})(?:[:.，,](\d{1,2}))?$/.exec(q);
  if (om) {
    const sign = om[2] === "+" ? 1 : -1;
    const h = Number.parseInt(om[3] ?? "0", 10);
    const rawMin = Number.parseInt(om[4] ?? "0", 10);
    const fractHours = sign * (h + (rawMin > 5 ? rawMin / 60 : rawMin / 10));
    return sortByOffset(index.filter((e) => Math.abs(e.offsetHours - fractHours) < 0.09));
  }

  const matches = index.filter((e) => e.searchText.includes(q));
  const aliasPriority = matches.filter((e) =>
    (IANA_SEARCH_ALIASES[e.iana] ?? []).some((alias) => alias.replace(/\s/g, "") === q),
  );
  const aliasIanas = new Set(aliasPriority.map((e) => e.iana));
  const rest = sortByOffset(matches.filter((e) => !aliasIanas.has(e.iana)));
  return [...sortByOffset(aliasPriority), ...rest].slice(0, MAX_SEARCH_RESULTS);
}

function findTzEntry(index: TzEntry[], iana: string): TzEntry | undefined {
  const direct = index.find((e) => e.iana === iana);
  if (direct) return direct;
  if (iana === "Asia/Kolkata") return index.find((e) => e.iana === "Asia/Calcutta");
  if (iana === "Asia/Calcutta") return index.find((e) => e.iana === "Asia/Kolkata");
  return undefined;
}

function ensureSelectedInOptions(
  options: TzEntry[],
  value: string,
  index: TzEntry[],
  searching: boolean,
): TzEntry[] {
  if (!value || options.some((e) => e.iana === value)) return options;
  if (searching) return options;
  const entry = findTzEntry(index, value);
  if (entry) return sortByOffset([entry, ...options]);
  return sortByOffset([
    {
      iana: value,
      city: value.replaceAll("_", " "),
      abbr: value,
      offsetLabel: "UTC+0",
      offsetHours: 0,
      searchText: value.toLowerCase(),
    },
    ...options,
  ]);
}

function buildListItems(entries: TzEntry[], grouped: boolean): TimezoneListItem[] {
  if (!grouped) {
    return entries.map((entry, optionIndex) => ({
      kind: "option" as const,
      id: entry.iana,
      entry,
      optionIndex,
    }));
  }

  const items: TimezoneListItem[] = [];
  let lastOffset: number | null = null;
  let optionIndex = 0;
  for (const entry of entries) {
    if (entry.offsetHours !== lastOffset) {
      lastOffset = entry.offsetHours;
      items.push({
        kind: "group",
        id: `group-${entry.offsetHours}`,
        label: entry.offsetLabel,
      });
    }
    items.push({ kind: "option", id: entry.iana, entry, optionIndex });
    optionIndex += 1;
  }
  return items;
}

interface TimezoneSelectProps {
  value: string;
  onChange: (tz: string) => void;
  disabled?: boolean;
  id?: string;
  required?: boolean;
  /** Single-line trigger label (wizard / tight forms). */
  compact?: boolean;
  /** Optional help text under the control (plain language for IANA zone IDs). */
  hint?: string;
}

export function TimezoneSelect({
  value,
  onChange,
  disabled,
  id,
  required,
  compact = false,
  hint,
}: Readonly<TimezoneSelectProps>) {
  const autoId = useId();
  const controlId = id ?? `tz-${autoId}`;
  const listboxId = `${controlId}-listbox`;
  const hintId = hint ? `${controlId}-hint` : undefined;

  const [open, setOpen] = useState(false);
  const [panelAbove, setPanelAbove] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>(HIDDEN_FIXED_PANEL);
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const deferred = useDeferredValue(query);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const index = getTzIndex();
  const searching = Boolean(deferred.trim());

  const options = useMemo(() => {
    const base = searching ? searchTz(index, deferred) : index;
    return ensureSelectedInOptions(base, value, index, searching);
  }, [deferred, index, searching, value]);

  const listItems = useMemo(
    () => buildListItems(options, !searching),
    [options, searching],
  );

  const optionCount = options.length;
  const activeDescendantId =
    optionCount > 0 ? `${listboxId}-option-${highlightIndex}` : undefined;

  const selectedEntry = value ? findTzEntry(index, value) : undefined;

  // `reason === "focus"` / `"scroll"`: do not steal focus back (Tab already moved on, or an
  // ancestor scroll closed the fixed panel — refocusing would undo that scroll).
  const closePanel = (reason?: OutsideInteraction) => {
    setOpen(false);
    setQuery("");
    setPanelStyle(HIDDEN_FIXED_PANEL);
    if (reason !== "focus" && reason !== "scroll") {
      window.setTimeout(() => triggerRef.current?.focus(), 0);
    }
  };

  useEffect(() => {
    if (!open) return;
    const selectedIdx = options.findIndex((e) => e.iana === value);
    setHighlightIndex(Math.max(selectedIdx, 0));
    const t = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open, value, options]);

  useClickOutside(containerRef, open, closePanel);

  useEffect(() => {
    if (!open) return;
    const item = listRef.current?.querySelector(
      `[data-option-index="${highlightIndex}"]`,
    ) as HTMLElement | undefined;
    item?.scrollIntoView?.({ block: "nearest" });
  }, [highlightIndex, open]);

  useLayoutEffect(() => {
    if (!open || !containerRef.current || !panelRef.current) return;
    const updatePlacement = () => {
      // Panel only mounts while open, and open is driven from the trigger button.
      const trigger = triggerRef.current!;
      const rect = trigger.getBoundingClientRect();
      const panel = panelRef.current!;
      // scrollHeight (natural content), not offsetHeight — a prior maxHeight clamp would make
      // offsetHeight look like the panel already fits and drop the clamp on the next query.
      const panelHeight = panel.scrollHeight;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const above =
        spaceBelow < panelHeight + PANEL_GAP_PX && spaceAbove > spaceBelow;
      const available = (above ? spaceAbove : spaceBelow) - PANEL_GAP_PX - VIEWPORT_PAD_PX;
      const maxHeight = panelHeight > available ? Math.max(200, available) : undefined;
      const usedHeight = Math.min(panelHeight, maxHeight ?? panelHeight);
      const top = above
        ? rect.top - usedHeight - PANEL_GAP_PX
        : rect.bottom + PANEL_GAP_PX;
      const width = Math.max(rect.width, containerRef.current!.getBoundingClientRect().width);
      let left = rect.left;
      left = Math.min(left, window.innerWidth - VIEWPORT_PAD_PX - width);
      left = Math.max(left, VIEWPORT_PAD_PX);

      setPanelAbove(above);
      setPanelStyle({
        position: "fixed",
        top,
        left,
        width,
        maxHeight,
        overflowY: maxHeight ? "auto" : undefined,
        visibility: "visible",
        zIndex: 1100,
      });
    };
    updatePlacement();
    return attachFixedOverlayLifecycle(panelRef.current, updatePlacement, () =>
      closePanel("scroll"),
    );
  }, [open, optionCount, query]);

  const openPanel = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setPanelAbove(
        spaceBelow < TIMEZONE_PANEL_MAX_ESTIMATE_PX + PANEL_GAP_PX && spaceAbove > spaceBelow,
      );
    } else {
      setPanelAbove(false);
    }
    setPanelStyle(HIDDEN_FIXED_PANEL);
    setOpen(true);
  };
  const selectOption = (entry: TzEntry) => {
    onChange(entry.iana);
    closePanel();
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePanel();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, Math.max(optionCount - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (event.key === "Enter" && options[highlightIndex]) {
      event.preventDefault();
      selectOption(options[highlightIndex]);
    }
  };

  const selectedTriggerContent = selectedEntry ? (
    <span className="timezone-select__trigger-line">
      <span className="timezone-select__trigger-city">{selectedEntry.city}</span>
      <span className="timezone-select__trigger-meta">
        {selectedEntry.iana}
        {selectedEntry.offsetLabel ? ` · ${selectedEntry.offsetLabel}` : ""}
      </span>
    </span>
  ) : (
    <span className="timezone-select__trigger-placeholder">Select timezone…</span>
  );

  const triggerLabel = selectedTriggerContent;

  return (
    <div
      className={["timezone-select", compact && "timezone-select--compact"].filter(Boolean).join(" ")}
      ref={containerRef}
    >
      <button
        ref={triggerRef}
        type="button"
        id={controlId}
        className="timezone-select__trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-describedby={hintId}
        onClick={() => {
          // `disabled` is enforced by the button attribute — no click handler when disabled.
          if (open) {
            setOpen(false);
            return;
          }
          openPanel();
        }}
      >
        <span className="timezone-select__trigger-text">{triggerLabel}</span>
        <i className="ti ti-chevron-down timezone-select__chevron" aria-hidden="true" />
      </button>

      {hint ? (
        <span id={hintId} className="at-hint">
          {hint}
        </span>
      ) : null}

      {open && (
        <div
          ref={panelRef}
          className={[
            "timezone-select__panel",
            panelAbove && "timezone-select__panel--above",
          ]
            .filter(Boolean)
            .join(" ")}
          style={panelStyle}
        >
          <input
            ref={searchRef}
            type="search"
            className="at-input timezone-select__search"
            placeholder="Search city, country or offset (e.g. Moscow, India, +5:30)…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlightIndex(0);
            }}
            onKeyDown={onSearchKeyDown}
            disabled={disabled}
            aria-label="Search timezones"
            aria-controls={listboxId}
            aria-activedescendant={activeDescendantId}
            autoComplete="off"
          />
          {!searching && (
            <p className="timezone-select__hint">
              Sorted west to east by UTC offset · type to filter
            </p>
          )}
          {/* Shell clips the native scrollbar to the rounded corner (same pattern as
              .identity-modal__panel -> .identity-modal__scroll). */}
          <div className="timezone-select__list-shell">
            <ul
              id={listboxId}
              ref={listRef}
              role="listbox"
              className="timezone-select__list"
              aria-label="Select timezone"
            >
              {optionCount === 0 ? (
                <li className="timezone-select__empty" role="presentation">
                  No matching timezones
                </li>
              ) : (
                listItems.map((item) =>
                  item.kind === "group" ? (
                    <li key={item.id} className="timezone-select__group" role="presentation">
                      {item.label}
                    </li>
                  ) : (
                    <li // NOSONAR — mouse-only click convenience; keyboard selection already works via the search input's onKeyDown (Enter selects the highlighted option, see onSearchKeyDown above)
                      key={item.id}
                      id={`${listboxId}-option-${item.optionIndex}`}
                      role="option"
                      data-option-index={item.optionIndex}
                      aria-selected={item.entry.iana === value}
                      className={[
                        "timezone-select__option",
                        item.entry.iana === value && "timezone-select__option--selected",
                        item.optionIndex === highlightIndex && "timezone-select__option--highlighted",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onMouseEnter={() => setHighlightIndex(item.optionIndex)}
                      onClick={() => selectOption(item.entry)}
                    >
                      <span className="timezone-select__option-row">
                        <span className="timezone-select__option-city">{item.entry.city}</span>
                        <span className="timezone-select__option-iana">{item.entry.iana}</span>
                        {searching && item.entry.offsetLabel ? (
                          <span className="timezone-select__option-offset">{item.entry.offsetLabel}</span>
                        ) : null}
                      </span>
                    </li>
                  ),
                )
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
