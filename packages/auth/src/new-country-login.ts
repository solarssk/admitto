import type { Prisma, PrismaClient } from "@admitto/db/client";
import { resolveIpLocation } from "@admitto/shared/ip-location";
import { logLoginNewCountry } from "./audit.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** How many of a user's most recent successful logins form the "seen before" baseline. Matches
 * the original design note for this check: cheap enough to run on every privileged login, deep
 * enough that a single anomalous row doesn't itself define "normal." */
const RECENT_LOGIN_HISTORY_SIZE = 5;

/**
 * Whether a user holds the `admin` or `superadmin` role in any scope. Deliberately a local,
 * private copy of the same check `session.ts` and `privileged-login-alert.ts` each already keep
 * for themselves, rather than a shared import - matching this module's own established
 * convention (see `privileged-login-alert.ts`'s identical copy and its own doc comment) of a
 * small self-contained duplicate per module over a shared one, so each security-relevant module
 * ships as its own independent, easily-reviewed change.
 */
async function hasElevatedRole(db: Db, userId: string): Promise<boolean> {
  const assignments = await db.roleAssignment.findMany({
    where: { user_id: userId },
    select: { role: true },
  });
  return assignments.some((a) => a.role === "superadmin" || a.role === "admin");
}

/**
 * Fires `auth.login.new_country` when an admin/superadmin account signs in from a country not
 * seen among its own recent successful logins - a possible sign of a stolen credential being
 * used somewhere the real owner has never been, alongside the more mundane case of an admin
 * traveling for the first time.
 *
 * Called from `finalizeLoginSession` (login.ts) BEFORE `logLoginSuccess` persists the current
 * login's own `SecurityAuditLog` row - deliberately, so the "recent logins" query below reads
 * only prior logins and never needs to exclude the row this very call is about, which would
 * otherwise always look "seen" since it's the current country by definition.
 *
 * Runs at first-factor success, same as `auth.login.success` itself (this module's own audit
 * trail, and the admin "Recent logins" panel built on it, already treat that as "a login" even
 * when MFA is still pending) - not gated on the session reaching `SESSION_STAGE.FULL`. A correct
 * password from a country never seen on this account is itself the notable signal, independent
 * of whether the second factor is ever completed; gating on full MFA completion would silently
 * drop exactly the case - a stolen password used from an unfamiliar country, with MFA never
 * passed - this check exists to surface.
 *
 * No-ops (and does none of the writes in `logLoginNewCountry`) when: the account has no elevated
 * role; the current login's IP doesn't resolve to a country (unknown/private/internal address -
 * nothing to compare); this is the account's very first successful login ever (no baseline to be
 * "new" against); every one of the last `RECENT_LOGIN_HISTORY_SIZE` logins also failed to resolve
 * to a country (no reliable baseline - an account that always signs in from a VPN/private range
 * would otherwise see every login flagged "new", which is noise, not signal); or the current
 * country is already among those seen. Matches `privileged-login-alert.ts`'s own precedent: the
 * queries below are unwrapped, not defensively try/caught - a genuine database failure here is
 * allowed to propagate and fail the login attempt itself, the same as `resetFailedLoginStreak`'s
 * unwrapped write immediately after this runs; only `logLoginNewCountry`'s own audit-log write
 * and notification dispatch (both already never-throwing) are reached once this decides to fire.
 */
export async function checkNewCountryLogin(
  db: Db,
  ctx: { userId: string; email: string; ip?: string },
): Promise<void> {
  if (!ctx.ip) return;
  const current = resolveIpLocation(ctx.ip);
  if (current.kind !== "resolved" || !current.countryCode) return;

  if (!(await hasElevatedRole(db, ctx.userId))) return;

  const priorLogins = await db.securityAuditLog.findMany({
    where: { user_id: ctx.userId, event_type: "auth.login.success" },
    orderBy: { created_at: "desc" },
    take: RECENT_LOGIN_HISTORY_SIZE,
    select: { ip: true },
  });
  if (priorLogins.length === 0) return;

  const seenCountries = new Set(
    priorLogins
      .map((row) => resolveIpLocation(row.ip))
      .filter((loc) => loc.kind === "resolved" && loc.countryCode)
      .map((loc) => loc.countryCode),
  );
  if (seenCountries.size === 0 || seenCountries.has(current.countryCode)) return;

  await logLoginNewCountry(db, {
    userId: ctx.userId,
    email: ctx.email,
    ip: ctx.ip,
    countryCode: current.countryCode,
  });
}
