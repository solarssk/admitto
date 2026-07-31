import { isIP } from "node:net";
import { lookup } from "ip-location-api";
import { isBlockedPrivateOrMetadataHost } from "@admitto/shared/ssrf-guard";

export type IpLocationKind = "internal" | "resolved" | "unknown";

export interface IpLocation {
  kind: IpLocationKind;
  countryCode?: string;
}

/**
 * IP -> country, computed at API-response time from an already-stored `ip` column — never
 * persisted, no schema change. Backed by the offline, PDDL/CDLA-Permissive-licensed
 * `ip-location-db` "user" dataset (ILA_IP_LOCATION_DB=user, see .env.example) rather than
 * ip-location-api's default MaxMind GeoLite2 mode, which requires an account/license key. Never
 * makes a network call at request time, never throws: a lookup miss or failure degrades to
 * "unknown" rather than breaking the audit-log/sessions response.
 */
export function resolveIpLocation(ip: string | null): IpLocation {
  if (!ip || !isIP(ip)) return { kind: "unknown" };
  if (isBlockedPrivateOrMetadataHost(ip)) return { kind: "internal" };

  try {
    // lookup()'s declared type covers ip-location-api's async (ILA_SMALL_MEMORY) mode too; this
    // app never sets that env var, so the call is always synchronous in practice.
    const result = lookup(ip) as { country?: string } | null;
    return result?.country ? { kind: "resolved", countryCode: result.country } : { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  }
}
