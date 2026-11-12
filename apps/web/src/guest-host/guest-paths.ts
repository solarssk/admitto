/**
 * What the application answers on the verified own address of an event (D-C6, PR 119b): the guest's side of THAT event and nothing
 * else. This is a list of what is allowed, not of what is forbidden: a route that is added to the application is hidden on a
 * guest's address until it is written here, and `apps/web/test/guest-host-routes.test.ts` fails until every route of the application
 * is on this list or on the list of the staff's side.
 *
 * | Path | Why a guest needs it | One event |
 * |------|----------------------|-----------|
 * | `/r/<slug>/...` | the form, its sign-in, the confirmation link | the slug is the host's |
 * | `/sso/callback` | where the company sign-in returns (one path for all events) | the handler compares the event of the state |
 * | `/legal/<slug>/<ref>` | the legal texts linked from the form | the slug is the host's |
 * | `/t/<token>` and its wallet routes | the ticket page of the mail, and its wallet buttons (relative links) | the handler compares the ticket's event |
 * | `/t/<slug>/a/<ref>` and its wallet routes | the ticket page of an agency attendee | the slug is the host's |
 * | `/q/<token>.png`, `/q/<slug>/a/<ref>.png` | the QR image of the ticket | the handler / the slug |
 * | `/m/<event>.png` | the map image of a ticket and a mail | the handler compares the event |
 * | `/assets/*`, `/uploads/*`, `/vendor/*` | images, fonts and styles of the pages and the mails | (public files) |
 * | the five icon files | the icons the pages link to | (public files) |
 * | `/.well-known/admitto-domain-check` | the proof the check of the address asks for | the host's |
 * | `/` | sends the guest to `/r/<slug>` | the host's |
 *
 * Everything else, the panel, the sign-in of staff, the API and the health routes included, is hidden. The wallet buttons on the
 * ticket page are links relative to the page, so they work on the guest's address; the wallet provider's notifications and the wallet
 * links in a mail stay on the main address (`/api/wallet/webhook/...` is hidden here).
 */
import { GUEST_SSO_CALLBACK_PATH } from "../registration/sso-session.js";

export type GuestPathVerdict = "allow" | "root" | "deny";

export const DOMAIN_CHECK_PATH = "/.well-known/admitto-domain-check";

/** Whole paths (the icons are the ones the pages link to: `renderAdmittoFaviconLink`). */
const ALLOWED_PATHS: ReadonlySet<string> = new Set([
  GUEST_SSO_CALLBACK_PATH,
  DOMAIN_CHECK_PATH,
  "/favicon.svg",
  "/favicon-32.png",
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/apple-touch-icon-precomposed.png",
]);

/** Whether a segment of the path is the slug of the host's event. An event with no slug (which the table does not hold) matches nothing. */
function isSlug(part: string | undefined, slug: string): boolean {
  return slug !== "" && part === slug;
}

/** `/t/...` : `["", "t", ...]`. */
function verdictForTicket(parts: readonly string[], slug: string): GuestPathVerdict {
  // /t/<token> and /t/<token>/wallet/<platform>: the ticket is looked up by the handler, which compares its event.
  if (parts.length === 3 || (parts.length === 5 && parts[3] === "wallet")) return parts[2] ? "allow" : "deny";
  // /t/<slug>/a/<ref> and /t/<slug>/a/<ref>/wallet/<platform>
  const agency = (parts.length === 5 && parts[3] === "a") || (parts.length === 7 && parts[3] === "a" && parts[5] === "wallet");
  return agency && isSlug(parts[2], slug) ? "allow" : "deny";
}

/** `/q/...` : `["", "q", ...]`. */
function verdictForQr(parts: readonly string[], slug: string): GuestPathVerdict {
  if (parts.length === 3) return parts[2] ? "allow" : "deny";
  return parts.length === 5 && parts[3] === "a" && isSlug(parts[2], slug) ? "allow" : "deny";
}

/**
 * The verdict for a request on the own address of the event with `slug`: `allow` (the router answers), `root` (`GET /` goes to the
 * form) or `deny` (the same 404 as for a page that is not there). `path` is the path the router matches against (`c.req.path`).
 */
export function classifyGuestRequest(method: string, path: string, slug: string): GuestPathVerdict {
  if (path === "/") return method === "GET" || method === "HEAD" ? "root" : "deny";
  if (ALLOWED_PATHS.has(path)) return "allow";
  const parts = path.split("/");
  switch (parts[1]) {
    case "assets":
    case "uploads":
    case "vendor":
    case "m":
      return parts.length > 2 ? "allow" : "deny";
    case "r":
    case "legal":
      return isSlug(parts[2], slug) ? "allow" : "deny";
    case "t":
      return verdictForTicket(parts, slug);
    case "q":
      return verdictForQr(parts, slug);
    default:
      return "deny";
  }
}
