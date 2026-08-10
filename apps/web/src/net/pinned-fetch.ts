/**
 * Fetch with the outbound TCP connection pinned to an already-resolved, SSRF-validated
 * address (see `resolveSafeHostname` in `@admitto/shared/ssrf-guard`) — same connect-time
 * pinning pattern as `packages/auth/src/oidc/safe-oidc-fetch.ts` and the mailer's
 * `withPinnedFetch` in `packages/mailer/src/adapters/powerAutomate.ts`.
 *
 * Save-time host validation (see `admin/external-services-url.ts`) is not enough on its own:
 * a DNS-rebinding attacker can repoint an already-approved hostname to a private/metadata
 * address after the check passes, and a second, separate DNS lookup at connect time (plain
 * `fetch`'s default) would resolve it fresh and land on the new, unvalidated address. Pinning
 * the connection to the address resolved immediately before this call closes that gap.
 * Always sends `redirect: "error"` — a redirect to a blocked target must not be followed.
 *
 * `handler` must fully consume `res`'s body before returning: `dispatcher.close()` in the
 * `finally` block waits for the request to complete, which never happens for an unread body.
 */
import type { LookupAddress } from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";

export async function withPinnedFetch<T>(
  url: URL,
  hostname: string,
  record: LookupAddress,
  init: { method?: string; headers?: Record<string, string>; signal?: AbortSignal },
  handler: (res: Response) => Promise<T>,
): Promise<T> {
  const dispatcher = new Agent({
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
  try {
    const res = (await undiciFetch(url, {
      ...init,
      redirect: "error",
      dispatcher,
    } as Parameters<typeof undiciFetch>[1])) as unknown as Response;
    return await handler(res);
  } finally {
    await dispatcher.close();
  }
}
