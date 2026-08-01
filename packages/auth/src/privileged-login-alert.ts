import type { PrismaClient, Prisma, User } from "@admitto/db";
import { logRepeatedFailedLogins } from "./audit.js";
import { PRIVILEGED_LOGIN_FAILURE_ALERT_THRESHOLD } from "./constants.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** Stable nil user id for timing-equalized probes when no account row exists. */
const TIMING_PAD_USER_ID = "00000000-0000-0000-0000-000000000000";

type StreakBumpRow = { should_alert: boolean };

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

/** No-op streak write with the same shape as the privileged path, for timing parity. */
async function runTimingPadStreakWrite(db: Db): Promise<void> {
  await db.user.updateMany({
    where: { id: TIMING_PAD_USER_ID },
    data: { failed_login_streak: { increment: 1 } },
  });
}

/**
 * Atomically increment the persisted streak and wrap to 0 once the threshold is reached.
 * Concurrent failures serialize on the row lock, so only one caller observes the wrap and
 * emits `auth.login.repeated_failures` per block of N attempts.
 */
async function bumpPrivilegedLoginStreakAtomic(
  db: Db,
  user: Pick<User, "id" | "email">,
  ctx: { ip?: string },
): Promise<void> {
  const rows = await db.$queryRaw<StreakBumpRow[]>`
    UPDATE "User"
    SET "failed_login_streak" = ("failed_login_streak" + 1) % ${PRIVILEGED_LOGIN_FAILURE_ALERT_THRESHOLD}
    WHERE "id" = ${user.id}
    RETURNING ("failed_login_streak" = 0) AS "should_alert"
  `;
  if (rows[0]?.should_alert) {
    await logRepeatedFailedLogins(db, {
      userId: user.id,
      email: user.email,
      ip: ctx.ip,
      streak: PRIVILEGED_LOGIN_FAILURE_ALERT_THRESHOLD,
    });
  }
}

/**
 * Side effects after a failed password login. Always performs two database round trips
 * (role probe + streak write) so unknown-email failures stay timing-aligned with
 * `verifyPasswordOrDummy` and cannot be distinguished from existing accounts.
 */
export async function recordFailedLoginFailureSideEffects(
  db: Db,
  user: Pick<User, "id" | "email"> | null,
  ctx: { ip?: string },
): Promise<void> {
  const roleProbeUserId = user?.id ?? TIMING_PAD_USER_ID;
  const elevated = await hasElevatedRole(db, roleProbeUserId);

  if (!user || !elevated) {
    await runTimingPadStreakWrite(db);
    return;
  }

  await bumpPrivilegedLoginStreakAtomic(db, user, ctx);
}

/** Reset the consecutive-failure streak after a successful login — the attack ended, or it was
 * the legitimate owner mistyping their password a few times first. Reads the persisted counter
 * in the database instead of the in-memory user row loaded at the start of `login()`, so a
 * concurrent failed attempt cannot leave a nonzero streak behind after success. */
export async function resetFailedLoginStreak(db: Db, userId: string): Promise<void> {
  await db.user.updateMany({
    where: { id: userId, failed_login_streak: { gt: 0 } },
    data: { failed_login_streak: 0 },
  });
}
