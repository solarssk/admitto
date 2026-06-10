import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";

/**
 * Middleware factory for the /api/checkin/* namespace.
 * - null operatorToken → 503 (feature unconfigured; no code path is reachable without a token)
 * - missing/wrong Authorization Bearer → 401 (does not reveal which)
 * - correct token → passes to next handler
 * Comparison is constant-time to prevent timing attacks.
 */
export function createCheckinGate(operatorToken: string | null) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    if (!operatorToken) {
      return c.json({ error: "check-in not configured" }, 503);
    }

    const auth = c.req.header("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const provided = auth.slice(7);
    const tokenBuf = Buffer.from(operatorToken, "utf8");
    const providedBuf = Buffer.from(provided, "utf8");

    // Guard length first — timingSafeEqual requires equal-length buffers.
    if (tokenBuf.length !== providedBuf.length || !timingSafeEqual(tokenBuf, providedBuf)) {
      return c.json({ error: "unauthorized" }, 401);
    }

    await next();
  };
}
