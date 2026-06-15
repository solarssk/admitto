import type { Context, Next } from "hono";
import type { PrismaClient } from "@prisma/client";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE_NAME, canManageInstance, validateSession } from "@admitto/auth";

/** Require full session + instance superadmin; returns 403 (not redirect). */
export function createRequireSuperadmin(prisma: PrismaClient) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const rawToken = getCookie(c, SESSION_COOKIE_NAME);
    if (!rawToken) {
      return c.text("Forbidden", 403);
    }
    const validated = await validateSession(prisma, rawToken);
    if (!validated) {
      return c.text("Forbidden", 403);
    }
    c.set("auth", { userId: validated.userId, sessionId: validated.session.id });
    if (!(await canManageInstance(prisma, validated.userId))) {
      return c.text("Forbidden", 403);
    }
    await next();
  };
}
