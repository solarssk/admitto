import { describe, expect, it } from "vitest";
import { clientSafeDeliveryError, sanitizeDeliveryError } from "../src/sanitizeError.js";

describe("clientSafeDeliveryError", () => {
  it("returns generic message for Graph OAuth errors", () => {
    expect(
      clientSafeDeliveryError(
        "invalid_client: AADSTS70011 client_id=abc123 graph.microsoft.com",
      ),
    ).toBe("send failed");
  });

  it("allows short generic transport errors", () => {
    expect(clientSafeDeliveryError("Mailbox unavailable")).toBe("Mailbox unavailable");
  });

  it("redacts emails before returning", () => {
    const out = clientSafeDeliveryError("Delivery failed for user@example.com");
    expect(out).not.toContain("user@example.com");
    expect(out).toContain("[redacted]");
  });

  it("returns generic message for long errors", () => {
    expect(clientSafeDeliveryError("x".repeat(121))).toBe("send failed");
  });

  it("returns generic message for empty input", () => {
    expect(clientSafeDeliveryError("")).toBe("send failed");
    expect(clientSafeDeliveryError(undefined)).toBe("send failed");
  });

  it("returns generic message for bearer token errors", () => {
    expect(clientSafeDeliveryError("Bearer token expired")).toBe("send failed");
    expect(clientSafeDeliveryError("client_secret mismatch")).toBe("send failed");
  });
});

describe("sanitizeDeliveryError", () => {
  it("returns undefined for empty input", () => {
    expect(sanitizeDeliveryError(undefined)).toBeUndefined();
  });
});
