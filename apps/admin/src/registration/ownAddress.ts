import { parseCustomDomain, type CustomDomainCheckResult, type CustomDomainProblem } from "@admitto/shared";
import type { CustomDomainDto, RegistrationOwnAddressDto } from "../api/types.js";

/**
 * The event's own address for guests, as the Access tab words it (D-C6, PR 120). The rules of what an address may be are
 * `parseCustomDomain` in `@admitto/shared`, the same function the server judges a save by; this file only gives each refusal and
 * each result of a check its sentence.
 */

/** Why an address is refused: the words of `parseCustomDomain`, and the one the panel can judge itself because it knows the instance's host. */
type Refusal = CustomDomainProblem | "instance_host";

const REFUSALS: Record<Refusal, string> = {
  empty: "Enter an address.",
  too_long: "An address can have at most 253 characters.",
  bad_characters: "Enter the host name only, such as events.example.com: no https://, port, path or spaces.",
  trailing_dot: "Leave out the dot at the end.",
  ip_address: "Enter a name, not an IP address.",
  reserved: "This name only works inside a network. Guests need a public name.",
  no_dot: "The name needs a dot, such as events.example.com.",
  bad_label: "A part of the name between dots is not valid. Use letters, digits and hyphens, and do not start or end a part with a hyphen.",
  instance_host: "This is the address of this instance. Guests need an address of their own for this event.",
};

export type AddressInput = { ok: true; domain: string } | { ok: false; message: string };

/** What was typed, judged as the server judges it (spaces around it are cut off first), or the sentence that says what is wrong. */
export function judgeAddressInput(typed: string, instanceHost: string | null): AddressInput {
  const parsed = parseCustomDomain(typed.trim());
  if (!parsed.ok) return { ok: false, message: REFUSALS[parsed.problem] };
  return parsed.domain === instanceHost ? { ok: false, message: REFUSALS.instance_host } : { ok: true, domain: parsed.domain };
}

/** An address that worked once and whose last check failed: guests' links still point to it, and it does not answer. */
export function hasStopped(address: RegistrationOwnAddressDto | null): address is RegistrationOwnAddressDto {
  return address !== null && address.verified && address.status === "failing";
}

/** The faults a check can find, in the short form a warning uses. */
const FAULTS: Record<Exclude<CustomDomainCheckResult, "ok" | "not_verifiable_from_server">, string> = {
  dns_failed: "the name does not resolve any more",
  tls_failed: "its HTTPS certificate is refused",
  wrong_target: "it no longer reaches this instance",
  unreachable: "it did not answer",
};

/** Why the address stopped, in a few words, for the warning every administrator of the event reads. */
function shortFault(result: CustomDomainCheckResult | null): string {
  return result !== null && result in FAULTS ? FAULTS[result as keyof typeof FAULTS] : "the last check failed";
}

/** The warning at the top of the tab for an address that stopped working. */
export function stoppedWarning(address: RegistrationOwnAddressDto): string {
  return `The address of this event for guests, ${address.domain}, stopped working: ${shortFault(address.check_result)}. Guests are still sent links on it, so they may not open. Ask a superadmin or your IT department to look at it.`;
}

/** Where a CNAME has to point: the instance's host, or words for it when the instance has no address yet. */
const instanceTarget = (host: string | null): string => host ?? "the address of this instance";

/** What each result of a check says, in one short sentence, with what to do about it (a superadmin passes it on to IT). */
export function checkAdvice(result: CustomDomainCheckResult, instanceHost: string | null): string {
  const target = instanceTarget(instanceHost);
  switch (result) {
    case "ok":
      return "Guests get links on this address.";
    case "dns_failed":
      return `The name does not resolve. Ask IT to add a CNAME to ${target}.`;
    case "tls_failed":
      return "The name resolves, but its certificate is refused. Ask IT to fix it.";
    case "wrong_target":
      return "The name answers, but not as this event. Ask IT to check the setup.";
    case "unreachable":
      return "The address did not answer. Ask IT to check its HTTPS access.";
    case "not_verifiable_from_server":
      return "The name points to a private network. This server cannot check it.";
  }
}

export type AddressTone = "ok" | "warn" | "neutral";

export interface AddressStatusLine {
  tone: AddressTone;
  title: string;
  /** What the last check found, and what to do; null before the first check. */
  detail: string;
}

const UNCHECKED_DETAIL = "The first check runs soon after you set the address.";

/** How the address stands, in the words of the card. What it means for the links of guests is said once, in the intro of the card. */
export function addressStatusLine(address: RegistrationOwnAddressDto, instanceHost: string | null): AddressStatusLine {
  if (address.status === "ok") return { tone: "ok", title: "Working", detail: checkAdvice("ok", instanceHost) };
  if (address.status === "failing") {
    const detail = checkAdvice(address.check_result ?? "unreachable", instanceHost);
    return address.verified ? { tone: "warn", title: "Stopped working", detail } : { tone: "warn", title: "Not working yet", detail };
  }
  if (address.check_result === "not_verifiable_from_server") {
    return { tone: "neutral", title: "Cannot be checked from this server", detail: checkAdvice("not_verifiable_from_server", instanceHost) };
  }
  return { tone: "neutral", title: "Not checked yet", detail: UNCHECKED_DETAIL };
}

/** The state the server answers, as the read of the settings gives it: what the card and the warning are drawn from. */
export function ownAddressOf(state: CustomDomainDto): RegistrationOwnAddressDto | null {
  if (state.custom_domain === null) return null;
  return {
    domain: state.custom_domain,
    status: state.custom_domain_status,
    check_result: state.custom_domain_check_result,
    verified: state.custom_domain_verified_at !== null,
    checked_at: state.custom_domain_checked_at,
  };
}
