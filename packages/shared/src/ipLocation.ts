import { isIP } from "node:net";
import { lookup } from "ip-location-api";
import { isBlockedPrivateOrMetadataHost } from "./ssrfGuard.js";

export type IpLocationKind = "internal" | "resolved" | "unknown";

export interface IpLocation {
  kind: IpLocationKind;
  countryCode?: string;
  /** City name, when the configured dataset resolves one (ILA_FIELDS=country,city, see
   * apps/web/.env.example and the Dockerfile) - absent for a country-only lookup result, or when
   * the dataset has no city entry for this specific IP (rural/carrier-grade-NAT ranges commonly
   * resolve to country only even in the City edition). Never present without `countryCode` also
   * being present. */
  city?: string;
}

/**
 * IP -> country (and city, when the configured dataset resolves one). Lives here (not apps/web,
 * where it originated) so packages/auth can call it too without depending on apps/web - the wrong
 * direction for a foundational package to depend in (same move already made for
 * resolveInstanceOrganizationId, see packages/db/src/instanceOrg.ts). apps/web/src/rate-limit/
 * ip-location.ts re-exports this verbatim for its existing callers (audit/security-audit/
 * sessions/account routes, always computed at response time from an already-stored `ip` column,
 * never persisted); packages/auth's new-country-login.ts is the second, newer caller.
 *
 * Backed by MaxMind's GeoLite2 City database, downloaded from the node-geolite2-redist community
 * mirror (ILA_LICENSE_KEY=redist, ip-location-api's own default) rather than requiring our own
 * MaxMind account/license key - see THIRD-PARTY-NOTICES.md for the CC BY-SA 4.0 attribution this
 * data carries. ILA_FIELDS=country,city (see apps/web/.env.example and the Dockerfile) is what
 * actually selects the City edition over the lighter Country-only one; `country` alone resolves
 * the ~7MB Country edition regardless of ILA_LICENSE_KEY. Never makes a network call at request
 * time, never throws: a lookup miss or failure degrades to "unknown" rather than breaking the
 * caller's own flow (an audit-log/sessions response, or a login).
 */
export function resolveIpLocation(ip: string | null): IpLocation {
  if (!ip || !isIP(ip)) return { kind: "unknown" };
  if (isBlockedPrivateOrMetadataHost(ip)) return { kind: "internal" };

  try {
    // lookup()'s declared type covers ip-location-api's async (ILA_SMALL_MEMORY=true) mode too;
    // this repo never sets that env var, so the call is always synchronous in practice - but if a
    // deployment sets it anyway, lookup() returns a Promise instead of a result, and the type
    // cast below would otherwise silently treat that Promise as a `{country?: string} | null`
    // with no `country` property, permanently returning "unknown" for every IP with no error or
    // diagnostic trail (bot review finding). Detect that shape explicitly and fail loudly instead.
    const result: unknown = lookup(ip);
    if (result && typeof (result as { then?: unknown }).then === "function") {
      console.error(
        "resolveIpLocation: ip-location-api's lookup() returned a Promise - ILA_SMALL_MEMORY=true "
          + "(async mode) is not supported here. Country resolution is disabled until it's unset.",
      );
      return { kind: "unknown" };
    }
    const resolved = result as { country?: string; city?: string } | null;
    if (!resolved?.country) return { kind: "unknown" };
    return { kind: "resolved", countryCode: resolved.country, city: resolved.city || undefined };
  } catch {
    return { kind: "unknown" };
  }
}
