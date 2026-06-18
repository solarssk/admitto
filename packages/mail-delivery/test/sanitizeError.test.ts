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
});

describe("sanitizeDeliveryError", () => {
  it("returns undefined for empty input", () => {
    expect(sanitizeDeliveryError(undefined)).toBeUndefined();
  });
});
