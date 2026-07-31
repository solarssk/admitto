import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import {
  findOidcProviderById,
  userRequiresMfaStepUp,
  verifyOidcLinkStepUp,
} from "@admitto/auth";
import { resolveOptionalSafeRedirectPath } from "./safe-redirect.js";
import { beginOidcAuthorizationRedirect } from "./oidc-flow.js";
import { getOidcLinkPageSecurityHeaders, renderOidcLinkForm } from "./oidc-link-page.js";
import { checkMfaVerifyRateLimit, resolveMfaClientIp } from "./mfa-rate-limit.js";
import { checkOidcLinkStepUpRateLimit } from "../rate-limit/policies.js";
import type { RateLimitStore } from "../rate-limit/types.js";

const LINK_ERROR = "Invalid password or code. Try again.";

function htmlResponse(c: Context, html: string, status: 200 | 401 = 200): Response {
  for (const [name, value] of Object.entries(getOidcLinkPageSecurityHeaders())) {
    c.header(name, value);
  }
  return c.html(html, status);
}

async function parseForm(c: Context): Promise<Record<string, string>> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const body = await c.req.parseBody();
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  }
  return {};
}

async function requiresTotpForUser(db: PrismaClient, userId: string): Promise<boolean> {
  return userRequiresMfaStepUp(db, userId);
}

function renderLinkForm(
  providerId: string,
  providerName: string,
  requiresTotp: boolean,
  next?: string,
  error?: string,
): string {
  return renderOidcLinkForm({
    providerId,
    providerName,
    requiresTotp,
    next,
    error,
  });
}

/** GET /account/oidc/:providerId/link */
export async function handleGetOidcLink(c: Context, db: PrismaClient): Promise<Response> {
  const providerId = c.req.param("providerId") ?? "";
  const auth = c.get("auth");
  const next = resolveOptionalSafeRedirectPath(c.req.query("next"));

  const provider = await findOidcProviderById(db, providerId);
  if (!provider?.enabled) {
    return c.redirect("/login?error=oidc_failed", 302);
  }

  const requiresTotp = await requiresTotpForUser(db, auth.userId);
  return htmlResponse(
    c,
    renderLinkForm(providerId, provider.display_name, requiresTotp, next),
  );
}

/** POST /account/oidc/:providerId/link — step-up, then start OIDC link flow. */
export async function handlePostOidcLink(
  c: Context,
  db: PrismaClient,
  baseUrl: string,
  rateLimitStore: RateLimitStore,
): Promise<Response> {
  const providerId = c.req.param("providerId") ?? "";
  const auth = c.get("auth");
  if (!auth.sessionId) {
    return c.text("Forbidden", 403);
  }
  const form = await parseForm(c);
  const password = form["password"] ?? "";
  const code = form["code"]?.trim();
  const next = resolveOptionalSafeRedirectPath(form["next"] ?? c.req.query("next"));

  const provider = await findOidcProviderById(db, providerId);
  if (!provider?.enabled) {
    return c.redirect("/login?error=oidc_failed", 302);
  }

  const requiresTotp = await requiresTotpForUser(db, auth.userId);

  if (!password) {
    return htmlResponse(
      c,
      renderLinkForm(providerId, provider.display_name, requiresTotp, next, LINK_ERROR),
      401,
    );
  }

  const ip = resolveMfaClientIp(c);
  if (!(await checkOidcLinkStepUpRateLimit(rateLimitStore, auth.userId, ip))) {
    return c.text("Too many requests", 429);
  }

  if (code) {
    if (!(await checkMfaVerifyRateLimit(rateLimitStore, auth.sessionId, ip, code, "oidc-link"))) {
      return c.text("Too many requests", 429);
    }
  }

  const stepUp = await verifyOidcLinkStepUp(db, {
    userId: auth.userId,
    password,
    code,
  });

  if (!stepUp.ok) {
    const message =
      stepUp.reason === "totp_required"
        ? "Authenticator code is required."
        : LINK_ERROR;
    return htmlResponse(
      c,
      renderLinkForm(providerId, provider.display_name, requiresTotp, next, message),
      401,
    );
  }

  return beginOidcAuthorizationRedirect(c, db, baseUrl, providerId, {
    redirectNext: next,
    linkUserId: auth.userId,
    linkStepUpAt: new Date(),
  });
}
