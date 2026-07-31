import type { Context, Next } from "hono";
import type { PrismaClient } from "@admitto/db";
import { canAccessAdminPanel, canAccessCheckInPanel, logAccessDenied, logCfAccessAuth } from "@admitto/auth";
import { resolveStaffEntryPath } from "../setup-routes.js";
import { resolveStaffAuthFromRequest } from "./resolve-staff-auth.js";
import { resolveClientIp } from "../rate-limit/client-ip.js";

function isAdminSpaPath(path: string): boolean {
  // Every /admin/* path is served by the SPA shell now that the legacy
  // /admin/auth/* HTML routes were removed (#266 slice 5); the SPA router
  // redirects unknown paths (e.g. old /admin/auth/* bookmarks) to /admin.
  return path === "/admin" || path.startsWith("/admin/");
}

function isAdminApiPath(path: string): boolean {
  return path === "/api/admin" || path.startsWith("/api/admin/");
}

async function loginBoundaryResponse(c: Context, prisma: PrismaClient): Promise<Response> {
  if (isAdminApiPath(c.req.path)) {
    return c.json({ error: "authentication_required" }, 401);
  }
  return c.redirect(await resolveStaffEntryPath(prisma), 302);
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
  await logAccessDenied(prisma, {
    path: c.req.path,
    reason: "no_admin_access",
    authSource: "session",
    userId,
    ip: resolveClientIp(c),
  });
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
      return loginBoundaryResponse(c, prisma);
    }

    if (!(await canAccessAdminPanel(prisma, result.auth.userId))) {
      return forbiddenNoAdminAccess(c, prisma, result.auth.userId);
    }

    const passwordChange = await prisma.user.findUnique({
      where: { id: result.auth.userId },
      select: { must_change_password: true, email: true },
    });
    if (passwordChange?.must_change_password && isAdminSpaPath(c.req.path)) {
      return c.redirect("/change-password", 302);
    }
    if (passwordChange?.must_change_password && isAdminApiPath(c.req.path)) {
      return c.json({ error: "password_change_required" }, 403);
    }

    c.set("auth", { ...result.auth, userEmail: passwordChange?.email });
    await next();
  };
}
