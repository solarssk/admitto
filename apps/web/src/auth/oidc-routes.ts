import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
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
} from "@admitto/auth";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE_NAME } from "@admitto/auth";
import { resolveOptionalSafeRedirectPath } from "./safe-redirect.js";
import { resolvePostLoginRedirectForUser } from "./post-login-redirect.js";
import { setSessionCookie } from "./routes.js";
import { resolveClientIp } from "../rate-limit/client-ip.js";
import { clearOidcFlowCookie, oidcFlowCookieMatches } from "./oidc-flow-cookie.js";
import { beginOidcAuthorizationRedirect } from "./oidc-flow.js";

const OIDC_LOGIN_ERROR_PATH = "/login?error=oidc_failed";

function oidcFailedRedirect(c: Context): Response {
  clearOidcFlowCookie(c);
  return c.redirect(OIDC_LOGIN_ERROR_PATH, 302);
}

function logOidcError(context: string, err: unknown): void {
  const message = err instanceof Error ? err.message : "unknown";
  console.error(`OIDC ${context}:`, message);
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
  if (!provider || !provider.enabled) {
    return oidcFailedRedirect(c);
  }

  const next = resolveOptionalSafeRedirectPath(c.req.query("next"));
  return beginOidcAuthorizationRedirect(c, db, baseUrl, providerId, { redirectNext: next });
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
  if (!provider || !provider.enabled) {
    logOidcError("callback", "provider missing or disabled");
    return oidcFailedRedirect(c);
  }

  const consumed = await consumeOidcAuthState(db, state);
  if (!consumed || consumed.provider_id !== provider.id) {
    logOidcError("callback", "invalid or replayed state");
    return oidcFailedRedirect(c);
  }

  if (consumed.link_user_id) {
    if (!consumed.link_step_up_at) {
      logOidcError("callback", "link flow missing step-up");
      return oidcFailedRedirect(c);
    }
    if (Date.now() - consumed.link_step_up_at.getTime() > OIDC_LINK_STEP_UP_MAX_AGE_MS) {
      logOidcError("callback", "link step-up expired");
      return oidcFailedRedirect(c);
    }

    const sessionToken = getCookie(c, SESSION_COOKIE_NAME);
    if (!sessionToken) {
      logOidcError("callback", "link flow missing session");
      return oidcFailedRedirect(c);
    }
    const partial = await validatePartialSession(db, sessionToken);
    if (
      !partial ||
      partial.stage !== SESSION_STAGE.FULL ||
      partial.userId !== consumed.link_user_id
    ) {
      logOidcError("callback", "link flow session mismatch");
      return oidcFailedRedirect(c);
    }
  }

  clearOidcFlowCookie(c);

  const redirectUri = buildOidcRedirectUri(baseUrl, provider.id);
  let payload;
  try {
    const result = await exchangeAndValidateIdToken(
      provider,
      code,
      consumed.code_verifier,
      redirectUri,
      consumed.nonce,
    );
    payload = result.payload;
  } catch (err) {
    logOidcError("token validation", err);
    return oidcFailedRedirect(c);
  }

  const subject = payload.sub;
  if (typeof subject !== "string" || !subject) {
    logOidcError("callback", "missing sub claim");
    return oidcFailedRedirect(c);
  }

  const claims = extractClaims(payload, provider);

  let userId: string;
  try {
    const resolved = await resolveOrCreateUserFromExternalIdentity(
      db,
      provider,
      subject,
      claims,
      consumed.link_user_id ? { currentUserId: consumed.link_user_id } : undefined,
    );
    userId = resolved.user.id;
  } catch (err) {
    if (err instanceof ExternalIdentityLinkError) {
      logOidcError("identity link", err.message);
    } else {
      logOidcError("identity link", err);
    }
    return oidcFailedRedirect(c);
  }

  try {
    await applyOidcGroupRoleMappings(db, provider.id, userId, claims.groups ?? []);
  } catch (err) {
    logOidcError("group mapping", err);
    return oidcFailedRedirect(c);
  }

  try {
    const { session, rawToken } = await createSession(db, {
      userId,
      stage: SESSION_STAGE.FULL,
      authMethod: AUTH_METHOD.OIDC,
      ip: resolveClientIp(c),
      userAgent: c.req.header("user-agent"),
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
    logOidcLoginSuccess({
      providerId: provider.id,
      userId,
      subject,
      ip: resolveClientIp(c),
    });
    return c.redirect(next, 302);
  } catch (err) {
    logOidcError("session create", err);
    return oidcFailedRedirect(c);
  }
}
