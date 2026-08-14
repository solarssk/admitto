import type { Context, Next } from "hono";

/**
 * Peek at JSON body for `dryRun: true` so recipient-count / preview calls do not consume the
 * aggressive real-send rate limit. Invalid JSON is treated as a real send attempt (limit
 * applies). Same mechanism as skip-bulk-send-dry-run.ts for mail, kept as its own small file
 * rather than generalized - that file is mail-specific by name/context-key and this is a
 * different feature, not a shared concern.
 */
export async function skipWalletMessageRateLimitForDryRun(c: Context, next: Next): Promise<void> {
  try {
    const body = (await c.req.raw.clone().json()) as { dryRun?: unknown };
    c.set("walletMessageDryRun", body.dryRun === true);
  } catch {
    c.set("walletMessageDryRun", false);
  }
  await next();
}
