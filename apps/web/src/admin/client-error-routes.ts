import type { Context } from "hono";
import { z } from "zod";
import { logger } from "../logger.js";

const clientErrorSchema = z
  .object({
    source: z.enum([
      "admin-error-boundary",
      "window-error",
      "unhandled-rejection",
      "resource-error",
      "csp-violation",
    ]),
  })
  .strict();

/** POST /api/admin/client-errors — fixed client-side error categories. Requires a full session. */
export async function handlePostClientError(c: Context) {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const parsed = clientErrorSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "validation_failed" }, 400);
  }

  const { source } = parsed.data;
  logger.warn("Admin SPA client error", { source });
  return c.json({ ok: true });
}
