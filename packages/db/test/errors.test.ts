import { describe, expect, it } from "vitest";
import { isSerializationFailure, isUnstorableValueError } from "../src/errors.js";

describe("isSerializationFailure", () => {
  it("is true for a direct P2034 code", () => {
    expect(isSerializationFailure({ code: "P2034" })).toBe(true);
  });

  it("is true for a driver-adapter-wrapped conflict", () => {
    expect(
      isSerializationFailure({
        code: "P2028",
        meta: { driverAdapterError: { cause: { originalCode: "40001" } } },
      }),
    ).toBe(true);
    expect(
      isSerializationFailure({
        code: "P2028",
        meta: { driverAdapterError: { cause: { kind: "TransactionWriteConflict" } } },
      }),
    ).toBe(true);
  });

  it("is true for a bare DriverAdapterError TransactionWriteConflict", () => {
    expect(
      isSerializationFailure({
        name: "DriverAdapterError",
        cause: { kind: "TransactionWriteConflict" },
      }),
    ).toBe(true);
    expect(
      isSerializationFailure({
        name: "DriverAdapterError",
        cause: { originalCode: "40001" },
      }),
    ).toBe(true);
    expect(isSerializationFailure({ kind: "TransactionWriteConflict" })).toBe(true);
  });

  it("is false for other error codes and non-error values", () => {
    expect(isSerializationFailure({ code: "P2002" })).toBe(false);
    expect(isSerializationFailure(null)).toBe(false);
    expect(isSerializationFailure(undefined)).toBe(false);
    expect(isSerializationFailure("P2034")).toBe(false);
    expect(isSerializationFailure(new Error("boom"))).toBe(false);
    expect(
      isSerializationFailure({
        code: "P2028",
        meta: { driverAdapterError: { cause: { originalCode: "23505" } } },
      }),
    ).toBe(false);
  });
});

describe("isUnstorableValueError", () => {
  /** The shape Prisma 7's pg adapter gives an error the database raised, whatever its Prisma code. */
  const databaseError = (code: string, originalCode: string) => ({
    code,
    meta: { driverAdapterError: { cause: { originalCode } } },
  });

  it("is true when Postgres refuses a value as malformed (SQLSTATE class 22)", () => {
    // U+0000 in a text value, U+0000 escaped inside JSON, a lone surrogate inside JSON, and the
    // same U+0000 in a raw query.
    expect(isUnstorableValueError(databaseError("P2039", "22021"))).toBe(true);
    expect(isUnstorableValueError(databaseError("P2039", "22P05"))).toBe(true);
    expect(isUnstorableValueError(databaseError("P2007", "22P02"))).toBe(true);
    expect(isUnstorableValueError(databaseError("P2010", "22021"))).toBe(true);
    expect(isUnstorableValueError(databaseError("P2000", "22001"))).toBe(true);
  });

  it("is false for other database errors and non-error values", () => {
    expect(isUnstorableValueError(databaseError("P2002", "23505"))).toBe(false);
    expect(isUnstorableValueError(databaseError("P2003", "23503"))).toBe(false);
    expect(isUnstorableValueError(databaseError("P2034", "40001"))).toBe(false);
    expect(isUnstorableValueError({ code: "P2025" })).toBe(false);
    expect(isUnstorableValueError({ meta: { driverAdapterError: { cause: {} } } })).toBe(false);
    expect(isUnstorableValueError({ meta: { driverAdapterError: { cause: { originalCode: 22021 } } } })).toBe(false);
    expect(isUnstorableValueError(null)).toBe(false);
    expect(isUnstorableValueError(undefined)).toBe(false);
    expect(isUnstorableValueError("22021")).toBe(false);
    expect(isUnstorableValueError(new Error("22021"))).toBe(false);
  });
});
