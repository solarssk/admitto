import type { PrismaClient, Prisma, Session } from "@admitto/db";
import { AUTH_METHOD } from "../constants.js";

/**
 * RP-initiated logout (OIDC end session, https://openid.net/specs/openid-connect-rpinitiated-1_0.html):
 * where to send the browser after a local logout so the identity provider's own session ends
 * too, instead of staying alive for the next SSO login to silently reuse. Returns null (caller
 * falls back to its normal post-logout destination) whenever there's nothing to redirect to -
 * a local session, or an OIDC provider that doesn't advertise end_session_endpoint.
 *
 * No id_token_hint: most IdPs (Keycloak, Auth0, Okta, Entra, Authentik) accept end_session with
 * just client_id + post_logout_redirect_uri, and Admitto doesn't retain the id_token past login.
 */
export async function resolveOidcEndSessionRedirect(
  prisma: PrismaClient | Prisma.TransactionClient,
  session: Pick<Session, "auth_method" | "oidc_provider_id">,
  baseUrl: string,
): Promise<string | null> {
  if (session.auth_method !== AUTH_METHOD.OIDC || !session.oidc_provider_id) return null;

  const provider = await prisma.identityProvider.findUnique({
    where: { id: session.oidc_provider_id },
    select: { end_session_endpoint: true, client_id: true },
  });
  if (!provider?.end_session_endpoint) return null;

  const url = new URL(provider.end_session_endpoint);
  url.searchParams.set("client_id", provider.client_id);
  url.searchParams.set("post_logout_redirect_uri", new URL("/login", baseUrl).toString());
  return url.toString();
}
