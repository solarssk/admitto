/**
 * Ops-only ingest so the Admitto worker process can append to the app process System Logs buffer
 * via OPS_HEALTH_TOKEN - originally built for the bounce job's own reportBounceIngestSystemLog,
 * now also the target of the generic worker-wide relay (apps/cli/src/lib/system-log-publish.ts,
 * installed via @admitto/shared/system-log's setSystemLogPublisher hook).
 */
import type { Context } from "hono";
import { z } from "zod";
import {
  emitSystemLog,
  type SystemLogLevel,
  type SystemLogSource,
} from "@admitto/shared/system-log";
import { isValidOpsToken } from "./readyz.js";

const bodySchema = z
  .object({
    source: z.enum(["api", "db", "cache", "mail", "admin", "security", "worker", "wallet", "external"]),
    level: z.enum(["info", "warn", "error"]),
    message: z.string().trim().min(1).max(200),
    fields: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const FORBIDDEN_FIELD_KEYS = new Set([
  "password",
  "imap_password",
  "smtp_password",
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "authorization",
  "auth_header",
  "cookie",
  "set_cookie",
  "secret",
  "api_key",
  "apikey",
  "credential",
  "credentials",
  "bearer",
]);

const FORBIDDEN_FIELD_SUBSTRINGS = [
  "password",
  "secret",
  "token",
  "authorization",
  "auth_header",
  "cookie",
  "credential",
  "apikey",
  "api_key",
  "bearer",
] as const;

function isForbiddenFieldKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (FORBIDDEN_FIELD_KEYS.has(lower)) return true;
  return FORBIDDEN_FIELD_SUBSTRINGS.some((needle) => lower.includes(needle));
}

function sanitizeFields(
  fields: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!fields) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (isForbiddenFieldKey(key)) {
      continue;
    }
    if (typeof value === "string" && value.length > 500) {
      out[key] = `${value.slice(0, 500)}…`;
      continue;
    }
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export type HandleOpsSystemLogIngestOpts = {
  opsHealthToken: string | null;
};

/** POST /api/ops/system-logs — Bearer / X-Ops-Token same as /readyz. */
export async function handleOpsSystemLogIngest(
  c: Context,
  opts: HandleOpsSystemLogIngestOpts,
): Promise<Response> {
  if (!opts.opsHealthToken) {
    return c.json({ error: "not_found" }, 404);
  }
  if (!isValidOpsToken(c, opts.opsHealthToken)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "invalid_body" }, 400);
  }

  const { source, level, message, fields } = parsed.data;
  emitSystemLog(source as SystemLogSource, level as SystemLogLevel, message, sanitizeFields(fields));
  return c.json({ ok: true }, 200);
}
