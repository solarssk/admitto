import type { Context, Next } from "hono";
import type { PrismaClient } from "@prisma/client";
import { getCookie } from "hono/cookie";
import {
  SESSION_COOKIE_NAME,
  SESSION_STAGE,
  validateSession,
  validatePartialSession,
} from "@admitto/auth";

/** Authenticated principal attached to Hono context after full session validation. */
export interface AuthContext {
  userId: string;
  sessionId: string;
}

/** Partial session (MFA pending or enrollment). */
export interface PartialAuthContext extends AuthContext {
  stage: string;
}

declare module "hono" {
  interface ContextVariableMap {
    auth: AuthContext;
    partialAuth: PartialAuthContext;
    parsedScanBody: Record<string, unknown>;
    checkinAuth: "bearer" | "session";
    operatorUserId: string;
  }
}

/** Require valid full session cookie; optional HTML redirect instead of 401 JSON. */
export function createRequireSession(
  prisma: PrismaClient,
  options?: { redirectTo?: string },
) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const rawToken = getCookie(c, SESSION_COOKIE_NAME);
    if (!rawToken) {
      if (options?.redirectTo) return c.redirect(options.redirectTo, 302);
      return c.json({ error: "unauthorized" }, 401);
    }

    const validated = await validateSession(prisma, rawToken);
    if (!validated) {
      if (options?.redirectTo) return c.redirect(options.redirectTo, 302);
      return c.json({ error: "unauthorized" }, 401);
    }

    c.set("auth", {
      userId: validated.userId,
      sessionId: validated.session.id,
    });
    await next();
  };
}

/** Require any active session including mfa_pending / enrollment_required. */
export function createRequirePartialSession(
  prisma: PrismaClient,
  options?: { redirectTo?: string; allowedStages?: string[] },
) {
  const allowedStages = options?.allowedStages ?? [
    SESSION_STAGE.MFA_PENDING,
    SESSION_STAGE.ENROLLMENT_REQUIRED,
  ];

  return async (c: Context, next: Next): Promise<Response | void> => {
    const rawToken = getCookie(c, SESSION_COOKIE_NAME);
    if (!rawToken) {
      if (options?.redirectTo) return c.redirect(options.redirectTo, 302);
      return c.json({ error: "unauthorized" }, 401);
    }

    const validated = await validatePartialSession(prisma, rawToken);
    if (!validated || !allowedStages.includes(validated.stage)) {
      if (options?.redirectTo) return c.redirect(options.redirectTo, 302);
      return c.json({ error: "unauthorized" }, 401);
    }

    c.set("partialAuth", {
      userId: validated.userId,
      sessionId: validated.session.id,
      stage: validated.stage,
    });
    await next();
  };
}
