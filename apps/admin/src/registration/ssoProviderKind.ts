/** The Tabler icon of the kind of an identity provider, told from its issuer: Microsoft Entra ID, Google, or any other OpenID Connect provider. */
export function ssoProviderIcon(issuer: string): string {
  let host = "";
  try {
    host = new URL(issuer).hostname.toLowerCase();
  } catch {
    return "shield-lock";
  }
  if (host === "login.microsoftonline.com" || host === "sts.windows.net" || host === "login.windows.net") return "brand-azure";
  if (host === "accounts.google.com") return "brand-google";
  return "shield-lock";
}

/** The protocol of every provider the app has, said beside its name. */
export const SSO_PROVIDER_PROTOCOL = "OpenID Connect";
