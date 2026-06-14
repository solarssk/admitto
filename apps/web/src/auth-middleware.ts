import type { Context, Next } from "hono";
import type { PrismaClient } from "@prisma/client";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE_NAME, validateSession } from "@admitto/auth";

/** Authenticated principal attached to Hono context after session validation. */
export interface AuthContext {
  userId: string;
  sessionId: string;
}

declare module "hono" {
  interface ContextVariableMap {
    auth: AuthContext;
    parsedScanBody: Record<string, unknown>;
    checkinAuth: "bearer" | "session";
    operatorUserId: string;
  }
}

/** Require valid `admitto_session` cookie; sets `c.var.auth` for downstream handlers. */
export function createRequireSession(prisma: PrismaClient) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const rawToken = getCookie(c, SESSION_COOKIE_NAME);
    if (!rawToken) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const validated = await validateSession(prisma, rawToken);
    if (!validated) {
      return c.json({ error: "unauthorized" }, 401);
    }

    c.set("auth", {
      userId: validated.userId,
      sessionId: validated.session.id,
    });
    await next();
  };
}
