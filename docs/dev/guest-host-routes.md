# Routes and the event's own address

An event can have an address of its own for its guests (for example `summit.acme.example`). On that address the application serves the guest's side of that one event and nothing of the panel. This page is for a developer who adds a route to `apps/web/src/app.ts`.

## The rule

A new route is **hidden on an event's own address** until a person lists it as a guest's. The list of what is allowed is `classifyGuestRequest` in `apps/web/src/guest-host/guest-paths.ts`. The answer to everything not on it is the same public 404 as for a page that is not there, so the panel, the staff's sign-in, the API and the health routes do not exist on a guest's address.

## Adding a route

1. Decide who the route is for. A guest's page, file or image that a guest or a mail links to is a guest's route. Everything a person with a staff session uses, every `/api/*` route and every probe is the staff's.
2. A staff route needs nothing in the code. Its path must start with a prefix in `STAFF_PREFIXES` in `apps/web/test/guest-host/guest-host-routes.test.ts`; add a prefix there for a new family of staff routes.
3. A guest's route goes into `classifyGuestRequest`, and into `GUEST_ROUTES` in the same test. Then keep it to one event:
   - a path that carries the event's slug is compared with the slug of the host's event in `guest-paths.ts`;
   - a handler that finds the event by something else (a token, an id, a state) must call `isOtherEventOnGuestHost(c, eventId)` and answer the same 404 as for a thing that is not there.
4. Run `npm test -w @admitto/web`. `guest-host-routes.test.ts` fails with the route's name while it is on neither list.

## What stays on the main address

The panel, the staff's sign-in, the wallet provider's notifications (`/api/wallet/webhook/*`) and the wallet links in a mail stay on the instance's address. The wallet buttons on the ticket page are relative links, so they work on both.

How the host is judged, the lookup cache and the proof at `/.well-known/admitto-domain-check` are in [An event's own address for guests](../security/SECURITY-CONTROLS.md#an-events-own-address-for-guests).
