# Staff entry smoke matrix

Status: Operational runbook · Date: 2026-06-16 · Audience: PO, deploy, QA.

Manual verification after deploy or auth changes. Assumes hostname e.g. `staff.example.com`, Cloudflare
Access on admin paths, WireGuard bypass for the event network, Authentik as shared IdP for CF ZTNA and
the OIDC button on `/login`.

See also the internal design docs for background.

## Product interpretation (owner decision, post–foundation #56)

- CF ZTNA is a **transparent entry layer** for city admins on `/admin`, not a separate user model.
- Effective access comes from Admitto roles/capabilities, not from CF vs OIDC vs password.
- `/operator` is primarily an **on-event surface** (WireGuard + session); CF JWT on operator paths is not
  a foundation requirement.

## Smoke scenarios

| # | Scenario | Entry URL | Expected UX | Double login? |
|---|----------|-----------|-------------|---------------|
| 1 | Admin off-site, active Authentik/CF session | `/admin` | Admin SPA loads without Admitto `/login` form | No |
| 2 | Admin off-site, no SSO session | `/admin` | CF Access / Authentik once → admin panel | No (single SSO at edge) |
| 3 | Admin off-site bookmarks login bypass | `/login` | Admitto form (OIDC + password); OIDC may reuse IdP session | Possible if user also hit CF separately — prefer bookmark `/admin` |
| 4 | Operator on event (WireGuard, no CF JWT) | `/operator` | Redirect `/login` → password → `/operator` (or auto single event) | No CF layer |
| 5 | Admin on event (WireGuard) | `/admin` | Redirect `/login` → password + TOTP → `/admin` | No CF layer |
| 6 | Admin on event needs check-in | `/login` then `/operator` | Session cookie required before check-in | N/A |
| 7 | Attendee ticket link | `/t/<token>` | Ticket page, no staff login | N/A |

## Quick automated regression (CI)

```bash
npm run test -w @admitto/web -- --run test/integration/cf-access-routes.test.ts
npm run test -w @admitto/web -- --run test/integration/oidc-routes.test.ts
npm run test -w @admitto/web -- --run test/post-auth-redirect.test.ts
```
