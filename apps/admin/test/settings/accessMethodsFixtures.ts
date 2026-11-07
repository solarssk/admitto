import type { RegistrationAccessMethodDto, RegistrationAccessMethodsDto, RegistrationSsoProviderDto } from "../../src/api/types.js";

/**
 * The answer of the access methods route: every way in, in the server's order, with the ones in `on` enabled. A link or a
 * password is available only while it is on and the Turnstile keys are ready (`keysReady`), as on the server. The company
 * sign-in would need an enabled provider, and none is set up here.
 */
export function accessMethodsDto(on: ReadonlyArray<RegistrationAccessMethodDto["method"]> = [], keysReady = true): RegistrationAccessMethodsDto {
  return {
    methods: (["link", "password", "sso"] as const).map((method) => {
      const enabled = on.includes(method);
      const blockedBy = method === "sso" ? "identity_provider" : "bot_protection";
      const ready = method !== "sso" && keysReady;
      return { method, enabled, available: enabled && ready, blocked_by: enabled && !ready ? blockedBy : null };
    }),
  };
}

/** The two providers a superadmin can choose from in the tests (both turned on). */
export const SSO_PROVIDERS = [
  { id: "idp-entra", display_name: "Company Entra ID" },
  { id: "idp-okta", display_name: "Okta" },
];

/**
 * The answer of the sso-provider route: the choice `providerId`, how it stands (`state`), the providers that can be chosen, and the
 * return address (a made-up instance address; `null` for an instance that has none).
 */
export function ssoProviderDto(overrides: Partial<RegistrationSsoProviderDto> = {}): RegistrationSsoProviderDto {
  return {
    provider_id: null,
    state: "not_selected",
    providers: SSO_PROVIDERS,
    redirect_uri: "https://tickets.example.com/sso/callback",
    ...overrides,
  };
}
