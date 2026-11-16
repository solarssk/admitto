import type { RegistrationReturnAddressesDto } from "../../src/api/types.js";

/**
 * The answer of the sso-provider route: the return address of the guests' company SSO (a made-up instance address; `null` for an
 * instance that has none) and every address to list. Which provider an event uses is not part of it.
 */
export function ssoProviderDto(overrides: Partial<RegistrationReturnAddressesDto> = {}): RegistrationReturnAddressesDto {
  const redirectUri = overrides.redirect_uri === undefined ? "https://tickets.example.com/sso/callback" : overrides.redirect_uri;
  // Unless a test lists the addresses itself, they are the instance's one, as the server lists them for an instance with no own address.
  const instanceOnly = redirectUri === null ? [] : [{ uri: redirectUri, host: "instance" as const, verified: true }];
  return { redirect_uri: redirectUri, redirect_uris: overrides.redirect_uris ?? instanceOnly };
}
