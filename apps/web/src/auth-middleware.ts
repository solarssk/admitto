import type { Context, Next } from "hono";
import type { PrismaClient } from "@admitto/db";
import { getCookie } from "hono/cookie";
import {
  SESSION_COOKIE_NAME,
  SESSION_STAGE,
  type SessionStage,
  validateSession,
  validatePartialSession,
} from "@admitto/auth";

/** Authenticated principal attached to Hono context after full session validation. */
export interface AuthContext {
  userId: string;
  /** Verified staff email when the authenticating gate already loaded it. */
  userEmail?: string;
  sessionId?: string;
  authSource?: "session" | "cloudflare-access";
}

/** Partial session (MFA pending or enrollment). */
export interface PartialAuthContext {
  userId: string;
  sessionId: string;
  stage: SessionStage;
}

declare module "hono" {
  interface ContextVariableMap {
    auth: AuthContext;
    partialAuth: PartialAuthContext;
    parsedScanBody: Record<string, unknown>;
    checkinAuth: "bearer" | "session";
    operatorUserId: string;
    bulkSendDryRun: boolean;
  }
}

type SessionRedirectOptions = {
  redirectTo?: string;
  resolveRedirectTo?: () => Promise<string>;
};

async function redirectUnauthenticated(
  c: Context,
  options?: SessionRedirectOptions,
): Promise<Response> {
  if (options?.resolveRedirectTo) {
    return c.redirect(await options.resolveRedirectTo(), 302);
  }
  if (options?.redirectTo) {
    return c.redirect(options.redirectTo, 302);
  }
  return c.json({ error: "unauthorized" }, 401);
}

/** Require valid full session cookie; optional HTML redirect instead of 401 JSON. */
export function createRequireSession(
  prisma: PrismaClient,
  options?: SessionRedirectOptions,
) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const rawToken = getCookie(c, SESSION_COOKIE_NAME);
    if (!rawToken) {
      return redirectUnauthenticated(c, options);
    }

    const validated = await validateSession(prisma, rawToken);
    if (!validated) {
      return redirectUnauthenticated(c, options);
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
  options?: SessionRedirectOptions & { allowedStages?: SessionStage[] },
) {
  const allowedStages = options?.allowedStages ?? [
    SESSION_STAGE.MFA_PENDING,
    SESSION_STAGE.ENROLLMENT_REQUIRED,
    SESSION_STAGE.BACKUP_CODES_REQUIRED,
  ];

  return async (c: Context, next: Next): Promise<Response | void> => {
    const rawToken = getCookie(c, SESSION_COOKIE_NAME);
    if (!rawToken) {
      return redirectUnauthenticated(c, options);
    }

    const validated = await validatePartialSession(prisma, rawToken);
    if (!validated || !allowedStages.includes(validated.stage)) {
      return redirectUnauthenticated(c, options);
    }

    c.set("partialAuth", {
      userId: validated.userId,
      sessionId: validated.session.id,
      stage: validated.stage,
    });
    await next();
  };
}
