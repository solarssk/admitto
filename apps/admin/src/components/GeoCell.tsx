import type { IpLocationDto } from "../api/types.js";
import { getPreferredLocale } from "../utils/locale-store.js";

function flagEmoji(countryCode: string): string {
  return String.fromCodePoint(...[...countryCode.toUpperCase()].map((c) => 127397 + (c.codePointAt(0) ?? 0)));
}

function countryDisplayName(countryCode: string): string {
  try {
    return new Intl.DisplayNames([getPreferredLocale() ?? "en"], { type: "region" }).of(countryCode.toUpperCase()) ?? countryCode;
  } catch {
    return countryCode;
  }
}

/** Plain-text form of a GeoCell, for row-copy-as-text builders. Empty when there's nothing to
 * say (offline dataset has no entry for this IP) - callers skip the whole "(...)" suffix then. */
export function geoLocationText(location: IpLocationDto): string {
  if (location.kind === "internal") return "Internal network";
  if (location.kind === "resolved" && location.countryCode) return countryDisplayName(location.countryCode);
  return "";
}

/** Renders next to an IP address: "Internal network" for a private/loopback address, or a flag +
 * country name for a resolved public one. Renders nothing when the offline dataset has no entry
 * for this IP, rather than a placeholder "-" - the IP address itself is still shown either way. */
export function GeoCell({ location }: Readonly<{ location: IpLocationDto }>) {
  if (location.kind === "internal") {
    return (
      <span className="geo-cell">
        <i className="ti ti-building" aria-hidden="true" /> Internal network
      </span>
    );
  }
  if (location.kind === "resolved" && location.countryCode) {
    return (
      <span className="geo-cell">
        <span className="geo-cell__flag" aria-hidden="true">{flagEmoji(location.countryCode)}</span> {countryDisplayName(location.countryCode)}
      </span>
    );
  }
  return null;
}
