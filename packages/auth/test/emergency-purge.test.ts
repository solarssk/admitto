import { describe, expect, it, vi } from "vitest";
import { purgeAllSessions } from "../src/emergency-purge.js";

describe("purgeAllSessions", () => {
  it("dry-run returns counts without updates", async () => {
    const prisma = {
      session: { count: vi.fn().mockResolvedValue(3), updateMany: vi.fn() },
      trustedDevice: { count: vi.fn().mockResolvedValue(2), updateMany: vi.fn() },
      $transaction: vi.fn(),
    };

    const result = await purgeAllSessions(prisma as never, { dryRun: true });

    expect(result).toEqual({ sessionsRevoked: 3, trustedDevicesRevoked: 2 });
    expect(prisma.session.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("revokes active sessions and trusted devices in a transaction", async () => {
    const tx = {
      session: { updateMany: vi.fn().mockResolvedValue({ count: 4 }) },
      trustedDevice: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      session: { count: vi.fn() },
      trustedDevice: { count: vi.fn() },
      $transaction: vi.fn(async (fn: (inner: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    const result = await purgeAllSessions(prisma as never);

    expect(result).toEqual({ sessionsRevoked: 4, trustedDevicesRevoked: 1 });
    expect(tx.session.updateMany).toHaveBeenCalledWith({
      where: { revoked_at: null },
      data: { revoked_at: expect.any(Date) },
    });
    expect(tx.trustedDevice.updateMany).toHaveBeenCalledWith({
      where: { revoked_at: null },
      data: { revoked_at: expect.any(Date) },
    });
  });
});
