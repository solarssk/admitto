import type { Context, Next } from "hono";
import type { IdentityProvider, PrismaClient } from "@admitto/db";
import { getCookie } from "hono/cookie";
import {
  SESSION_COOKIE_NAME,
  canManageInstance,
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
  logAccessDenied,
  type CfAccessConfig,
  type ExternalIdentityClaims,
} from "@admitto/auth";
import { resolveStaffEntryPath } from "../setup-routes.js";
import { resolveClientIp } from "../rate-limit/client-ip.js";

const CF_ACCESS_FORBIDDEN_MESSAGE =
  "authenticated via Cloudflare Access, but this account has no admin access";

function isApiAdminPath(path: string): boolean {
  return path === "/api/admin" || path.startsWith("/api/admin/");
}

async function loginBoundaryResponse(c: Context, prisma: PrismaClient): Promise<Response> {
  if (isApiAdminPath(c.req.path)) {
    return c.json({ error: "authentication_required" }, 401);
  }
  return c.redirect(await resolveStaffEntryPath(prisma), 302);
}

function rejectInvalidJwt(c: Context, reason: string): Response {
  logCfAccessAuth({ outcome: "failure", reason, path: c.req.path });
  if (isApiAdminPath(c.req.path)) {
    return c.json({ error: "cf_access_jwt_invalid" }, 403);
  }
  return c.text("Forbidden", 403);
}

/** Resolve (or JIT-create) the local user for a validated CF Access identity. */
async function resolveCfAccessIdentity(
  c: Context,
  prisma: PrismaClient,
  provider: IdentityProvider,
  subject: string,
  claims: ExternalIdentityClaims,
  path: string,
): Promise<{ userId: string } | { response: Response }> {
  try {
    const resolved = await resolveOrCreateUserFromExternalIdentity(
      prisma,
      provider,
      subject,
      claims,
    );
    return { userId: resolved.user.id };
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
    return { response: rejectInvalidJwt(c, reason) };
  }
}

/** CF Access JWT branch of the collision-point middleware (ADR 0017). */
async function handleCfAccessToken(
  c: Context,
  prisma: PrismaClient,
  config: CfAccessConfig,
  token: string,
  path: string,
  next: Next,
): Promise<Response | void> {
  try {
    const payload = await validateAccessJwt(token, config);
    const provider = await findCloudflareAccessProvider(prisma);
    if (!provider?.enabled) {
      return rejectInvalidJwt(c, "provider_not_configured");
    }
    const subject = payload.sub;
    if (typeof subject !== "string" || !subject) {
      return rejectInvalidJwt(c, "missing_sub");
    }

    const claims = extractClaims(payload, provider);
    const resolution = await resolveCfAccessIdentity(c, prisma, provider, subject, claims, path);
    if ("response" in resolution) {
      return resolution.response;
    }
    const { userId } = resolution;

    // Reconcile grants against current mapping rules (revocation when rules or groups change).
    await applyOidcGroupRoleMappings(prisma, provider.id, userId, claims.groups ?? []);

    if (!(await canManageInstance(prisma, userId))) {
      logCfAccessAuth({
        outcome: "failure",
        reason: "no_admin_role",
        email: claims.email,
        subject,
        path,
      });
      return c.text(CF_ACCESS_FORBIDDEN_MESSAGE, 403);
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

/** Collision-point middleware: CF JWT trójstan + session break-glass (ADR 0017). */
export function createAdminAccessMiddleware(prisma: PrismaClient) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const config = await getCfAccessConfigCached(prisma);
    const path = c.req.path;

    if (!config.enabled) {
      return sessionSuperadminGate(c, prisma, next);
    }

    const token = extractAccessTokenFromHeaders(
      Object.fromEntries(c.req.raw.headers.entries()),
    );

    if (token) {
      return handleCfAccessToken(c, prisma, config, token, path, next);
    }

    return sessionSuperadminGate(c, prisma, next);
  };
}

async function sessionSuperadminGate(
  c: Context,
  prisma: PrismaClient,
  next: Next,
): Promise<Response | void> {
  const rawToken = getCookie(c, SESSION_COOKIE_NAME);
  if (!rawToken) {
    return loginBoundaryResponse(c, prisma);
  }
  const validated = await validateSession(prisma, rawToken);
  if (!validated) {
    return loginBoundaryResponse(c, prisma);
  }
  if (!(await canManageInstance(prisma, validated.userId))) {
    await logAccessDenied(prisma, {
      path: c.req.path,
      reason: "no_superadmin_role",
      authSource: "session",
      userId: validated.userId,
      ip: resolveClientIp(c),
    });
    if (isApiAdminPath(c.req.path)) {
      return c.json({ error: "forbidden" }, 403);
    }
    return c.text("Forbidden", 403);
  }
  c.set("auth", {
    userId: validated.userId,
    sessionId: validated.session.id,
    authSource: "session",
  });
  await next();
}
