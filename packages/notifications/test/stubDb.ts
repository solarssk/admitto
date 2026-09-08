import { vi } from "vitest";

/**
 * Minimal stub covering exactly the Prisma model methods this package's own logic calls -
 * pure unit tests, no Postgres (mirrors packages/wallet's stub-provider.ts style testing).
 * Cast to PrismaClient at each call site: `createStubDb() as unknown as PrismaClient`.
 */
export function createStubDb() {
  return {
    roleAssignment: { findMany: vi.fn(), count: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    notificationSettings: { findUnique: vi.fn() },
    notificationPreference: { findMany: vi.fn() },
    notificationThrottle: { create: vi.fn(), updateMany: vi.fn() },
    notification: { createMany: vi.fn() },
    securityAuditLog: { create: vi.fn() },
  };
}

export type StubDb = ReturnType<typeof createStubDb>;
