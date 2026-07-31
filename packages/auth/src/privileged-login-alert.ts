import type { PrismaClient, Prisma, User } from "@admitto/db";
import { logRepeatedFailedLogins } from "./audit.js";
import { PRIVILEGED_LOGIN_FAILURE_ALERT_THRESHOLD } from "./constants.js";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Whether a user holds the `admin` or `superadmin` role in any scope. Deliberately a local,
 * private copy of the same check `session.ts` uses for TTL selection, rather than an import —
 * this module has no other dependency on `session.ts`, and keeping it self-contained lets this
 * P0 security review item ship as its own independent change.
 */
async function hasElevatedRole(db: Db, userId: string): Promise<boolean> {
  const assignments = await db.roleAssignment.findMany({
    where: { user_id: userId },
    select: { role: true },
  });
  return assignments.some((a) => a.role === "superadmin" || a.role === "admin");
}

/**
 * Track consecutive failed login attempts against admin/superadmin accounts (P0 security
 * review). Non-elevated accounts are intentionally never tracked here — brute-forcing an
 * operator account is already covered by the existing per-IP/per-email rate limits, and
 * `User.failed_login_streak` exists specifically to answer "is a *privileged* account under
 * attack", not to duplicate that throttling. Increments the streak and, once it crosses
 * `PRIVILEGED_LOGIN_FAILURE_ALERT_THRESHOLD`, emits `auth.login.repeated_failures` and resets
 * the streak immediately — so a sustained attack re-alerts every N attempts instead of firing
 * once and going silent for the rest of the attack.
 */
export async function recordFailedLoginForPrivilegedUser(
  db: Db,
  user: Pick<User, "id" | "email" | "failed_login_streak">,
  ctx: { ip?: string },
): Promise<void> {
  if (!(await hasElevatedRole(db, user.id))) return;

  const streak = user.failed_login_streak + 1;
  if (streak >= PRIVILEGED_LOGIN_FAILURE_ALERT_THRESHOLD) {
    await db.user.update({ where: { id: user.id }, data: { failed_login_streak: 0 } });
    await logRepeatedFailedLogins(db, { userId: user.id, email: user.email, ip: ctx.ip, streak });
    return;
  }
  await db.user.update({ where: { id: user.id }, data: { failed_login_streak: streak } });
}

/** Reset the consecutive-failure streak after a successful login — the attack ended, or it was
 * the legitimate owner mistyping their password a few times first. No-op when already 0, to
 * avoid an extra write on the overwhelmingly common case (no prior failures). */
export async function resetFailedLoginStreak(
  db: Db,
  user: Pick<User, "id" | "failed_login_streak">,
): Promise<void> {
  if (user.failed_login_streak === 0) return;
  await db.user.update({ where: { id: user.id }, data: { failed_login_streak: 0 } });
}
