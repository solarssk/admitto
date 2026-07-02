export type SetupCheckKey = "database" | "migrations" | "redis" | "encryption" | "base_url";

const FIX_HINTS: Record<SetupCheckKey, string> = {
  database: `Verify DATABASE_URL in your .env or Docker environment points to a running PostgreSQL instance.
Then restart the Admitto web service and retry this check.`,
  migrations: `Run pending Prisma migrations against your database:
  npx prisma migrate deploy
Or, in Docker Compose, run the migrate job/container before starting the web app.`,
  redis: `If you use Redis for rate limiting or sessions, set REDIS_URL and ensure the Redis service is reachable.
For single-node dev without Redis, the in-memory store is acceptable — check your deployment docs.`,
  encryption: `Set ENCRYPTION_KEY in your .env file or Docker environment (32 bytes, base64-encoded):
  ENCRYPTION_KEY=$(openssl rand -base64 32)
Then restart the server.`,
  base_url: `Set the Instance URL in Settings → General, or set BASE_URL in your environment, for example:
  BASE_URL=https://tickets.example.com
In production, BASE_URL env is required for server boot/restarts; the Settings value is used for mail links at runtime.`,
};

/** Operator-facing remediation copy for a failed setup readiness check. */
export function checkFixHint(key: SetupCheckKey): string {
  return FIX_HINTS[key];
}

export const SETUP_CHECK_ORDER: SetupCheckKey[] = [
  "database",
  "migrations",
  "redis",
  "encryption",
  "base_url",
];

export const SETUP_CHECK_LABELS: Record<SetupCheckKey, string> = {
  database: "Database",
  migrations: "Migrations",
  redis: "Redis",
  encryption: "Encryption key",
  base_url: "Instance URL",
};
