/**
 * The state of one guest sign-in (`RegistrationSsoState`, D-C4): written when the guest is sent to the identity provider,
 * spent by the callback. It holds the OAuth `state`, the `nonce` and the PKCE verifier of the flow, and the event and the
 * provider the flow was begun for, and nothing of the guest: no address, no `sub`, no token.
 *
 * A separate table from the state of the staff sign-in (`OidcAuthState`), on purpose: a flow of a guest and a flow of staff
 * cannot be taken for each other, and the callback of one never finds the rows of the other.
 *
 * The rows that ran out are deleted by the worker (`sweepRegistrationSsoStates`), not here: a sign-in is the request of a
 * stranger, and a sweep inside it would be a way to make it cost more.
 */
import type { PrismaClient } from "@admitto/db";
import { GUEST_SSO_STATE_TTL_MS } from "./sso-session.js";

export interface NewGuestSsoState {
  state: string;
  nonce: string;
  codeVerifier: string;
  eventId: string;
  providerId: string;
}

/** What a spent state hands to the callback. */
export interface SpentGuestSsoState {
  eventId: string;
  /** The slug of that event, from the row of the event: the one thing the callback needs to name the page to go back to. */
  eventSlug: string;
  providerId: string;
  nonce: string;
  codeVerifier: string;
}

export async function createGuestSsoState(db: PrismaClient, input: NewGuestSsoState, now: Date): Promise<void> {
  await db.registrationSsoState.create({
    data: {
      state: input.state,
      nonce: input.nonce,
      code_verifier: input.codeVerifier,
      event_id: input.eventId,
      provider_id: input.providerId,
      expires_at: new Date(now.getTime() + GUEST_SSO_STATE_TTL_MS),
    },
  });
}

/**
 * Spends the state, once. The state is looked up by its whole value (the slug it carries is a hint and is not read here).
 * The row is read, and then marked spent by a conditional update that wins only while the row is neither spent nor expired: of two callbacks with one state, the database lets exactly one change the row, and the other
 * finds nothing to change. Null for a state that is unknown, expired or already spent, whichever it is.
 *
 * The clock is the caller's, passed in and compared as a JavaScript date, as the row was written (the columns are naive UTC).
 */
export async function spendGuestSsoState(db: PrismaClient, state: string, now: Date): Promise<SpentGuestSsoState | null> {
  const row = await db.registrationSsoState.findUnique({ where: { state }, include: { event: { select: { slug: true } } } });
  if (!row) return null;
  const won = await db.registrationSsoState.updateMany({
    where: { id: row.id, consumed_at: null, expires_at: { gt: now } },
    data: { consumed_at: now },
  });
  if (won.count !== 1) return null;
  return { eventId: row.event_id, eventSlug: row.event.slug, providerId: row.provider_id, nonce: row.nonce, codeVerifier: row.code_verifier };
}
