import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { canManageInstance, markSetupComplete } from "@admitto/auth";
import { writeAdminAuditLogBestEffort } from "@admitto/tickets";
import type { RateLimitStore } from "../rate-limit/types.js";
import { adminAuditFromContext } from "./admin-helpers.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";
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

  const orgId = await resolveInstanceOrganizationId(db);
  const audit = adminAuditFromContext(c);
  await writeAdminAuditLogBestEffort(db, {
    organizationId: orgId,
    actorUserId: auth.userId,
    sessionId: audit.sessionId,
    ip: audit.ip,
    timezone: audit.timezone,
    actionType: "instance_setup_completed",
  });

  return c.json({ setup_complete: true }, 200);
}
