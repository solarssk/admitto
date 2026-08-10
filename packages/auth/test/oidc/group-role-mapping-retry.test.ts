import { Prisma, type PrismaClient } from "@admitto/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyOidcGroupRoleMappings,
  isSerializationFailure,
} from "../../src/oidc/group-role-mapping.js";

function serializationError(
  extras: { meta?: Record<string, unknown> } = {},
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("could not serialize access", {
    code: "P2034",
    clientVersion: "test",
    ...extras,
  });
}

function superadminGrant() {
  return {
    id: "grant_1",
    role_assignment_id: "ra_1",
    role: "superadmin",
    scope_type: "instance",
    scope_id: null,
    user_id: "user_1",
    provider_id: "prov_1",
  };
}

function prismaForRevokeRetry($transaction: (...args: unknown[]) => unknown): PrismaClient {
  return {
    oidcGroupRoleMapping: { findMany: vi.fn().mockResolvedValue([]) },
    oidcRoleGrant: { findMany: vi.fn().mockResolvedValue([superadminGrant()]) },
    // Active instance-superadmin assignment still present → Serializable floor-guard path.
    roleAssignment: { count: vi.fn().mockResolvedValue(1) },
    $transaction,
  } as unknown as PrismaClient;
}

describe("isSerializationFailure", () => {
  it("detects P2034 and driver-adapter conflict causes", () => {
    expect(isSerializationFailure(serializationError())).toBe(true);
    expect(
      isSerializationFailure({
        code: "OTHER",
        meta: { driverAdapterError: { cause: { originalCode: "40001" } } },
      }),
    ).toBe(true);
    expect(
      isSerializationFailure({
        code: "OTHER",
        meta: { driverAdapterError: { cause: { kind: "TransactionWriteConflict" } } },
      }),
    ).toBe(true);
  });

  it("rejects non-serialization values", () => {
    expect(isSerializationFailure(null)).toBe(false);
    expect(isSerializationFailure("P2034")).toBe(false);
    expect(isSerializationFailure(new Error("boom"))).toBe(false);
    expect(
      isSerializationFailure(
        new Prisma.PrismaClientKnownRequestError("unique", {
          code: "P2002",
          clientVersion: "test",
        }),
      ),
    ).toBe(false);
  });
});

describe("applyOidcGroupRoleMappings serialization retry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries a Serializable revoke after P2034 then succeeds", async () => {
    vi.useFakeTimers();
    const $transaction = vi
      .fn()
      .mockRejectedValueOnce(serializationError())
      .mockResolvedValueOnce(true);

    const done = applyOidcGroupRoleMappings(prismaForRevokeRetry($transaction), "prov_1", "user_1", []);
    await vi.runAllTimersAsync();

    await expect(done).resolves.toBe(1);
    expect($transaction).toHaveBeenCalledTimes(2);
  });

  it("rethrows after serialization retries are exhausted", async () => {
    vi.useFakeTimers();
    const $transaction = vi.fn().mockRejectedValue(serializationError());

    const done = applyOidcGroupRoleMappings(prismaForRevokeRetry($transaction), "prov_1", "user_1", []);
    const assertion = expect(done).rejects.toMatchObject({ code: "P2034" });
    await vi.runAllTimersAsync();
    await assertion;
    expect($transaction).toHaveBeenCalledTimes(12);
  });

  it("does not retry a non-serialization revoke failure", async () => {
    const $transaction = vi.fn().mockRejectedValue(new Error("db down"));

    await expect(
      applyOidcGroupRoleMappings(prismaForRevokeRetry($transaction), "prov_1", "user_1", []),
    ).rejects.toThrow("db down");
    expect($transaction).toHaveBeenCalledTimes(1);
  });
});
