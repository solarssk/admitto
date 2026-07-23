import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import {
  findOidcProviderById,
  buildOidcRedirectUri,
  buildOidcAuthorizeUrl,
  createOidcAuthState,
  generateCodeVerifier,
  codeChallengeS256,
  generateOauthSecret,
} from "@admitto/auth";
import { setOidcFlowCookie } from "./oidc-flow-cookie.js";

export interface BeginOidcFlowOptions {
  redirectNext?: string;
  linkUserId?: string;
  linkStepUpAt?: Date;
}

/** Create OAuth state + flow cookie and redirect to the IdP authorize URL. */
export async function beginOidcAuthorizationRedirect(
  c: Context,
  db: PrismaClient,
  baseUrl: string,
  providerId: string,
  options: BeginOidcFlowOptions = {},
): Promise<Response> {
  const provider = await findOidcProviderById(db, providerId);
  if (!provider?.enabled) {
    return c.redirect("/login?error=oidc_failed", 302);
  }

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
      redirectNext: options.redirectNext,
      linkUserId: options.linkUserId,
      linkStepUpAt: options.linkStepUpAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    console.error("OIDC create auth state:", message);
    return c.redirect("/login?error=oidc_failed", 302);
  }

  setOidcFlowCookie(c, state);

  const redirectUri = buildOidcRedirectUri(baseUrl, provider.id);
  const authorizeUrl = buildOidcAuthorizeUrl(provider, {
    redirectUri,
    state,
    nonce,
    codeChallenge,
  });
  return c.redirect(authorizeUrl, 302);
}
