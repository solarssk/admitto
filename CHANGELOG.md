# Changelog

This project is still pre-`1.0`.
The changelog is intentionally lightweight for now: it records milestone-level changes so the team
can quickly see what has already landed, without pretending this is a full public release process.

## Unreleased

- No unreleased changes recorded yet.

## v0.3.1 - 2026-06-14

Auth core foundation.

- Added local `User` accounts with `argon2id` password hashing.
- Added DB-backed `Session` records with revocation and expiry handling.
- Added `@admitto/auth` with login, logout, session validation, audit logging, and capability-aware RBAC helpers.
- Added `bootstrap-superadmin` CLI for first-run local break-glass access.
- Added `POST /api/auth/login`, `POST /api/auth/logout`, and `GET /api/auth/me`.
- Extended `/api/checkin/*` to accept either a valid session or the transitional legacy Bearer token.
- Preserved ADR 0003 deploy policy so check-in never becomes public during the migration.

## v0.3.0 - 2026-06-13

Mailer milestone completed.

- Landed test-send and read-only delivery/config inspection for mail delivery.
- Added Redis-backed shared rate limiting for public `/t/*` and `/q/*` routes.
- Kept in-memory rate limiting as the default local/dev path, with Redis selected by `REDIS_URL`.

## v0.2.4 - 2026-06-11

Post-merge hardening.

- Added DB `CHECK` constraints on `RoleAssignment`.
- Hardened crypto/key-version behavior and seed behavior around missing encryption keys.

## v0.2.3 - 2026-06-11

Multi-tenant foundation and encryption.

- Added `Organization` as the tenant boundary.
- Threaded `organization_id` into the model.
- Added encrypted attendee token storage via `@admitto/crypto`.

## v0.2.2 - 2026-06-11

PostgreSQL-only infra foundation.

- Standardized on PostgreSQL across dev, CI, and production.
- Added docker-compose support, CI service wiring, and stronger check-in relational guarantees.

## v0.2.1 - 2026-06-11

Check-in backend foundation.

- Added atomic single-use check-in behavior.
- Added the temporary operator Bearer gate for `/api/checkin/*`.

## v0.2.0 - 2026-06-08

Core ticketing foundation.

- Added attendee import, internal token/QR issuance, agency UUID support, and public ticket pages.

## v0.1.0 - 2026-06-08

Project skeleton and Gate 0 outcome.

- Landed monorepo setup, initial DB schema, CI/security baseline, and mail adapter groundwork.
