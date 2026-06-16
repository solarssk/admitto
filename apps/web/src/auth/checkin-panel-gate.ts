import type { Context, Next } from "hono";
import type { PrismaClient } from "@prisma/client";
import { canAccessCheckInPanel } from "@admitto/auth";

/** Requires `auth` on context (apply `requireSession` first). */
export function createCheckInPanelCapabilityGuard(prisma: PrismaClient) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const auth = c.get("auth");
    if (!auth?.userId) {
      if (c.req.path.startsWith("/api/")) {
        return c.json({ error: "unauthorized" }, 401);
      }
      return c.redirect("/login", 302);
    }

    if (!(await canAccessCheckInPanel(prisma, auth.userId))) {
      if (c.req.path.startsWith("/api/")) {
        return c.json({ error: "forbidden" }, 403);
      }
      return c.redirect("/admin", 302);
    }

    await next();
  };
}
