import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { getCookie } from "hono/cookie";
import {
  SESSION_COOKIE_NAME,
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
import type { AuthContext } from "../auth-middleware.js";

export type StaffAuthResult =
  | { status: "authenticated"; auth: AuthContext }
  | { status: "invalid_cf_jwt"; reason: string }
  | { status: "unauthenticated" };

/** Resolve staff principal from Cloudflare Access JWT or session cookie. */
export async function resolveStaffAuthFromRequest(
  c: Context,
  prisma: PrismaClient,
): Promise<StaffAuthResult> {
  const config = await getCfAccessConfigCached(prisma);
  const path = c.req.path;

  if (config.enabled) {
    const token = extractAccessTokenFromHeaders(
      Object.fromEntries(c.req.raw.headers.entries()),
    );

    if (token) {
      try {
        const payload = await validateAccessJwt(token, config);
        const provider = await findCloudflareAccessProvider(prisma);
        if (!provider?.enabled) {
          logCfAccessAuth({ outcome: "failure", reason: "provider_not_configured", path });
          return { status: "invalid_cf_jwt", reason: "provider_not_configured" };
        }
        const subject = payload.sub;
        if (typeof subject !== "string" || !subject) {
          logCfAccessAuth({ outcome: "failure", reason: "missing_sub", path });
          return { status: "invalid_cf_jwt", reason: "missing_sub" };
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
          return { status: "invalid_cf_jwt", reason };
        }

        await applyOidcGroupRoleMappings(prisma, provider.id, userId, claims.groups ?? []);
        logCfAccessAuth({
          outcome: "success",
          email: claims.email,
          subject,
          path,
        });
        return {
          status: "authenticated",
          auth: { userId, authSource: "cloudflare-access" },
        };
      } catch (err) {
        const reason = err instanceof CfAccessJwtError ? err.code : "invalid_jwt";
        logCfAccessAuth({ outcome: "failure", reason, path });
        return { status: "invalid_cf_jwt", reason };
      }
    }
  }

  const rawToken = getCookie(c, SESSION_COOKIE_NAME);
  if (!rawToken) return { status: "unauthenticated" };

  const validated = await validateSession(prisma, rawToken);
  if (!validated) return { status: "unauthenticated" };

  return {
    status: "authenticated",
    auth: {
      userId: validated.userId,
      sessionId: validated.session.id,
      authSource: "session",
    },
  };
}
