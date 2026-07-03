import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { canManageInstance, markSetupComplete } from "@admitto/auth";
import type { RateLimitStore } from "../rate-limit/types.js";
import { collectSetupChecks, setupChecksAllOk } from "./setup-checks-routes.js";

/** POST /api/admin/setup/complete — mark first-run wizard finished. */
export async function handlePostSetupComplete(
  c: Context,
  db: PrismaClient,
  rateLimitStore: RateLimitStore,
  injectedBaseUrl?: string,
): Promise<Response> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const checks = await collectSetupChecks(db, rateLimitStore, injectedBaseUrl);
  if (!setupChecksAllOk(checks)) {
    return c.json({ error: "setup_not_ready", checks }, 409);
  }

  await markSetupComplete(db);
  return c.json({ setup_complete: true }, 200);
}
