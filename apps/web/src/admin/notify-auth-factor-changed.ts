import type { PrismaClient } from "@admitto/db";
import { notify } from "@admitto/notifications";
import { resolveInstanceOrganizationId } from "./instance-org.js";

/**
 * ASVS V2.5.5 / NIST SP 800-63-4 §4.1.2.1-§4.4: every place in this app that changes a user's own
 * password, MFA method, passkey, trusted devices, or SSO link - whether the user did it themselves
 * or an admin did it for them - fires this same self-audience notification at the account owner.
 * See account.auth_factor.changed's own doc comment in packages/notifications/src/registry.ts.
 * Shared across apps/web/src/admin/account-routes.ts (self-service), apps/web/src/admin/users-routes.ts
 * (admin-assisted resets), apps/web/src/auth/change-password-routes.ts (forced password change), and
 * apps/web/src/auth/oidc-routes.ts (SSO link) - the same cross-directory import pattern already used
 * by resolveInstanceOrganizationId from those same non-admin files.
 *
 * Always called with `db` (the plain client), never a `tx` - notify() requires a standalone
 * `PrismaClient` and must never run inside a still-open transaction (dispatcher.ts's own Db-type
 * comment), so every call site fires this only after its own write transaction has already
 * committed, not from inside a `runInTransaction`/`withStepUpGate`/`$transaction` body callback.
 *
 * Fired without awaiting (`void notifyAuthFactorChanged(...)` at each call site), matching
 * `dispatchSecurityNotification`'s own HTTP-reached call sites in packages/auth/src/audit.ts:
 * every caller is a request handler with a live response to send, and a configured email/webhook
 * delivery can take up to 15 seconds (this repo's mail-transport timeout) - that latency must not
 * become part of the credential-change response itself. Never throws: resolving the instance
 * organization can fail (unseeded instance), notify() itself never can.
 */
export async function notifyAuthFactorChanged(
  db: PrismaClient,
  userId: string,
  title: string,
  body: string,
): Promise<void> {
  try {
    const organizationId = await resolveInstanceOrganizationId(db);
    await notify(db, "account.auth_factor.changed", {
      organizationId,
      title,
      body,
      targetUserId: userId,
      dedupeKey: userId,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "account.notify_auth_factor_changed_failed",
        error: err instanceof Error ? err.message : String(err),
        ts: new Date().toISOString(),
      }),
    );
  }
}
