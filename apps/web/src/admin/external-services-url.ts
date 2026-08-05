/**
 * SSRF checks for Organisation Settings → External services URLs that the web
 * process later fetches (Open-Meteo base URL, Nominatim geocoding base URL).
 * Literal private/loopback/link-local hosts are rejected immediately; hostnames
 * are DNS-resolved and rechecked before persist or probe.
 */

import {
  isBlockedPrivateOrMetadataHost,
  isLoopbackHost,
  resolveSafeHostname,
  SafeHostnameError,
  unbracketHostname,
} from "@admitto/shared/ssrf-guard";

export type EditableServiceUrlError =
  | "invalid_url"
  | "url_host_blocked"
  | "url_host_unresolved";

/**
 * Validate an operator-editable http(s) URL used for server-side fetches.
 * Does not pin the later fetch (TOCTOU remains); closes obvious private-host
 * and DNS-rebinding-to-private cases at save/probe time.
 */
export async function assertEditableServiceUrl(
  raw: string,
): Promise<{ ok: true; href: string } | { ok: false; code: EditableServiceUrlError }> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, code: "invalid_url" };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, code: "invalid_url" };
  }
  if (url.username || url.password) {
    return { ok: false, code: "invalid_url" };
  }

  const host = unbracketHostname(url.hostname);
  if (!host) {
    return { ok: false, code: "invalid_url" };
  }
  if (isLoopbackHost(host) || isBlockedPrivateOrMetadataHost(host)) {
    return { ok: false, code: "url_host_blocked" };
  }

  try {
    await resolveSafeHostname(host);
  } catch (err) {
    if (err instanceof SafeHostnameError) {
      return {
        ok: false,
        code: err.code === "hostname_unresolved" ? "url_host_unresolved" : "url_host_blocked",
      };
    }
    return { ok: false, code: "url_host_unresolved" };
  }

  return { ok: true, href: url.href };
}
