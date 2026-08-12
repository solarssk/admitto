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

  it("explains the bulk-send rate limit", () => {
    expect(
      operatorApiErrorMessage(new ApiError(429, "bulk_send_rate_limited", "bulk_send_rate_limited"), "Send failed."),
    ).toBe("Bulk sends are limited to 3 requests every 10 minutes. Try again later.");
  });

  it("prefers err.code over message when they differ", () => {
    expect(
      operatorApiErrorMessage(new ApiError(409, "ignored detail", "email_conflict"), "Failed."),
    ).toBe("That email is already in use.");
  });

  it("maps wrong_password on 401 without session-expired copy", () => {
    const err = new ApiError(401, "wrong_password", "wrong_password");
    expect(operatorApiErrorMessage(err, "Failed to change password.")).toBe(
      "Current password is incorrect.",
    );
  });

  it("uses status fallbacks when detail is unknown", () => {
    expect(operatorApiErrorMessage(new ApiError(403, "secret_internal"), "Failed.")).toBe("Failed.");
    expect(operatorApiErrorMessage(new ApiError(403, "forbidden", "forbidden"), "Failed.")).toBe(
      "You do not have access.",
    );
    expect(operatorApiErrorMessage(new ApiError(401, "secret_internal"), "Failed.")).toBe("Failed.");
    expect(operatorApiErrorMessage(new ApiError(401, "unauthorized"), "Failed.")).toBe(
      "Your session has expired. Sign in again.",
    );
    expect(operatorApiErrorMessage(new ApiError(401, "authentication_required"), "Failed to load sessions.")).toBe(
      "Your session has expired. Sign in again.",
    );
  });

  it("uses 401 session fallback when human detail is suppressed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(operatorApiErrorMessage(new ApiError(401, "syntax error at or near"), "Failed.")).toBe(
      "Your session has expired. Sign in again.",
    );
    warn.mockRestore();
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

  it("maps legacy spaced import error literals", () => {
    expect(operatorApiErrorMessage(new ApiError(400, "file too large"), "Failed.")).toMatch(/5 MB/);
    expect(operatorApiErrorMessage(new ApiError(400, "unsupported file type"), "Failed.")).toMatch(/csv/);
    expect(operatorApiErrorMessage(new ApiError(400, "invalid file content"), "Failed.")).toMatch(/could not be read/);
  });

  it("suppresses SQL-like, stack, ORM, Windows path, and traceback detail", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(operatorApiErrorMessage(new ApiError(500, "syntax error at or near SELECT"), "Failed.")).toBe(
      "Failed.",
    );
    expect(operatorApiErrorMessage(new ApiError(500, "at /dist/index.js:12:5"), "Failed.")).toBe("Failed.");
    expect(operatorApiErrorMessage(new ApiError(500, "mysql connection lost"), "Failed.")).toBe("Failed.");
    expect(operatorApiErrorMessage(new ApiError(500, "C:\\Users\\secret\\file"), "Failed.")).toBe("Failed.");
    expect(operatorApiErrorMessage(new ApiError(500, "Exception in thread main"), "Failed.")).toBe("Failed.");
    expect(operatorApiErrorMessage(new ApiError(500, "a".repeat(201)), "Failed.")).toBe("Failed.");
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

  it("shows safe human detail for 403 when message is operator-facing", () => {
    expect(
      operatorApiErrorMessage(new ApiError(403, "human detail", "HumanReadable"), "Access denied."),
    ).toBe("human detail");
  });

  it("returns fallback for 403 with non-machine code field and machine message", () => {
    expect(
      operatorApiErrorMessage(new ApiError(403, "unknown_perm", "HumanReadable"), "Access denied."),
    ).toBe("Access denied.");
  });

  it("maps additional known API codes", () => {
    expect(operatorApiErrorMessage(new ApiError(400, "forbidden", "forbidden"), "Failed.")).toBe(
      "You do not have access.",
    );
    expect(operatorApiErrorMessage(new ApiError(400, "cannot_revoke_current"), "Failed.")).toMatch(
      /current session/,
    );
    expect(operatorApiErrorMessage(new ApiError(400, "delivery_not_found"), "Failed.")).toBe(
      "Delivery not found.",
    );
    expect(
      operatorApiErrorMessage(new ApiError(422, "instance_url_required", "instance_url_required"), "Send failed."),
    ).toMatch(/Instance URL/);
    expect(
      operatorApiErrorMessage(
        new ApiError(422, "mail_destination_blocked", "mail_destination_blocked"),
        "Resend failed.",
      ),
    ).toMatch(/private address/);
    expect(
      operatorApiErrorMessage(
        new ApiError(422, "mail_destination_unresolved", "mail_destination_unresolved"),
        "Resend failed.",
      ),
    ).toMatch(/resolve the mail destination hostname/);
    expect(
      operatorApiErrorMessage(
        new ApiError(422, "mail_secret_decryption_failed", "mail_secret_decryption_failed"),
        "Could not test the SMTP connection.",
      ),
    ).toMatch(/could not be decrypted/);
    expect(
      operatorApiErrorMessage(new ApiError(500, "internal_error", "internal_error"), "Resend failed."),
    ).toMatch(/System logs/);
    expect(
      operatorApiErrorMessage(
        new ApiError(403, "manual_lookup_disabled", "manual_lookup_disabled"),
        "Request failed.",
      ),
    ).toBe("Manual lookup is disabled for this event. Use QR scan only.");
    expect(
      operatorApiErrorMessage(new ApiError(409, "asset_in_use", "asset_in_use"), "Failed."),
    ).toBe("This image is still used in this event's email template. Remove it from the template first.");
  });

  it("maps identity provider and Cloudflare Access validation codes", () => {
    expect(
      operatorApiErrorMessage(new ApiError(400, "invalid_issuer", "invalid_issuer"), "Connection test failed."),
    ).toMatch(/HTTPS/);
    expect(
      operatorApiErrorMessage(new ApiError(400, "invalid_issuer", "invalid_issuer"), "Connection test failed."),
    ).toMatch(/SSO_PRIVATE_DESTINATION_ALLOWLIST/);
    expect(
      operatorApiErrorMessage(new ApiError(400, "discovery_failed", "discovery_failed"), "Discovery failed."),
    ).toMatch(/OIDC discovery/);
    expect(
      operatorApiErrorMessage(
        new ApiError(400, "invalid_team_domain", "invalid_team_domain"),
        "Connection test failed.",
      ),
    ).toMatch(/team URL/i);
    expect(
      operatorApiErrorMessage(
        new ApiError(400, "team_domain_required", "team_domain_required"),
        "Connection test failed.",
      ),
    ).toMatch(/team URL/i);
    expect(
      operatorApiErrorMessage(
        new ApiError(403, "password_change_required", "password_change_required"),
        "Request failed.",
      ),
    ).toMatch(/change your password/i);
    expect(
      operatorApiErrorMessage(
        new ApiError(403, "password_change_required", "password_change_required"),
        "Request failed.",
      ),
    ).not.toBe("You do not have access.");
  });

  it("suppresses stack frames with at File ( pattern", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(operatorApiErrorMessage(new ApiError(500, "at main (index.js:1:1)"), "Failed.")).toBe("Failed.");
    warn.mockRestore();
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
    expect(
      hasApiErrorCode(
        new ApiError(400, "template_validation_failed", "template_validation_failed"),
        "validation_failed",
      ),
    ).toBe(false);
  });

  it("rejects empty needle and non-ApiError", () => {
    expect(hasApiErrorCode(null, "validation_failed")).toBe(false);
    expect(hasApiErrorCode(new ApiError(400, "validation_failed"), "")).toBe(false);
    expect(hasApiErrorCode(new ApiError(400, "validation_failed"), "   ")).toBe(false);
  });
});

describe("apiErrorCode", () => {
  it("reads code from ApiError", () => {
    expect(apiErrorCode(new ApiError(400, "event_archived", "event_archived"))).toBe("event_archived");
    expect(apiErrorCode(new ApiError(400, "event_archived"))).toBe("event_archived");
  });

  it("returns undefined for non-ApiError", () => {
    expect(apiErrorCode(new Error("boom"))).toBeUndefined();
  });
});
