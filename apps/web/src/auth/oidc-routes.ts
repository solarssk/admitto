import type { Context } from "hono";
import type { IdentityProvider, PrismaClient } from "@admitto/db";
import type { JWTPayload } from "jose";
import {
  SESSION_STAGE,
  AUTH_METHOD,
  createSession,
  findOidcProviderById,
  buildOidcRedirectUri,
  consumeOidcAuthState,
  exchangeAndValidateIdToken,
  extractClaims,
  resolveOrCreateUserFromExternalIdentity,
  ExternalIdentityLinkError,
  applyOidcGroupRoleMappings,
  validatePartialSession,
  OIDC_LINK_STEP_UP_MAX_AGE_MS,
  revokeSession,
  logOidcLoginSuccess,
  SESSION_COOKIE_NAME,
  type ConsumedOidcAuthState,
  type ExternalIdentityClaims,
} from "@admitto/auth";
import { recordSystemLog } from "@admitto/shared/system-log";
import { getCookie } from "hono/cookie";
import { resolveOptionalSafeRedirectPath } from "./safe-redirect.js";
import { resolvePostLoginRedirectForUser } from "./post-login-redirect.js";
import { setSessionCookie } from "./routes.js";
import { resolveClientIp } from "../rate-limit/client-ip.js";
import { clearOidcFlowCookie, oidcFlowCookieMatches } from "./oidc-flow-cookie.js";
import { beginOidcAuthorizationRedirect } from "./oidc-flow.js";
import { parseOptionalClientTimezone } from "../admin/timezone.js";

const OIDC_LOGIN_ERROR_PATH = "/login?error=oidc_failed";

function oidcFailedRedirect(c: Context): Response {
  clearOidcFlowCookie(c);
  return c.redirect(OIDC_LOGIN_ERROR_PATH, 302);
}

function logOidcError(context: string, err: unknown): void {
  const message = err instanceof Error ? err.message : "unknown";
  console.error(`OIDC ${context}:`, message);
  const contextKey = context
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replace(/^_/, "")
    .replace(/_$/, "");
  recordSystemLog({
    level: "warn",
    source: "security",
    message: `oidc_${contextKey}_failed`,
    fields: { errorKind: err instanceof Error ? "error" : "non_error" },
  });
}

/** GET /api/auth/oidc/:providerId/start */
export async function handleOidcStart(c: Context, db: PrismaClient, baseUrl: string): Promise<Response> {
  const providerId = c.req.param("providerId") ?? "";

  if (c.req.query("link") === "1") {
    const rawNext = c.req.query("next");
    const next = resolveOptionalSafeRedirectPath(rawNext);
    const suffix = next ? `?next=${encodeURIComponent(next)}` : "";
    return c.redirect(`/account/oidc/${providerId}/link${suffix}`, 302);
  }

  const provider = await findOidcProviderById(db, providerId);
  if (!provider?.enabled) {
    return oidcFailedRedirect(c);
  }

  const next = resolveOptionalSafeRedirectPath(c.req.query("next"));
  return beginOidcAuthorizationRedirect(c, db, baseUrl, providerId, {
    redirectNext: next,
    timezone: parseOptionalClientTimezone(c.req.query("tz")),
  });
}

/**
 * Validate the account-link flow's step-up requirements. Returns true when the callback
 * is a plain login (no `link_user_id`) or when all link step-up checks pass.
 */
async function validateOidcLinkFlowStepUp(
  c: Context,
  db: PrismaClient,
  consumed: ConsumedOidcAuthState,
): Promise<boolean> {
  if (!consumed.link_user_id) return true;

  if (!consumed.link_step_up_at) {
    logOidcError("callback", "link flow missing step-up");
    return false;
  }
  if (Date.now() - consumed.link_step_up_at.getTime() > OIDC_LINK_STEP_UP_MAX_AGE_MS) {
    logOidcError("callback", "link step-up expired");
    return false;
  }

  const sessionToken = getCookie(c, SESSION_COOKIE_NAME);
  if (!sessionToken) {
    logOidcError("callback", "link flow missing session");
    return false;
  }
  const partial = await validatePartialSession(db, sessionToken);
  if (
    !partial ||
    partial.stage !== SESSION_STAGE.FULL ||
    partial.userId !== consumed.link_user_id
  ) {
    logOidcError("callback", "link flow session mismatch");
    return false;
  }
  return true;
}

/** Exchange the authorization code and validate the ID token; logs and returns null on failure. */
async function exchangeOidcCallbackToken(
  provider: IdentityProvider,
  code: string,
  consumed: ConsumedOidcAuthState,
  redirectUri: string,
): Promise<JWTPayload | null> {
  try {
    const result = await exchangeAndValidateIdToken(
      provider,
      code,
      consumed.code_verifier,
      redirectUri,
      consumed.nonce,
    );
    return result.payload;
  } catch (err) {
    logOidcError("token validation", err);
    return null;
  }
}

/** Resolve or create the local user for the external identity; logs and returns null on failure. */
async function resolveOidcCallbackUserId(
  db: PrismaClient,
  provider: IdentityProvider,
  subject: string,
  claims: ExternalIdentityClaims,
  consumed: ConsumedOidcAuthState,
): Promise<string | null> {
  try {
    const resolved = await resolveOrCreateUserFromExternalIdentity(
      db,
      provider,
      subject,
      claims,
      consumed.link_user_id ? { currentUserId: consumed.link_user_id } : undefined,
    );
    return resolved.user.id;
  } catch (err) {
    if (err instanceof ExternalIdentityLinkError) {
      logOidcError("identity link", err.message);
    } else {
      logOidcError("identity link", err);
    }
    return null;
  }
}

/** Create the session, resolve the post-login destination, and redirect; fails safe on any error. */
async function finalizeOidcLogin(
  c: Context,
  db: PrismaClient,
  provider: IdentityProvider,
  userId: string,
  subject: string,
  consumed: ConsumedOidcAuthState,
): Promise<Response> {
  try {
    const { session, rawToken } = await createSession(db, {
      userId,
      stage: SESSION_STAGE.FULL,
      authMethod: AUTH_METHOD.OIDC,
      oidcProviderId: provider.id,
      ip: resolveClientIp(c),
      userAgent: c.req.header("user-agent"),
      timezone: consumed.timezone,
    });

    let next: string;
    try {
      next = await resolvePostLoginRedirectForUser(db, userId, consumed.redirect_next ?? undefined);
    } catch (err) {
      await revokeSession(db, session.id);
      logOidcError("post-login redirect", err);
      return oidcFailedRedirect(c);
    }

    setSessionCookie(c, rawToken);
    await logOidcLoginSuccess(db, {
      providerId: provider.id,
      userId,
      subject,
      ip: resolveClientIp(c),
      timezone: consumed.timezone,
    });
    return c.redirect(next, 302);
  } catch (err) {
    logOidcError("session create", err);
    return oidcFailedRedirect(c);
  }
}

/** GET /api/auth/oidc/:providerId/callback */
export async function handleOidcCallback(c: Context, db: PrismaClient, baseUrl: string): Promise<Response> {
  const providerId = c.req.param("providerId") ?? "";
  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!code || !state) {
    logOidcError("callback", "missing code or state");
    return oidcFailedRedirect(c);
  }

  if (!oidcFlowCookieMatches(c, state)) {
    logOidcError("callback", "oidc flow cookie mismatch");
    return oidcFailedRedirect(c);
  }

  const provider = await findOidcProviderById(db, providerId);
  if (!provider?.enabled) {
    logOidcError("callback", "provider missing or disabled");
    return oidcFailedRedirect(c);
  }

  const consumed = await consumeOidcAuthState(db, state);
  if (!consumed || consumed.provider_id !== provider.id) {
    logOidcError("callback", "invalid or replayed state");
    return oidcFailedRedirect(c);
  }

  if (!(await validateOidcLinkFlowStepUp(c, db, consumed))) {
    return oidcFailedRedirect(c);
  }

  clearOidcFlowCookie(c);

  const redirectUri = buildOidcRedirectUri(baseUrl, provider.id);
  const payload = await exchangeOidcCallbackToken(provider, code, consumed, redirectUri);
  if (!payload) {
    return oidcFailedRedirect(c);
  }

  const subject = payload.sub;
  if (typeof subject !== "string" || !subject) {
    logOidcError("callback", "missing sub claim");
    return oidcFailedRedirect(c);
  }

  const claims = extractClaims(payload, provider);

  const userId = await resolveOidcCallbackUserId(db, provider, subject, claims, consumed);
  if (!userId) {
    return oidcFailedRedirect(c);
  }

  try {
    await applyOidcGroupRoleMappings(db, provider.id, userId, claims.groups);
  } catch (err) {
    logOidcError("group mapping", err);
    return oidcFailedRedirect(c);
  }

  return finalizeOidcLogin(c, db, provider, userId, subject, consumed);
}
