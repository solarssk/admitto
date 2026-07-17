/**
 * Test-infrastructure helper, not runtime application logic - lives here purely because every
 * package that needs it (db itself, auth, tickets, import) already depends on this one, avoiding a
 * fifth near-identical copy that would otherwise trip SonarCloud's duplicated-lines gate. See
 * apps/web/test/ADR-0015-test-strategy.md for the incident that motivated this.
 *
 * Deliberately NOT re-exported from `./index.js` (the `@admitto/db` barrel): that module
 * instantiates a live PrismaClient at import time, and Prisma's own dotenv auto-loading can then
 * pull DATABASE_URL from packages/db/.env (the real dev database) as a side effect - clobbering
 * whatever a consumer's test runner had already set. Import this file via the `@admitto/db/test-db-guard`
 * subpath instead, which never touches index.js.
 */

/**
 * Refuse Prisma setup unless DATABASE_URL targets a `*_test` database.
 *
 * The database name is the only signal checked - a `localhost`-or-similar host used to be
 * trusted on its own, but a developer's real dev database (`packages/db/.env`'s
 * `DATABASE_URL`, e.g. `localhost:5432/admitto`) is *also* on localhost, so that bypass let
 * every destructive `db push --force-reset` call site proceed against it whenever tests ran
 * unscoped (e.g. from the repo root, or via a config that forwards an ambient DATABASE_URL -
 * see packages/auth/vitest.integration.config.ts). Matches infra/scripts/reset-test-db.sh's
 * own independent name check.
 */
export function assertTestDatabaseUrl(databaseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('Refusing Prisma setup: DATABASE_URL is not a valid URL');
  }

  const host = parsed.hostname.toLowerCase();
  const dbName = parsed.pathname.replace(/^\//, '').toLowerCase();
  const isTestDb = dbName.includes('_test');

  if (isTestDb) return;

  throw new Error(
    `Refusing Prisma setup: DATABASE_URL host "${host}" database "${dbName || '(default)'}" does not look like a test target`,
  );
}
