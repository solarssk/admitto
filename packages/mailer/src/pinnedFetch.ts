import type { LookupAddress } from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";

/**
 * Fetch with the outbound TCP connection pinned to an already-validated address (see
 * ssrfGuard.ts / @admitto/shared's ssrf-guard) while keeping the original hostname for the
 * Host header / TLS SNI. Without this, `fetch` would re-resolve the hostname itself at
 * connect time — a second, separate DNS lookup that a rebinding attacker can answer
 * differently from the validation lookup that produced `record`. Used by every server-side
 * fetch whose destination is operator/admin-controlled (Power Automate webhook, weather and
 * geocoding base URLs). Always sends `redirect: "error"` — a redirect to a blocked target
 * must not be followed.
 *
 * Takes a `handler` rather than returning the raw Response: `dispatcher.close()` in the
 * `finally` block waits for the request to fully complete, which for a response whose
 * body is never read means it waits forever — the caller must consume the body inside
 * `handler`, before this function (and its `finally`) returns.
 */
export async function withPinnedFetch<T>(
  url: string | URL,
  hostname: string,
  record: LookupAddress,
  init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
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
