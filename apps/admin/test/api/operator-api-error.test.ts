import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import {
  apiErrorCode,
  hasApiErrorCode,
  operatorApiErrorMessage,
} from "../../src/api/operator-api-error.js";

describe("operatorApiErrorMessage", () => {
  it("maps known machine codes", () => {
    const err = new ApiError(409, "email_conflict", "email_conflict");
    expect(operatorApiErrorMessage(err, "Failed.")).toBe("That email is already in use.");
  });

  it("uses status fallbacks when detail is unknown", () => {
    expect(operatorApiErrorMessage(new ApiError(403, "secret_internal"), "Failed.")).toBe(
      "You do not have access.",
    );
    expect(operatorApiErrorMessage(new ApiError(401, "secret_internal"), "Failed.")).toBe(
      "Your session has expired. Sign in again.",
    );
  });

  it("allows short operator-safe detail text", () => {
    const err = new ApiError(400, "Enter a valid email address.");
    expect(operatorApiErrorMessage(err, "Failed.")).toBe("Enter a valid email address.");
  });

  it("suppresses internal-looking detail", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = new ApiError(500, "PrismaClientKnownRequestError at apps/web/src/foo.ts:12");
    expect(operatorApiErrorMessage(err, "Failed.")).toBe("Failed.");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns fallback for non-ApiError", () => {
    expect(operatorApiErrorMessage(new Error("boom"), "Failed.")).toBe("Failed.");
  });
});

describe("hasApiErrorCode", () => {
  it("matches code field and message", () => {
    expect(hasApiErrorCode(new ApiError(400, "validation_failed"), "validation_failed")).toBe(true);
    expect(hasApiErrorCode(new ApiError(400, "validation_failed", "validation_failed"), "validation_failed")).toBe(
      true,
    );
    expect(hasApiErrorCode(new ApiError(400, "other"), "validation_failed")).toBe(false);
  });
});

describe("apiErrorCode", () => {
  it("reads code from ApiError", () => {
    expect(apiErrorCode(new ApiError(400, "event_archived", "event_archived"))).toBe("event_archived");
    expect(apiErrorCode(new ApiError(400, "event_archived"))).toBe("event_archived");
  });
});
