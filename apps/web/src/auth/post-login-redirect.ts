import type { PrismaClient } from "@admitto/db";
import {
  canAccessCheckInPanel,
  getCfAccessConfigCached,
  pathMatchesCfProtectedPrefix,
} from "@admitto/auth";
import { resolvePostLoginRedirect } from "./safe-redirect.js";

function isAdminStaffPath(path: string): boolean {
  return path === "/admin" || path.startsWith("/admin/");
}

/**
 * A local-password or direct-OIDC login only ever produces a session cookie - never a Cloudflare
 * Access JWT. If /admin is one of the paths Cloudflare Access itself protects at the edge, that
 * session cannot actually reach it (see docs/wiki/Cloudflare-Access-Identity-Linking.md). Land
 * on /operator instead when this account can use it - which, per canAccessCheckInPanel, is every
 * admin and superadmin as long as at least one event exists, not just accounts with an explicit
 * operator assignment. Only fall back to /account (no admin/operator surface reachable at all) in
 * the genuine edge case where none exists yet.
 */
async function reachableAdminLanding(
  db: PrismaClient,
  userId: string,
  landing: string,
): Promise<string> {
  if (!isAdminStaffPath(landing)) return landing;

  const cfConfig = await getCfAccessConfigCached(db);
  if (!cfConfig.enabled || !pathMatchesCfProtectedPrefix(landing, cfConfig.protectedPrefixes)) {
    return landing;
  }

  if (await canAccessCheckInPanel(db, userId)) {
    return "/operator";
  }
  return "/account";
}

export async function resolvePostLoginRedirectForUser(
  db: PrismaClient,
  userId: string,
  next?: string,
): Promise<string> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { must_change_password: true },
  });
  if (user?.must_change_password) return "/change-password";

  const assignments = await db.roleAssignment.findMany({
    where: { user_id: userId },
    select: { role: true, scope_type: true, scope_id: true },
  });
  const landing = resolvePostLoginRedirect(next, assignments);
  return reachableAdminLanding(db, userId, landing);
}
