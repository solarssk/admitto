/** Refuse Prisma setup against databases that do not look like test targets. */
export function assertTestDatabaseUrl(databaseUrl: string): void {
  const lower = databaseUrl.toLowerCase();
  if (
    lower.includes("_test") ||
    lower.includes("localhost") ||
    lower.includes("127.0.0.1")
  ) {
    return;
  }
  throw new Error(
    `Refusing Prisma setup: DATABASE_URL does not look like a test database (${databaseUrl})`,
  );
}
