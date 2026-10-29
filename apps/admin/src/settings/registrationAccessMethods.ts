import type { RegistrationAccessMethod } from "@admitto/db/status";
import type { RegistrationAccessMethodsDto, SaveRegistrationAccessMethodsBody } from "../api/types.js";

/** The ways in the card has a switch for. The server lists one more, the company sign-in (`sso`), which an event cannot choose
 * yet: the card neither shows it nor changes it. */
export const SWITCHED_ACCESS_METHODS = ["link", "password"] as const;

export type SwitchedAccessMethod = (typeof SWITCHED_ACCESS_METHODS)[number];

/** The edit state of the Ways in card in External services: which of its switches are on. */
export type AccessMethodsDraft = Record<SwitchedAccessMethod, boolean>;

function isSwitched(method: RegistrationAccessMethod): method is SwitchedAccessMethod {
  return (SWITCHED_ACCESS_METHODS as readonly RegistrationAccessMethod[]).includes(method);
}

function isEnabled(dto: RegistrationAccessMethodsDto, method: RegistrationAccessMethod): boolean {
  return dto.methods.some((entry) => entry.method === method && entry.enabled);
}

export function accessMethodsDraftFrom(dto: RegistrationAccessMethodsDto): AccessMethodsDraft {
  return { link: isEnabled(dto, "link"), password: isEnabled(dto, "password") };
}

export function accessMethodsDirty(draft: AccessMethodsDraft, saved: AccessMethodsDraft): boolean {
  return SWITCHED_ACCESS_METHODS.some((method) => draft[method] !== saved[method]);
}

/**
 * What to PUT, or null when no switch changed. The server replaces the whole list of ways in that are on, so the list
 * also carries the ways this card has no switch for and that are on in `dto`, the last answer of the server: a save must
 * not turn off what the card cannot show.
 */
export function buildAccessMethodsSaveBody(
  draft: AccessMethodsDraft,
  saved: AccessMethodsDraft,
  dto: RegistrationAccessMethodsDto,
): SaveRegistrationAccessMethodsBody | null {
  if (!accessMethodsDirty(draft, saved)) return null;
  const switchedOn = SWITCHED_ACCESS_METHODS.filter((method) => draft[method]);
  const notSwitched = dto.methods.filter((entry) => entry.enabled && !isSwitched(entry.method)).map((entry) => entry.method);
  return { methods: [...switchedOn, ...notSwitched] };
}
