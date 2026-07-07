import { describe, expect, it } from "vitest";
import { toDeliveryDto } from "../src/toDeliveryDto.js";
import type { DeliveryLogEntry } from "../src/listDeliveries.js";

function entry(overrides: Partial<DeliveryLogEntry> = {}): DeliveryLogEntry {
  return {
    id: "dlv-1",
    attendee_id: "att-1",
    status: "accepted",
    provider: "smtp",
    provider_message_id: null,
    attempts: 1,
    purpose: "resend",
    recipient_email: "guest@example.com",
    rendered_subject: "Your ticket",
    error_code: null,
    error: null,
    queued_at: new Date("2026-09-01T12:00:00Z"),
    attempted_at: new Date("2026-09-01T12:00:01Z"),
    accepted_at: new Date("2026-09-01T12:00:02Z"),
    sent_at: null,
    failed_at: null,
    delivered_at: null,
    created_at: new Date("2026-09-01T12:00:00Z"),
    ...overrides,
  };
}

describe("toDeliveryDto", () => {
  it("maps an accepted SMTP send with accepted_at and null sent_at", () => {
    expect(toDeliveryDto(entry())).toEqual({
      id: "dlv-1",
      purpose: "resend",
      status: "accepted",
      recipient_email: "guest@example.com",
      rendered_subject: "Your ticket",
      queued_at: "2026-09-01T12:00:00.000Z",
      accepted_at: "2026-09-01T12:00:02.000Z",
      sent_at: null,
      failed_at: null,
      error_code: null,
    });
  });

  it("maps null timestamps for a queued row", () => {
    const dto = toDeliveryDto(entry({ status: "queued", accepted_at: null, attempted_at: null }));
    expect(dto.status).toBe("queued");
    expect(dto.accepted_at).toBeNull();
    expect(dto.sent_at).toBeNull();
    expect(dto.failed_at).toBeNull();
  });

  it("maps a failed row with failed_at and error_code", () => {
    const dto = toDeliveryDto(
      entry({
        status: "failed",
        accepted_at: null,
        failed_at: new Date("2026-09-01T12:00:03Z"),
        error_code: "smtp_connect",
      }),
    );
    expect(dto.failed_at).toBe("2026-09-01T12:00:03.000Z");
    expect(dto.error_code).toBe("smtp_connect");
  });
});
