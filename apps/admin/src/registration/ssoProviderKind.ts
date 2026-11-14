/** The Tabler icon of the kind of an identity provider (the server tells the kind from its issuer): Microsoft Entra ID, Google, or any other OpenID Connect provider. */
export function ssoProviderIcon(kind: "entra" | "google" | "generic"): string {
  if (kind === "entra") return "brand-azure";
  return kind === "google" ? "brand-google" : "shield-lock";
}

/** The protocol of every provider the app has, said beside its name. */
export const SSO_PROVIDER_PROTOCOL = "OpenID Connect";
