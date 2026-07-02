import { describe, expect, it } from "vitest";
import { clientSafeDeliveryError, sanitizeDeliveryError, transportTestErrorForAdmin } from "../src/sanitizeError.js";

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

  it("redacts internal URLs", () => {
    expect(clientSafeDeliveryError("http://internal-relay/api failed")).toBe("[redacted] failed");
    expect(clientSafeDeliveryError("https://smtp.corp.local/send failed")).toBe("[redacted] failed");
    expect(clientSafeDeliveryError("HTTPS://smtp.corp.local/send failed")).toBe("[redacted] failed");
  });

  it("redacts host:port patterns", () => {
    expect(clientSafeDeliveryError("Connection refused smtp.corp.local:25")).toBe("send failed");
    expect(clientSafeDeliveryError("TLS handshake failed: 10.0.1.15:587")).toBe("send failed");
  });

  it("redacts internal mailer implementation errors", () => {
    expect(
      clientSafeDeliveryError("export_only provider requires exportSink in createMailer deps"),
    ).toBe("send failed");
  });

  it("allows plain send error without internals", () => {
    expect(clientSafeDeliveryError("Mailbox does not exist")).toBe("Mailbox does not exist");
  });
});

describe("transportTestErrorForAdmin", () => {
  it("maps connection refused without leaking host", () => {
    expect(transportTestErrorForAdmin("connect ECONNREFUSED smtp.example.com:587")).toBe(
      "Could not connect to the mail server (connection refused). Check host and port.",
    );
  });

  it("maps DNS failure", () => {
    expect(transportTestErrorForAdmin("getaddrinfo ENOTFOUND smtp.example.com")).toBe(
      "Mail server hostname could not be resolved. Check the SMTP host.",
    );
  });

  it("maps SMTP auth failure", () => {
    expect(transportTestErrorForAdmin("Invalid login: 535 Authentication failed")).toBe(
      "SMTP authentication failed. Check username and password.",
    );
  });

  it("maps Graph OAuth without leaking client id", () => {
    expect(
      transportTestErrorForAdmin("invalid_client: AADSTS70011 client_id=abc graph.microsoft.com"),
    ).toBe("Microsoft Graph authentication failed. Check tenant, client ID, and secret.");
  });

  it("falls back to actionable generic message", () => {
    expect(transportTestErrorForAdmin("smtp: weird internal failure at smtp.corp:25")).toBe(
      "Send failed. Verify transport settings; see server logs for the technical detail.",
    );
  });

  it("handles empty input", () => {
    expect(transportTestErrorForAdmin(undefined)).toBe(
      "Send failed. Check transport settings and try again.",
    );
  });
});

describe("sanitizeDeliveryError", () => {
  it("returns undefined for empty input", () => {
    expect(sanitizeDeliveryError(undefined)).toBeUndefined();
  });

  it("redacts URLs before persisting", () => {
    const out = sanitizeDeliveryError(
      "Webhook failed: https://prod-12.westus.logic.azure.com/workflows/abc123/triggers/manual/paths/invoke?api-version=2016",
    );
    expect(out).not.toContain("https://");
    expect(out).toContain("[redacted]");
  });
});
