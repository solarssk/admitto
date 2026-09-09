import { defineConfig } from "vitest/config";
import { sharedTestEnv } from "./vitest.shared.ts";

/**
 * Parallel-safe group: every `test/integration/*.test.ts` file EXCEPT the ones listed in
 * `vitest.integration.config.ts`'s `include` (those touch one of the two single, global,
 * unscoped tables - `SystemSettings` or `SecurityAuditLog` - and must stay serialized against
 * each other; see the comment there for how that list was produced and verified). The files here
 * use file/feature-namespaced literal fixture IDs (organization/event/user rows) with no
 * cross-file collisions, so they can safely run with real `fileParallelism` against the same
 * shared `admitto_web_test` database.
 *
 * Adding a new file: it lands here automatically (nothing to do) unless it touches SystemSettings
 * or SecurityAuditLog, in which case move it to the `include` list in
 * `vitest.integration.config.ts` and add it to the `exclude` list below instead.
 */
export default defineConfig({
  test: {
    name: "integration-parallel",
    include: ["test/integration/**/*.test.ts"],
    exclude: [
      "dist/**",
      "**/node_modules/**",
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
    globalSetup: ["test/integrationGlobalSetup.ts"],
    setupFiles: ["test/integrationEnv.ts"],
    environment: "node",
    fileParallelism: true,
    pool: "forks",
    env: sharedTestEnv,
  },
});
