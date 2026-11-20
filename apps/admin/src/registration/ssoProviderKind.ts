/** The Tabler icon of the kind of an identity provider (the server tells the kind from its issuer): Microsoft Entra ID, Google, or any other OpenID Connect provider. */
export function ssoProviderIcon(kind: "entra" | "google" | "generic"): string {
  if (kind === "entra") return "brand-azure";
  return kind === "google" ? "brand-google" : "shield-lock";
}
