import { Prisma, type PrismaClient } from "@admitto/db";
import { describe, expect, it, vi } from "vitest";
import {
  isSerializationFailure,
  runSerializableTransaction,
} from "../../src/admin/event-items-api-routes.js";

function serializationError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("could not serialize access", {
    code: "P2034",
    clientVersion: "test",
  });
}

function driverAdapterWrappedSerializationError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("could not serialize access", {
    code: "P2028",
    clientVersion: "test",
    meta: { driverAdapterError: { cause: { originalCode: "40001" } } },
  });
}

describe("isSerializationFailure", () => {
  it("is true for a P2034-coded error", () => {
    expect(isSerializationFailure(serializationError())).toBe(true);
  });

  it("is true for a driver-adapter-wrapped conflict (Prisma 7 driver adapters)", () => {
    expect(isSerializationFailure(driverAdapterWrappedSerializationError())).toBe(true);
  });

  it("is false for other error codes and non-error values", () => {
    expect(
      isSerializationFailure(
        new Prisma.PrismaClientKnownRequestError("conflict", {
          code: "P2002",
          clientVersion: "test",
        }),
      ),
    ).toBe(false);
    expect(isSerializationFailure(new Error("boom"))).toBe(false);
    expect(isSerializationFailure("not an error")).toBe(false);
  });
});

describe("runSerializableTransaction", () => {
  function fakeDb(transaction: (...args: unknown[]) => unknown): PrismaClient {
    return { $transaction: transaction } as unknown as PrismaClient;
  }

  it("retries on a serialization failure and returns the eventual success", async () => {
    const $transaction = vi
      .fn()
      .mockRejectedValueOnce(serializationError())
      .mockResolvedValueOnce("ok");

    const result = await runSerializableTransaction(fakeDb($transaction), async () => "unused", {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    expect(result).toBe("ok");
    expect($transaction).toHaveBeenCalledTimes(2);
  });

  it("retries a driver-adapter-wrapped serialization failure and returns the eventual success", async () => {
    const $transaction = vi
      .fn()
      .mockRejectedValueOnce(driverAdapterWrappedSerializationError())
      .mockResolvedValueOnce("ok");

    const result = await runSerializableTransaction(fakeDb($transaction), async () => "unused", {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    expect(result).toBe("ok");
    expect($transaction).toHaveBeenCalledTimes(2);
  });

  it("rethrows once serialization retries are exhausted", async () => {
    const $transaction = vi.fn().mockRejectedValue(serializationError());

    await expect(
      runSerializableTransaction(fakeDb($transaction), async () => "unused", {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    ).rejects.toThrow(/could not serialize access/);
    expect($transaction).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-Serializable transaction, even on a P2034 error", async () => {
    const $transaction = vi.fn().mockRejectedValue(serializationError());

    await expect(
      runSerializableTransaction(fakeDb($transaction), async () => "unused"),
    ).rejects.toThrow(/could not serialize access/);
    expect($transaction).toHaveBeenCalledTimes(1);
  });

  it("rethrows a non-serialization error immediately without retrying", async () => {
    const $transaction = vi.fn().mockRejectedValue(new Error("unrelated failure"));

    await expect(
      runSerializableTransaction(fakeDb($transaction), async () => "unused", {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    ).rejects.toThrow("unrelated failure");
    expect($transaction).toHaveBeenCalledTimes(1);
  });
});
