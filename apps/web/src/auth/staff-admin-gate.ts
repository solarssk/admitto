import type { Context, Next } from "hono";
import type { PrismaClient } from "@prisma/client";
import { getCookie } from "hono/cookie";
import {
  SESSION_COOKIE_NAME,
  canAccessAdminPanel,
  validateSession,
  getCfAccessConfigCached,
  extractAccessTokenFromHeaders,
  validateAccessJwt,
  CfAccessJwtError,
  findCloudflareAccessProvider,
  resolveOrCreateUserFromExternalIdentity,
  ExternalIdentityLinkError,
  extractClaims,
  applyOidcGroupRoleMappings,
  logCfAccessAuth,
} from "@admitto/auth";

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

function forbiddenResponse(c: Context, operatorRedirect = false): Response {
  if (isAdminApiPath(c.req.path)) {
    return c.json({ error: "forbidden" }, 403);
  }
  if (operatorRedirect && isAdminSpaPath(c.req.path)) {
    return c.redirect("/operator", 302);
  }
  if (isAdminSpaPath(c.req.path)) {
    return c.text("Forbidden", 403);
  }
  return c.json({ error: "forbidden" }, 403);
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
    const config = await getCfAccessConfigCached(prisma);
    const path = c.req.path;

    if (!config.enabled) {
      return sessionAdminPanelGate(c, prisma, next);
    }

    const token = extractAccessTokenFromHeaders(
      Object.fromEntries(c.req.raw.headers.entries()),
    );

    if (token) {
      try {
        const payload = await validateAccessJwt(token, config);
        const provider = await findCloudflareAccessProvider(prisma);
        if (!provider || !provider.enabled) {
          return rejectInvalidJwt(c, "provider_not_configured");
        }
        const subject = payload.sub;
        if (typeof subject !== "string" || !subject) {
          return rejectInvalidJwt(c, "missing_sub");
        }

        const claims = extractClaims(payload, provider);
        let userId: string;
        try {
          const resolved = await resolveOrCreateUserFromExternalIdentity(
            prisma,
            provider,
            subject,
            claims,
          );
          userId = resolved.user.id;
        } catch (err) {
          const reason =
            err instanceof ExternalIdentityLinkError ? err.message : "identity_resolution_failed";
          logCfAccessAuth({
            outcome: "failure",
            reason,
            email: claims.email,
            subject,
            path,
          });
          return rejectInvalidJwt(c, reason);
        }

        await applyOidcGroupRoleMappings(prisma, provider.id, userId, claims.groups ?? []);

        if (!(await canAccessAdminPanel(prisma, userId))) {
          logCfAccessAuth({
            outcome: "failure",
            reason: "no_admin_panel_access",
            email: claims.email,
            subject,
            path,
          });
          return forbiddenResponse(c, true);
        }

        logCfAccessAuth({
          outcome: "success",
          email: claims.email,
          subject,
          path,
        });
        c.set("auth", { userId, authSource: "cloudflare-access" });
        await next();
        return;
      } catch (err) {
        const reason = err instanceof CfAccessJwtError ? err.code : "invalid_jwt";
        return rejectInvalidJwt(c, reason);
      }
    }

    return sessionAdminPanelGate(c, prisma, next);
  };
}

async function sessionAdminPanelGate(
  c: Context,
  prisma: PrismaClient,
  next: Next,
): Promise<Response | void> {
  const rawToken = getCookie(c, SESSION_COOKIE_NAME);
  if (!rawToken) {
    return loginBoundaryResponse(c);
  }
  const validated = await validateSession(prisma, rawToken);
  if (!validated) {
    return loginBoundaryResponse(c);
  }
  if (!(await canAccessAdminPanel(prisma, validated.userId))) {
    return forbiddenResponse(c, true);
  }
  c.set("auth", {
    userId: validated.userId,
    sessionId: validated.session.id,
    authSource: "session",
  });
  await next();
}
