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

/** Refuse Prisma setup unless DATABASE_URL targets a local or `*_test` database. */
export function assertTestDatabaseUrl(databaseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('Refusing Prisma setup: DATABASE_URL is not a valid URL');
  }

  const host = parsed.hostname.toLowerCase();
  const dbName = parsed.pathname.replace(/^\//, '').toLowerCase();
  const isTestHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const isTestDb = dbName.includes('_test') || dbName.endsWith('_test');

  if (isTestHost || isTestDb) return;

  throw new Error(
    `Refusing Prisma setup: DATABASE_URL host "${host}" database "${dbName || '(default)'}" does not look like a test target`,
  );
}
