import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { canManageInstance, markSetupComplete } from "@admitto/auth";

/** POST /api/admin/setup/complete — mark first-run wizard finished. */
export async function handlePostSetupComplete(c: Context, db: PrismaClient): Promise<Response> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  await markSetupComplete(db);
  return c.json({ setup_complete: true }, 200);
}
