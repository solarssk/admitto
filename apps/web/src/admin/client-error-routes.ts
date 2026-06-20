import type { Context } from "hono";
import { z } from "zod";
import { logger } from "../logger.js";

const clientErrorSchema = z
  .object({
    source: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).max(500),
    path: z.string().trim().min(1).max(256),
  })
  .strict();

/** POST /api/admin/client-errors — structured client-side error reports (no PII). Requires staff session. */
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

  const { source, name, message, path } = parsed.data;
  logger.warn("Admin SPA client error", { source, name, message, path });
  return c.json({ ok: true });
}
