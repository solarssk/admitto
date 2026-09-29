export type SetupCheckKey = "database" | "redis" | "encryption" | "base_url";

const FIX_HINTS: Record<SetupCheckKey, string> = {
  database: `Verify DATABASE_URL in your .env or Docker environment points to a running PostgreSQL instance.
If the database is up but migrations are pending, run:
  npx prisma migrate deploy
In Docker Compose, migrations run in the separate migrate service, once, before the app starts - check its log. Restart the stack after fixing DATABASE_URL.`,
  redis: `If you use Redis for rate limiting or sessions, set REDIS_URL and ensure the Redis service is reachable.
For single-node dev without Redis, the in-memory store is acceptable. Check your deployment docs.`,
  encryption: `Set ENCRYPTION_KEY in your .env file or Docker environment (32 bytes, base64-encoded):
  ENCRYPTION_KEY=$(openssl rand -base64 32)
Then restart the server.`,
  base_url: `Set BASE_URL in your environment to the public https address of this site, for example:
  BASE_URL=https://tickets.example.com
Then restart Admitto. This check specifically wants BASE_URL: with only the Settings → General value set, ticket links and sign-in still work, but this check stays red until BASE_URL is also set.`,
};

/** Operator-facing remediation copy for a failed setup readiness check. */
export function checkFixHint(key: SetupCheckKey): string {
  return FIX_HINTS[key];
}

export const SETUP_CHECK_ORDER: SetupCheckKey[] = [
  "database",
  "redis",
  "encryption",
  "base_url",
];

export const SETUP_CHECK_LABELS: Record<SetupCheckKey, string> = {
  database: "Database",
  redis: "Redis",
  encryption: "Encryption key",
  base_url: "Base URL",
};
