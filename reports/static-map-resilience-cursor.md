# Static map resilience — Cursor report

Date: 2026-08-02  
Branch: `feature/static-map-resilience` (from `origin/main` after #677 merge)

## Context / scope

After shipping static maps on tickets and mail (`{{event_map_url}}`), a tile CDN outage produced empty HTTP 502 on `GET /m/{eventId}.png`. The public ticket page could fall back via `<object>` text, but mail clients showed a broken image. Goal: harden render failures without publishing ADRs on GitHub.

## Delivered

- Local worktree synced to `origin/main` (`80317f75`); work done on `feature/static-map-resilience`; web served on `:3003`.
- `EventStaticMapService`: up to 2 render attempts with 250 ms backoff; in-memory negative cache (2 min) so a dead CDN is not hit on every refresh.
- On exhausted retries: serve memoized gray PNG “Map unavailable” (same 600×300 size) as `ok: true, placeholder: true`.
- Route: real maps `Cache-Control: public, max-age=86400`; placeholders `max-age=120`. Misses (disabled / not found / no coords) stay 404.
- Tests updated for service, route helpers, wallet `/m/` route, and placeholder PNG metadata.
- CHANGELOG `[Unreleased]` Fixed bullet.
- Cursor rule: do not publish ADRs on GitHub (team-communication).

## Review / CI fixes

Not yet pushed at report time; focused Vitest (50 tests) passed locally.

## Problems / blockers

- `main` branch name is locked to another worktree; created/feature branch from `origin/main` instead of checking out `main` locally.
- Sandbox occasionally blocked killing `:3003` listeners; needed unrestricted shell to restart the server.

## Open / deferred

- Second tile provider / env fallback URL — out of scope.
- Nominatim outage path unchanged (admin search only).
- Prefetch of `/m/` at Location save — out of scope.
- No ADR file in the repo (project rule). Decision rationale lives in this report + upcoming PR Description (business + technical), not in a GitHub ADR.
