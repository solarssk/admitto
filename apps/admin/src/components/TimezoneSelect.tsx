/**
 * Searchable timezone picker backed by the full IANA tz database.
 *
 * Supports searching by: city name, IANA path, abbreviation (CEST/JST/IST),
 * UTC offset (+9, +5:30, +5.5, GMT+2), or any substring of the IANA name.
 *
 * Uses Intl.supportedValuesOf('timeZone') when available — all ~590 canonical timezones.
 */
import { useDeferredValue, useMemo, useState } from "react";

interface TzEntry {
  iana: string;
  city: string;
  abbr: string;
  offsetLabel: string;
  offsetHours: number;
  searchText: string;
}

const FALLBACK_TIMEZONES = [
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Warsaw",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Australia/Sydney",
  "Pacific/Auckland",
];

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
  const offsetLabel =
    offsetParts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";

  const m = offsetLabel.match(/GMT([+-])(\d+)(?::(\d+))?/);
  const offsetHours = m
    ? (m[1] === "+" ? 1 : -1) * (parseInt(m[2] ?? "0", 10) + parseInt(m[3] ?? "0", 10) / 60)
    : 0;

  const segments = iana.split("/");
  const city = (segments.at(-1) ?? iana).replace(/_/g, " ");

  const searchText = [
    iana,
    city,
    segments[0] ?? "",
    abbr,
    offsetLabel,
    offsetLabel.replace("GMT", ""),
  ]
    .join(" ")
    .toLowerCase()
    .replace(/\s/g, "");

  return { iana, city, abbr, offsetLabel, offsetHours, searchText };
}

function buildTzIndex(): TzEntry[] {
  const now = new Date();
  const ianaList =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : FALLBACK_TIMEZONES;
  const entries = ianaList.map((iana) => buildTzEntry(iana, now));
  if (!entries.some((e) => e.iana === "UTC")) {
    entries.unshift(buildTzEntry("UTC", now));
  }
  return entries;
}

let tzIndex: TzEntry[] | null = null;

function getTzIndex(): TzEntry[] {
  return (tzIndex ??= buildTzIndex());
}

function searchTz(index: TzEntry[], query: string): TzEntry[] {
  const q = query.trim().toLowerCase().replace(/\s/g, "");
  if (!q) return index;

  const om = q.match(/^(gmt)?([+-])(\d{1,2})(?:[:.，,](\d{1,2}))?$/);
  if (om) {
    const sign = om[2] === "+" ? 1 : -1;
    const h = parseInt(om[3] ?? "0", 10);
    const rawMin = parseInt(om[4] ?? "0", 10);
    const fractHours = sign * (h + (rawMin > 5 ? rawMin / 60 : rawMin / 10));
    return index.filter((e) => Math.abs(e.offsetHours - fractHours) < 0.09);
  }

  return index.filter((e) => e.searchText.includes(q));
}

interface TimezoneSelectProps {
  value: string;
  onChange: (tz: string) => void;
  disabled?: boolean;
  id?: string;
  required?: boolean;
}

export function TimezoneSelect({
  value,
  onChange,
  disabled,
  id,
  required,
}: TimezoneSelectProps) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const index = getTzIndex();

  const filtered = useMemo(() => searchTz(index, deferred), [index, deferred]);

  const options = useMemo(() => {
    const inList = filtered.some((e) => e.iana === value);
    if (!inList && value) {
      const entry = index.find((e) => e.iana === value);
      if (entry) return [entry, ...filtered];
      return [
        {
          iana: value,
          city: value.replace(/_/g, " "),
          abbr: value,
          offsetLabel: "",
          offsetHours: 0,
          searchText: value.toLowerCase(),
        },
        ...filtered,
      ];
    }
    return filtered;
  }, [filtered, value, index]);

  const selectedEntry = value ? index.find((e) => e.iana === value) : undefined;

  return (
    <div className="timezone-select">
      <input
        type="search"
        className="form-control timezone-select__search"
        placeholder="Search by city, abbreviation or offset (e.g. Tokyo, CEST, +5:30)…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={disabled}
        aria-label="Search timezones"
        aria-controls={id}
        autoComplete="off"
      />
      <select
        id={id}
        className="form-select timezone-select__list"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        required={required}
        size={6}
        aria-label="Select timezone"
      >
        {options.map((e) => (
          <option key={e.iana} value={e.iana}>
            {e.city} ({e.abbr}, {e.offsetLabel})
          </option>
        ))}
      </select>
      {value && (
        <p className="form-text timezone-select__current">
          Selected: <strong>{value}</strong>
          {selectedEntry ? ` — ${selectedEntry.abbr}, ${selectedEntry.offsetLabel}` : ""}
        </p>
      )}
    </div>
  );
}
