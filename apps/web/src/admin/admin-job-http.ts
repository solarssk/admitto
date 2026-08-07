/**
 * Shared AdminJob HTTP helpers for async import/export status routes.
 */
import type { PrismaClient } from "@admitto/db";
import type { Context } from "hono";
import { assertEventManageAccess, requireEventId } from "./admin-helpers.js";

type AdminJobRow = NonNullable<Awaited<ReturnType<PrismaClient["adminJob"]["findFirst"]>>>;

export async function loadEventAdminJob(
  c: Context,
  db: PrismaClient,
  type: string,
): Promise<{ eventId: string; job: AdminJobRow } | Response> {
  const eventIdOrRes = requireEventId(c);
  if (eventIdOrRes instanceof Response) return eventIdOrRes;
  const eventId = eventIdOrRes;

  const forbidden = await assertEventManageAccess(c, db, eventId);
  if (forbidden) return forbidden;

  const jobId = c.req.param("jobId")?.trim();
  if (!jobId) return c.json({ error: "jobId required" }, 400);

  const job = await db.adminJob.findFirst({
    where: { id: jobId, event_id: eventId, type },
  });
  if (!job) return c.json({ error: "not_found" }, 404);

  return { eventId, job };
}
