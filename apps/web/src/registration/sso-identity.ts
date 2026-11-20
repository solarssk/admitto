/**
 * Who a validated ID token says the guest is (D-C4), judged by one pure function so that every rule has a test of its own and
 * nothing is decided twice. The token has been verified before it gets here (signature, issuer, audience, nonce, expiry:
 * `exchangeAndValidateIdToken`); this decides what of it a registration may rest on.
 *
 * - The person is the provider's `sub`, not the address: an address is contact data that the provider can change and that two
 *   people can in time hold in turn.
 * - The restriction to a company reads ONE claim of the token (never the end of an address), and a person it does not let in
 *   gets no sign-in at all.
 * - The address is the one the provider's mapping names (`claim_email`, as for staff: Microsoft Entra ID often sends none and the
 *   administrator maps it to `preferred_username`), through `extractClaims`, with no fallback of our own. A provider that says
 *   in so many words that the address is not verified is not believed (`email_verified: false`); one that says nothing is
 *   (Microsoft Entra ID sends no such claim). The address must be one the form would take.
 *
 * The order is the order of how much each refusal may tell: the restriction before the address, so that a person the event
 * does not take learns nothing about their address.
 */
import { extractClaims, isEmailVerificationDenied, readClaimStrings } from "@admitto/auth";
import type { IdentityProvider } from "@admitto/db";
import { registrantEmailSchema } from "@admitto/tickets";
import type { JWTPayload } from "jose";
import { matchClaim, type ClaimProof, type ClaimRestriction } from "./sso-claim.js";

/** The longest `sub` OIDC allows (Core 2). The column and the cookie hold the same. */
export const SSO_SUBJECT_MAX = 255;

/** Why a token does not make a sign-in. A fixed set: it is what the system log names, and nothing else. */
export type SsoRefusal = "no_subject" | "not_allowed" | "email_unverified" | "no_email";

export type SsoIdentityResult =
  | { ok: true; subject: string; email: string; proof: ClaimProof | null }
  | { ok: false; reason: SsoRefusal };

type EmailClaimMapping = Pick<
  IdentityProvider,
  "claim_email" | "claim_name" | "claim_groups" | "claim_given_name" | "claim_family_name" | "claim_phone"
>;

function subjectOf(payload: JWTPayload): string | null {
  const subject = payload.sub;
  return typeof subject === "string" && subject.length > 0 && subject.length <= SSO_SUBJECT_MAX ? subject : null;
}

/** The address the provider gave, as the form would take it, or null. */
function emailOf(payload: JWTPayload, provider: EmailClaimMapping): string | null {
  const parsed = registrantEmailSchema.safeParse(extractClaims(payload, provider).email);
  return parsed.success ? parsed.data : null;
}

export function identityFromToken(
  payload: JWTPayload,
  provider: EmailClaimMapping,
  restriction: ClaimRestriction | null,
): SsoIdentityResult {
  const subject = subjectOf(payload);
  if (subject === null) return { ok: false, reason: "no_subject" };

  let proof: ClaimProof | null = null;
  if (restriction !== null) {
    proof = matchClaim(restriction, readClaimStrings(payload, restriction.name));
    if (proof === null) return { ok: false, reason: "not_allowed" };
  }

  if (isEmailVerificationDenied(payload)) return { ok: false, reason: "email_unverified" };
  const email = emailOf(payload, provider);
  if (email === null) return { ok: false, reason: "no_email" };
  return { ok: true, subject, email, proof };
}

/** What the page tells the guest after a refusal: a sentence of its own for three cases, from a closed set. */
export type SsoNotice = "failed" | "no_email" | "not_allowed";

export const SSO_NOTICES: readonly SsoNotice[] = ["failed", "no_email", "not_allowed"];

/** The notice for a refusal. The reasons that the guest can do nothing about, or that only a person with another account
 * could, are the general one. */
export function noticeFor(reason: SsoRefusal): SsoNotice {
  if (reason === "not_allowed") return "not_allowed";
  return reason === "no_subject" ? "failed" : "no_email";
}

/** A notice that came back in the address of the page, or null for anything else: only the three words are believed. */
export function noticeFromQuery(value: string | undefined): SsoNotice | null {
  return SSO_NOTICES.find((notice) => notice === value) ?? null;
}
