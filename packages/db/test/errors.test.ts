import { describe, expect, it } from "vitest";
import { isSerializationFailure } from "../src/errors.js";

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
