import type { RegistrationAccessMethodDto, RegistrationAccessMethodsDto } from "../../src/api/types.js";

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
