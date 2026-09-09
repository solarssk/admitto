import { defineConfig } from "vitest/config";
import { sharedTestEnv } from "./vitest.shared.ts";

/**
 * Serial group: every `test/integration/*.test.ts` file that reads or writes one of the two
 * single, GLOBAL (not per-tenant/per-org) tables in this schema:
 *
 * - `SystemSettings` - instance-wide key-value flags (webauthn_enabled, instance_url,
 *   setup_complete, cf_access_*, branding_theme, passkey_login_enabled, mfa_required_roles,
 *   csp_trusted_origins).
 * - `SecurityAuditLog` - the durable auth/security-event trail (logins, MFA, OIDC,
 *   access-denied). Deliberately has no organization_id/event_id column at all (see its doc
 *   comment in packages/db/prisma/schema.prisma) - a superadmin views it instance-wide, so a
 *   test that lists it or asserts an exact row count/order is asserting on EVERY row in the
 *   table, not just its own.
 *
 * Both are shared mutable global state, so any file touching either must keep running one at a
 * time against `admitto_web_test` - see `vitest.integration-parallel.config.ts` for the rest
 * (verified to have zero cross-file collisions and run with `fileParallelism: true`).
 *
 * This list was produced by grepping every integration test file (and every support/helper file
 * under test/) for `.systemSettings.`/`.securityAuditLog.` (the Prisma model accessors), the
 * `SETTING_*` key-name constants exported from `@admitto/auth` (packages/auth/src/settings/keys.ts),
 * and every resolver/setter that reads through to SystemSettings (getSetting/setSetting,
 * getBrandingTheme/setBrandingTheme, getWebauthnEnabled, getPasskeyLoginEnabled,
 * resolveInstanceBaseUrl, markSetupComplete, etc.) - not just a literal string match, since a file
 * can touch either table indirectly through one of those. Two files matched a SystemSettings
 * identifier but do NOT actually touch that table for real and were deliberately left in the
 * parallel group: `geocoding-user-agent.test.ts` only mentions `setSetting` in a comment (it
 * manipulates `process.env.BASE_URL` directly, never the DB - see the comment at the top of that
 * file), and `public-ref-routes.test.ts` only calls `getBrandingTheme` through `vi.spyOn` in tests
 * that mock or assert on it, never a real unmocked write.
 *
 * `security-audit-routes.test.ts` was moved here after the initial SystemSettings-only split
 * still flaked under real `fileParallelism` (found empirically, per this repo's own "verify
 * empirically" convention - not predicted from static analysis alone): its own `seed()` runs an
 * unconditional `securityAuditLog.deleteMany({})` (documented in that file as deliberate, since
 * the table has no scoping to delete by) and its tests assert exact `total`/ordering from the
 * real GET /api/admin/security-audit-log route - both break the moment any concurrently-running
 * sibling that exercises a real login/MFA flow (most of the parallel group does, as normal test
 * setup) writes or deletes a row while this file's request is in flight. First evidence was
 * `account-routes.test.ts` failing intermittently (12-29 of its 114 tests, varying by run) in
 * the same batch - its own "step-up for MFA-required roles" tests assert
 * `securityAuditLog.findFirst(...)` rows scoped to their own `user_id`, which
 * `security-audit-routes.test.ts`'s unconditional wipe can delete mid-flight. Confirmed the
 * direction of causation empirically rather than assuming: 3 solo re-runs of just
 * `account-routes.test.ts` passed 114/114 every time, and 3 full re-runs of the other 44 parallel
 * files WITHOUT `security-audit-routes.test.ts` (`account-routes.test.ts` included) passed
 * 1439/1439 every time - so only `security-audit-routes.test.ts` itself needed to move, not the
 * file it was corrupting.
 *
 * Adding a new file here: if it does not appear in this list, it runs in the parallel group by
 * default (see that config's `exclude`) - a new file that touches SystemSettings or
 * SecurityAuditLog must be added to BOTH this `include` array and the other config's `exclude`
 * array, or it will run unserialized against files here and can flake.
 */
export default defineConfig({
  test: {
    name: "integration",
    include: [
      "test/integration/admin-communication.test.ts",
      "test/integration/admin-system-settings.test.ts",
      "test/integration/cf-access-routes.test.ts",
      "test/integration/event-settings-routes.test.ts",
      "test/integration/identity-api-routes.test.ts",
      "test/integration/login-page.test.ts",
      "test/integration/mail-settings.test.ts",
      "test/integration/mfa-routes.test.ts",
      "test/integration/passkey-login-routes.test.ts",
      "test/integration/security-audit-routes.test.ts",
      "test/integration/setup-page.test.ts",
      "test/integration/setup-wizard-api.test.ts",
      "test/integration/staff-foundation.test.ts",
      "test/integration/users-routes.test.ts",
      "test/integration/webauthn-account-routes.test.ts",
    ],
    // apps/web's own tsconfig compiles test/ too (its `build` script isn't test-scoped), so a
    // stale `dist/` from a prior build can leave compiled .test.js copies sitting next to the
    // source .test.ts files. Vitest's own default excludes dist/, but that stopped applying once
    // this config started being resolved from a root-level vitest.config.ts aggregator instead of
    // its own package directory (2026-07-18 root-run incident) - excluding it explicitly here
    // doesn't depend on which context resolves this file.
    exclude: ["dist/**", "**/node_modules/**"],
    globalSetup: ["test/integrationGlobalSetup.ts"],
    setupFiles: ["test/integrationEnv.ts"],
    environment: "node",
    fileParallelism: false,
    pool: "forks",
    maxWorkers: 1,
    env: sharedTestEnv,
  },
});
