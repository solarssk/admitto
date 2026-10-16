import { LOAD_TIMEOUT_MS } from "../utils/loading-timing.js";

/** How long after it was marked a Sign out still counts as under way: the longest a request is waited for. A page
 * that is still there after that (the browser's Stop button was pressed, or it was restored from the back-forward
 * cache) goes back to sending the browser to the sign-in page when it finds its session gone. */
const STAND_DOWN_MS = LOAD_TIMEOUT_MS;

let markedAt: number | null = null;

/** Marks the user's Sign out as under way: from the click, and again once the server has answered. The request
 * revokes the session, so a request that was already under way (the connection check, a load) is answered 401
 * on the way, and that 401 must not send the browser to the sign-in page: it would replace the trip to the
 * identity provider's logout page, the one that ends the provider's session too. */
export function markSignOutInProgress(): void {
  markedAt = Date.now();
}

/** The Sign out failed: the session is still there, so a 401 means what it always meant. */
export function clearSignOutInProgress(): void {
  markedAt = null;
}

export function isSignOutInProgress(): boolean {
  return markedAt !== null && Date.now() - markedAt < STAND_DOWN_MS;
}
