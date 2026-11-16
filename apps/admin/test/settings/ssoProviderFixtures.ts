import type { RegistrationReturnAddressesDto } from "../../src/api/types.js";

/** The two providers the tests list as turned on. */
export const SSO_PROVIDERS = [
  { id: "idp-entra", display_name: "Company Entra ID" },
  { id: "idp-okta", display_name: "Okta" },
];

/**
 * The answer of the sso-provider route: the choice `providerId`, how it stands (`state`), the providers that can be chosen, and the
 * return address (a made-up instance address; `null` for an instance that has none).
 */
export function ssoProviderDto(overrides: Partial<RegistrationReturnAddressesDto> = {}): RegistrationReturnAddressesDto {
  const dto = {
    provider_id: null,
    state: "not_selected" as const,
    providers: SSO_PROVIDERS,
    redirect_uri: "https://tickets.example.com/sso/callback" as string | null,
    ...overrides,
  };
  // Unless a test lists the addresses itself, they are the instance's one, as the server lists them for an instance with no own address.
  const instanceOnly = dto.redirect_uri === null ? [] : [{ uri: dto.redirect_uri, host: "instance" as const, verified: true }];
  return { ...dto, redirect_uris: overrides.redirect_uris ?? instanceOnly };
}
