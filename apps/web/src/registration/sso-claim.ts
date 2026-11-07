/**
 * The restriction of an event's company sign-in to the people of one company (D-C4): ONE claim of the provider's verified ID
 * token (for example `tid`, the tenant of Microsoft Entra ID) and the values of it that may register. Never the end of an
 * address: an address says where mail goes, a claim of a signed token says who the provider vouches for.
 *
 * One rule, in one place. The callback judges it before it hands out a sign-in, and the submit route judges it again from
 * what the sign-in cookie holds, so a restriction an organiser tightens does not wait for a sign-in to run out. What an organiser
 * may enter (the limits, the characters) is in `@admitto/shared` (ssoClaim.ts), for the form as well.
 */

export interface ClaimRestriction {
  /** The name of the claim, as the provider's token spells it. */
  name: string;
  /** The values that may register, matched exactly (case and all). Never empty. */
  values: readonly string[];
}

/** What a sign-in carries of the claim it was judged by: which claim, and the one allowed value the token held. */
export interface ClaimProof {
  name: string;
  value: string;
}

/** The restriction the columns of an event's settings hold, or null for none. The columns are set together (a CHECK of the
 * table); a row that is not (a name with no values) is read as no restriction, never as a restriction nobody can meet. */
export function restrictionOf(name: string | null, values: readonly string[]): ClaimRestriction | null {
  return name === null || values.length === 0 ? null : { name, values };
}

/**
 * The allowed value that the token's claim holds, or null when it holds none, or does not assert the claim at all.
 * `claim` is what `readClaimStrings` read: a string is one value and an array is its members. Exact comparison.
 */
export function matchClaim(restriction: ClaimRestriction, claim: readonly string[] | undefined): ClaimProof | null {
  if (claim === undefined) return null;
  const value = claim.find((candidate) => restriction.values.includes(candidate));
  return value === undefined ? null : { name: restriction.name, value };
}

/**
 * Whether what a sign-in carries still satisfies the restriction of the event as it is now. No restriction: yes. A
 * restriction and no proof, a proof of another claim, or a value that is no longer listed: no.
 */
export function proofSatisfies(restriction: ClaimRestriction | null, proof: ClaimProof | null): boolean {
  if (restriction === null) return true;
  return proof !== null && proof.name === restriction.name && restriction.values.includes(proof.value);
}
