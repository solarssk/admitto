import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { getCookie } from "hono/cookie";
import {
  SESSION_COOKIE_NAME,
  SESSION_STAGE,
  createSession,
  findOidcProviderById,
  buildOidcRedirectUri,
  buildOidcAuthorizeUrl,
  createOidcAuthState,
  consumeOidcAuthState,
  exchangeAndValidateIdToken,
  extractClaims,
  resolveOrCreateUserFromExternalIdentity,
  ExternalIdentityLinkError,
  applyOidcGroupRoleMappings,
  generateCodeVerifier,
  codeChallengeS256,
  generateOauthSecret,
  validatePartialSession,
} from "@admitto/auth";
import { resolveSafeRedirectPath } from "./safe-redirect.js";
import { setSessionCookie } from "./routes.js";
import { resolveClientIp } from "../rate-limit/client-ip.js";

const OIDC_LOGIN_ERROR_PATH = "/login?error=oidc_failed";

function oidcFailedRedirect(c: Context): Response {
  return c.redirect(OIDC_LOGIN_ERROR_PATH, 302);
}

function logOidcError(context: string, err: unknown): void {
  const message = err instanceof Error ? err.message : "unknown";
  console.error(`OIDC ${context}:`, message);
}

/** GET /api/auth/oidc/:providerId/start */
export async function handleOidcStart(c: Context, db: PrismaClient, baseUrl: string): Promise<Response> {
  const providerId = c.req.param("providerId") ?? "";
  const provider = await findOidcProviderById(db, providerId);
  if (!provider || !provider.enabled) {
    return oidcFailedRedirect(c);
  }

  const next = resolveSafeRedirectPath(c.req.query("next"));
  const state = generateOauthSecret();
  const nonce = generateOauthSecret();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = codeChallengeS256(codeVerifier);

  try {
    await createOidcAuthState(db, {
      providerId: provider.id,
      state,
      nonce,
      codeVerifier,
      redirectNext: next,
    });
  } catch (err) {
    logOidcError("create auth state", err);
    return oidcFailedRedirect(c);
  }

  const redirectUri = buildOidcRedirectUri(baseUrl, provider.id);
  const authorizeUrl = buildOidcAuthorizeUrl(provider, {
    redirectUri,
    state,
    nonce,
    codeChallenge,
  });
  return c.redirect(authorizeUrl, 302);
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

  let currentUserId: string | undefined;
  const sessionToken = getCookie(c, SESSION_COOKIE_NAME);
  if (sessionToken) {
    const partial = await validatePartialSession(db, sessionToken);
    if (partial && partial.stage === SESSION_STAGE.FULL) {
      currentUserId = partial.userId;
    }
  }

  let userId: string;
  try {
    const resolved = await resolveOrCreateUserFromExternalIdentity(
      db,
      provider,
      subject,
      claims,
      currentUserId ? { currentUserId } : undefined,
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
    const { rawToken } = await createSession(db, {
      userId,
      stage: SESSION_STAGE.FULL,
      ip: resolveClientIp(c),
      userAgent: c.req.header("user-agent"),
    });
    setSessionCookie(c, rawToken);
  } catch (err) {
    logOidcError("session create", err);
    return oidcFailedRedirect(c);
  }

  const next = resolveSafeRedirectPath(consumed.redirect_next ?? "/operator");
  return c.redirect(next, 302);
}
