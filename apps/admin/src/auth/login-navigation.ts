import { isSignOutInProgress } from "./sign-out-in-progress.js";

/** The one way the staff app sends the browser to the sign-in page (`/login...`) after a 401 or a lost
 * session. Not while the user's own Sign out is under way: its request revokes the session, so a request
 * already in flight is answered 401 on the way, and that redirect would replace the trip to the identity
 * provider's logout page, the one that ends the provider's session too. A test fails on a direct
 * `location.assign` to `/login` anywhere else in the app. */
export function goToLogin(url: string): void {
  if (isSignOutInProgress()) return;
  window.location.assign(url);
}
