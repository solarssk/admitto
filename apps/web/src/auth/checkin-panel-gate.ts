import type { Context, Next } from "hono";
import type { PrismaClient } from "@admitto/db";
import { canAccessAdminPanel, canAccessCheckInPanel } from "@admitto/auth";

import { resolveStaffEntryPath } from "../setup-routes.js";

/** Requires `auth` on context (apply `requireSession` first). */
export function createCheckInPanelCapabilityGuard(prisma: PrismaClient) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const auth = c.get("auth");
    if (!auth?.userId) {
      if (c.req.path.startsWith("/api/")) {
        return c.json({ error: "unauthorized" }, 401);
      }
      return c.redirect(await resolveStaffEntryPath(prisma), 302);
    }

    if (!(await canAccessCheckInPanel(prisma, auth.userId))) {
      if (await canAccessAdminPanel(prisma, auth.userId)) {
        if (c.req.path.startsWith("/api/")) {
          return c.json({ error: "forbidden" }, 403);
        }
        return c.redirect("/admin", 302);
      }
      if (c.req.path.startsWith("/api/")) {
        return c.json({ error: "forbidden" }, 403);
      }
      return c.text("Forbidden", 403);
    }

    const passwordChange = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { must_change_password: true },
    });
    if (passwordChange?.must_change_password) {
      if (c.req.path.startsWith("/api/")) {
        return c.json({ error: "password_change_required" }, 403);
      }
      return c.redirect("/change-password", 302);
    }

    await next();
  };
}
