import type { Context, Next } from "hono";

/**
 * Peek at JSON body for `dryRun: true` so recipient-count / preview calls do not
 * consume the aggressive admin bulk-send rate limit. Invalid JSON is treated as
 * a real send attempt (limit applies).
 */
export async function skipBulkSendRateLimitForDryRun(c: Context, next: Next): Promise<void> {
  try {
    const body = (await c.req.raw.clone().json()) as { dryRun?: unknown };
    c.set("bulkSendDryRun", body.dryRun === true);
  } catch {
    c.set("bulkSendDryRun", false);
  }
  await next();
}
