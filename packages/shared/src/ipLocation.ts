import { isIP } from "node:net";
import { lookup } from "ip-location-api";
import { isBlockedPrivateOrMetadataHost } from "./ssrfGuard.js";

export type IpLocationKind = "internal" | "resolved" | "unknown";

export interface IpLocation {
  kind: IpLocationKind;
  countryCode?: string;
}

/**
 * IP -> country. Lives here (not apps/web, where it originated) so packages/auth can call it too
 * without depending on apps/web - the wrong direction for a foundational package to depend in
 * (same move already made for resolveInstanceOrganizationId, see packages/db/src/instanceOrg.ts).
 * apps/web/src/rate-limit/ip-location.ts re-exports this verbatim for its existing callers
 * (audit/security-audit/sessions/account routes, always computed at response time from an
 * already-stored `ip` column, never persisted); packages/auth's new-country-login.ts is the
 * second, newer caller.
 *
 * Backed by the offline, PDDL/CDLA-Permissive-licensed `ip-location-db` "user" dataset
 * (ILA_IP_LOCATION_DB=user, see apps/web/.env.example and the Dockerfile) rather than
 * ip-location-api's default MaxMind GeoLite2 mode, which requires an account/license key. Never
 * makes a network call at request time, never throws: a lookup miss or failure degrades to
 * "unknown" rather than breaking the caller's own flow (an audit-log/sessions response, or a
 * login).
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
    const resolved = result as { country?: string } | null;
    return resolved?.country ? { kind: "resolved", countryCode: resolved.country } : { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  }
}
