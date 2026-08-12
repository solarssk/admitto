import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { createTestPrismaClient } from "../src/testing.js";
import { backfillJitPasswordHash } from "../src/backfill-jit-password-hash.js";
import { assertTestDatabaseUrl } from "../src/testDbGuard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..");

const PROVIDER_ID = "idp-backfill-jit-password";

let prisma: PrismaClient;
let userSeq = 0;

beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });
  prisma = createTestPrismaClient();
  await prisma.identityProvider.create({
    data: {
      id: PROVIDER_ID,
      issuer: "https://idp.example.test/",
      client_id: "backfill-jit-password-client",
      authorization_endpoint: "https://idp.example.test/authorize",
      token_endpoint: "https://idp.example.test/token",
      jwks_uri: "https://idp.example.test/jwks",
      display_name: "Test IdP",
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** A JIT-style user + identity: both timestamped identically, as resolve-user.ts's single
 * transaction produces (both columns default to CURRENT_TIMESTAMP, frozen per-transaction). */
async function makeJitUser(opts: { passwordHash: string | null }) {
  userSeq += 1;
  const jitInstant = new Date();
  const user = await prisma.user.create({
    data: {
      id: `usr-backfill-jit-${userSeq}`,
      email: `jit-${userSeq}@example.com`,
      password_hash: opts.passwordHash,
      created_at: jitInstant,
    },
  });
  await prisma.externalIdentity.create({
    data: {
      provider_id: PROVIDER_ID,
      subject: `jit-subject-${userSeq}`,
      user_id: user.id,
      linked_at: jitInstant,
    },
  });
  return user;
}

async function makeAuditEntry(opts: {
  actionType: "account_password_changed" | "user_password_reset";
  actorUserId: string;
  metadataUserId?: string;
}) {
  return prisma.adminAuditLog.create({
    data: {
      actor_user_id: opts.actorUserId,
      action_type: opts.actionType,
      metadata: opts.metadataUserId ? { userId: opts.metadataUserId } : undefined,
    },
  });
}

describe("backfillJitPasswordHash", () => {
  it("nulls the placeholder hash for a JIT-provisioned user with no password-change history", async () => {
    const user = await makeJitUser({ passwordHash: "placeholder-hash" });

    const result = await backfillJitPasswordHash(prisma);
    expect(result.updated).toBeGreaterThanOrEqual(1);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.password_hash).toBeNull();
  });

  it("nulls the hash when linked_at trails created_at by a couple of seconds (realistic same-transaction drift)", async () => {
    userSeq += 1;
    const createdAt = new Date("2026-03-01T00:00:00.000Z");
    const user = await prisma.user.create({
      data: {
        id: `usr-backfill-jit-${userSeq}`,
        email: `jit-drift-${userSeq}@example.com`,
        password_hash: "placeholder-hash-drift",
        created_at: createdAt,
      },
    });
    await prisma.externalIdentity.create({
      data: {
        provider_id: PROVIDER_ID,
        subject: `jit-drift-subject-${userSeq}`,
        user_id: user.id,
        linked_at: new Date(createdAt.getTime() + 2000),
      },
    });

    await backfillJitPasswordHash(prisma);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.password_hash).toBeNull();
  });

  it("leaves the hash untouched when linked_at trails created_at by more than the 5s tolerance", async () => {
    userSeq += 1;
    const createdAt = new Date("2026-03-01T00:00:00.000Z");
    const user = await prisma.user.create({
      data: {
        id: `usr-backfill-jit-${userSeq}`,
        email: `jit-too-late-${userSeq}@example.com`,
        password_hash: "real-hash-too-late",
        created_at: createdAt,
      },
    });
    await prisma.externalIdentity.create({
      data: {
        provider_id: PROVIDER_ID,
        subject: `jit-too-late-subject-${userSeq}`,
        user_id: user.id,
        linked_at: new Date(createdAt.getTime() + 10_000),
      },
    });

    await backfillJitPasswordHash(prisma);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.password_hash).toBe("real-hash-too-late");
  });

  it("leaves the hash untouched when the user self-service changed their password since (account_password_changed, actor = self)", async () => {
    const user = await makeJitUser({ passwordHash: "real-hash-self-changed" });
    await makeAuditEntry({ actionType: "account_password_changed", actorUserId: user.id });

    await backfillJitPasswordHash(prisma);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.password_hash).toBe("real-hash-self-changed");
  });

  it("leaves the hash untouched when an admin reset it since (user_password_reset, metadata.userId)", async () => {
    const user = await makeJitUser({ passwordHash: "real-hash-admin-reset" });
    await makeAuditEntry({ actionType: "user_password_reset", actorUserId: "usr-some-admin", metadataUserId: user.id });

    await backfillJitPasswordHash(prisma);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.password_hash).toBe("real-hash-admin-reset");
  });

  it("leaves the hash untouched for an account that linked SSO after being created locally (linked_at after created_at)", async () => {
    userSeq += 1;
    const user = await prisma.user.create({
      data: {
        id: `usr-backfill-jit-${userSeq}`,
        email: `local-then-linked-${userSeq}@example.com`,
        password_hash: "real-local-password",
        created_at: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    await prisma.externalIdentity.create({
      data: {
        provider_id: PROVIDER_ID,
        subject: `local-then-linked-subject-${userSeq}`,
        user_id: user.id,
        linked_at: new Date("2026-02-01T00:00:00.000Z"),
      },
    });

    await backfillJitPasswordHash(prisma);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.password_hash).toBe("real-local-password");
  });

  it("leaves a purely local user (no external identity) untouched", async () => {
    userSeq += 1;
    const user = await prisma.user.create({
      data: { id: `usr-backfill-jit-${userSeq}`, email: `local-only-${userSeq}@example.com`, password_hash: "real-local-only" },
    });

    await backfillJitPasswordHash(prisma);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.password_hash).toBe("real-local-only");
  });

  it("is idempotent on a second run", async () => {
    const first = await backfillJitPasswordHash(prisma);
    expect(first.updated).toBe(0);
  });
});
