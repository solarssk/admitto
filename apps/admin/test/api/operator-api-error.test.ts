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

  it("maps wrong_password on 401 without session-expired copy", () => {
    const err = new ApiError(401, "wrong_password", "wrong_password");
    expect(operatorApiErrorMessage(err, "Failed to change password.")).toBe(
      "Current password is incorrect.",
    );
  });

  it("uses status fallbacks when detail is unknown", () => {
    expect(operatorApiErrorMessage(new ApiError(403, "secret_internal"), "Failed.")).toBe(
      "You do not have access.",
    );
    expect(operatorApiErrorMessage(new ApiError(401, "secret_internal"), "Failed.")).toBe("Failed.");
    expect(operatorApiErrorMessage(new ApiError(401, "unauthorized"), "Failed.")).toBe(
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

  it("prefers specific template codes over shorter substring keys", () => {
    expect(
      operatorApiErrorMessage(new ApiError(404, "template_not_found", "template_not_found"), "Failed."),
    ).toBe("Template not found.");
    expect(
      operatorApiErrorMessage(
        new ApiError(400, "template_validation_failed", "template_validation_failed"),
        "Failed.",
      ),
    ).toBe("Fix template validation errors and try again.");
    expect(
      operatorApiErrorMessage(new ApiError(404, "template_not_found: ticket-123"), "Failed."),
    ).toBe("Template not found.");
  });

  it("suppresses SQL-like and stack detail leaks", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(operatorApiErrorMessage(new ApiError(500, "syntax error at or near SELECT"), "Failed.")).toBe(
      "Failed.",
    );
    expect(operatorApiErrorMessage(new ApiError(500, "at /dist/index.js:12:5"), "Failed.")).toBe("Failed.");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("maps session revoke and template naming codes", () => {
    expect(
      operatorApiErrorMessage(
        new ApiError(403, "cannot_revoke_own_session", "cannot_revoke_own_session"),
        "Failed.",
      ),
    ).toBe("You cannot revoke your current session.");
    expect(
      operatorApiErrorMessage(new ApiError(409, "template_name_conflict", "template_name_conflict"), "Failed."),
    ).toBe("A template with this name already exists.");
    expect(
      operatorApiErrorMessage(new ApiError(415, "unsupported_file_type", "unsupported_file_type"), "Failed."),
    ).toMatch(/Unsupported file type/);
  });

  it("returns fallback for non-ApiError", () => {
    expect(operatorApiErrorMessage(new Error("boom"), "Failed.")).toBe("Failed.");
  });
});

describe("hasApiErrorCode", () => {
  it("matches normalized code only", () => {
    expect(hasApiErrorCode(new ApiError(400, "validation_failed"), "validation_failed")).toBe(true);
    expect(hasApiErrorCode(new ApiError(400, "validation_failed", "validation_failed"), "validation_failed")).toBe(
      true,
    );
    expect(hasApiErrorCode(new ApiError(400, "other"), "validation_failed")).toBe(false);
    expect(hasApiErrorCode(new ApiError(404, "not_found", "not_found"), "not")).toBe(false);
    expect(hasApiErrorCode(new ApiError(400, "template_validation_failed", "template_validation_failed"), "validation_failed")).toBe(
      false,
    );
  });
});

describe("apiErrorCode", () => {
  it("reads code from ApiError", () => {
    expect(apiErrorCode(new ApiError(400, "event_archived", "event_archived"))).toBe("event_archived");
    expect(apiErrorCode(new ApiError(400, "event_archived"))).toBe("event_archived");
  });
});
