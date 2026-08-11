import { Agent } from "undici";

/**
 * Minimal address shape both `node:dns`'s `LookupAddress` and callers' own resolved-record
 * types satisfy structurally — this module doesn't need the rest of either shape.
 */
export interface PinnableAddress {
  address: string;
  family: number;
}

/**
 * True for a genuine connect-level failure (refused, unreachable, timed out) as opposed to
 * an HTTP-level response (which never throws) or an application error thrown after a real
 * response was received. Shared by every connect-time-pinned fetch (OIDC/Cloudflare Access,
 * mail transport, weather/geocoding) so only these count as "try the next validated address".
 */
export function isConnectFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  if (
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ENETUNREACH" ||
    code === "EHOSTUNREACH" ||
    code === "EPERM"
  ) {
    return true;
  }
  const cause = (err as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) {
    return isConnectFailure(cause);
  }
  return err.message.toLowerCase().includes("fetch failed");
}

/**
 * Pin connect-time DNS to a validated address while keeping the original hostname for the
 * Host header / TLS SNI. Without this, `fetch` would re-resolve the hostname itself at
 * connect time — a second, separate DNS lookup a rebinding attacker could answer differently
 * from the validation lookup that produced `record`.
 */
export function createPinnedDispatcher(hostname: string, record: PinnableAddress): Agent {
  return new Agent({
    connect: {
      servername: hostname,
      lookup: (_host, options, callback) => {
        if (options.all) {
          (callback as (err: null, addresses: { address: string; family: number }[]) => void)(
            null,
            [{ address: record.address, family: record.family }],
          );
        } else {
          callback(null, record.address, record.family);
        }
      },
    },
  });
}
