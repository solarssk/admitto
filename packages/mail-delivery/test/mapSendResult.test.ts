import { describe, expect, it } from "vitest";
import { mapSendResultToDelivery } from "../src/mapSendResult.js";

describe("mapSendResultToDelivery", () => {
  it("maps accepted", () => {
    const u = mapSendResultToDelivery({
      status: "accepted",
      provider: "export_only",
      providerMessageId: "mid-1",
    });
    expect(u.status).toBe("accepted");
    expect(u.accepted_at).toBeInstanceOf(Date);
  });

  it("maps sent", () => {
    const u = mapSendResultToDelivery({ status: "sent", provider: "smtp" });
    expect(u.status).toBe("sent");
    expect(u.sent_at).toBeInstanceOf(Date);
  });

  it("maps failed retryable", () => {
    const u = mapSendResultToDelivery({
      status: "failed",
      provider: "smtp",
      error: "timeout",
      retryable: true,
    });
    expect(u.status).toBe("failed");
    expect(u.retryable).toBe(true);
  });

  it("maps rejected", () => {
    const u = mapSendResultToDelivery({
      status: "rejected",
      provider: "smtp",
      error: "bad@example.com invalid",
      retryable: false,
    });
    expect(u.status).toBe("rejected");
    expect(u.retryable).toBe(false);
    expect(u.error).not.toContain("@");
  });
});
