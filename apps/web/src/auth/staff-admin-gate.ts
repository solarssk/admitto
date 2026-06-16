import type { Context, Next } from "hono";
import type { PrismaClient } from "@prisma/client";
import { canAccessAdminPanel, canAccessCheckInPanel, logCfAccessAuth } from "@admitto/auth";
import { resolveStaffAuthFromRequest } from "./resolve-staff-auth.js";

function isAdminSpaPath(path: string): boolean {
  return path === "/admin" || (path.startsWith("/admin/") && !path.startsWith("/admin/auth/"));
}

function isAdminApiPath(path: string): boolean {
  return path === "/api/admin" || path.startsWith("/api/admin/");
}

function loginBoundaryResponse(c: Context): Response {
  if (isAdminApiPath(c.req.path)) {
    return c.json({ error: "authentication_required" }, 401);
  }
  return c.redirect("/login", 302);
}

function terminalForbiddenResponse(c: Context): Response {
  if (isAdminApiPath(c.req.path)) {
    return c.json({ error: "forbidden" }, 403);
  }
  if (isAdminSpaPath(c.req.path)) {
    return c.text("Forbidden", 403);
  }
  return c.json({ error: "forbidden" }, 403);
}

async function forbiddenNoAdminAccess(
  c: Context,
  prisma: PrismaClient,
  userId: string,
): Promise<Response> {
  if (await canAccessCheckInPanel(prisma, userId)) {
    if (isAdminApiPath(c.req.path)) {
      return c.json({ error: "forbidden" }, 403);
    }
    if (isAdminSpaPath(c.req.path)) {
      return c.redirect("/operator", 302);
    }
  }
  return terminalForbiddenResponse(c);
}

function rejectInvalidJwt(c: Context, reason: string): Response {
  logCfAccessAuth({ outcome: "failure", reason, path: c.req.path });
  if (isAdminApiPath(c.req.path)) {
    return c.json({ error: "cf_access_jwt_invalid" }, 403);
  }
  return c.text("Forbidden", 403);
}

/** Staff admin gate for `/admin` SPA and `/api/admin/*` (ADR 0017 + P1). */
export function createStaffAdminGate(prisma: PrismaClient) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const result = await resolveStaffAuthFromRequest(c, prisma);

    if (result.status === "invalid_cf_jwt") {
      return rejectInvalidJwt(c, result.reason);
    }
    if (result.status === "unauthenticated") {
      return loginBoundaryResponse(c);
    }

    if (!(await canAccessAdminPanel(prisma, result.auth.userId))) {
      return forbiddenNoAdminAccess(c, prisma, result.auth.userId);
    }

    c.set("auth", result.auth);
    await next();
  };
}
