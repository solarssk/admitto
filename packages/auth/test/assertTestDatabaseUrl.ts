/** Refuse Prisma setup against databases that do not look like test targets. */
export function assertTestDatabaseUrl(databaseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Refusing Prisma setup: DATABASE_URL is not a valid URL");
  }

  const host = parsed.hostname.toLowerCase();
  const dbName = parsed.pathname.replace(/^\//, "").toLowerCase();
  const isTestHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const isTestDb = dbName.includes("_test") || dbName.endsWith("_test");

  if (isTestHost || isTestDb) return;

  throw new Error(
    `Refusing Prisma setup: DATABASE_URL host "${host}" database "${dbName || "(default)"}" does not look like a test target`,
  );
}
