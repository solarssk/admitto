import type { LookupAddress } from "node:dns";
import { fetch as undiciFetch } from "undici";
import { createPinnedDispatcher, isConnectFailure } from "@admitto/shared/pinned-dispatcher";

/**
 * Fetch with the outbound TCP connection pinned to an already-validated address (see
 * ssrfGuard.ts / @admitto/shared's ssrf-guard) while keeping the original hostname for the
 * Host header / TLS SNI. Without this, `fetch` would re-resolve the hostname itself at
 * connect time — a second, separate DNS lookup that a rebinding attacker can answer
 * differently from the validation lookup that produced `records`. Used by every server-side
 * fetch whose destination is operator/admin-controlled (Power Automate webhook, weather and
 * geocoding base URLs). Always sends `redirect: "error"` — a redirect to a blocked target
 * must not be followed.
 *
 * Tries each of `records` in turn on a connect-level failure (refused/unreachable/timed out —
 * see {@link isConnectFailure}) before giving up, so one unreachable validated address (e.g.
 * an IPv6 record on a host without working IPv6) doesn't fail the request when another
 * resolved address would work — same as the OIDC pinned fetch. An error thrown by `handler`
 * (an HTTP-level failure, already a Response) is never treated as a reason to retry.
 *
 * Defaults to `redirect: "error"` — a redirect to a blocked target must not be followed blindly.
 * Pass `redirect: "manual"` when the caller re-validates and re-pins each hop itself (e.g. a
 * tile fetcher following a same-origin-checked redirect chain).
 *
 * Takes a `handler` rather than returning the raw Response: `dispatcher.close()` waits for
 * the request to fully complete, which for a response whose body is never read means it
 * waits forever — the caller must consume the body inside `handler`, before this function
 * returns.
 */
export async function withPinnedFetch<T>(
  url: string | URL,
  hostname: string,
  records: LookupAddress[],
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    redirect?: "error" | "manual";
  },
  handler: (res: Response) => Promise<T>,
): Promise<T> {
  let lastConnectError: unknown;
  for (const record of records) {
    const dispatcher = createPinnedDispatcher(hostname, record);
    let res: Response;
    try {
      res = (await undiciFetch(url, {
        ...init,
        redirect: init.redirect ?? "error",
        dispatcher,
      } as Parameters<typeof undiciFetch>[1])) as unknown as Response;
    } catch (err) {
      await dispatcher.close();
      if (!isConnectFailure(err)) throw err;
      lastConnectError = err;
      continue;
    }
    try {
      return await handler(res);
    } finally {
      await dispatcher.close();
    }
  }
  throw lastConnectError instanceof Error
    ? lastConnectError
    : new Error("pinned fetch: no validated address was reachable");
}
