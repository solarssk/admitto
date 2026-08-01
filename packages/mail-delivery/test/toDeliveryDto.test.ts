import { describe, expect, it } from "vitest";
import { toDeliveryDetailDto, toDeliveryDto } from "../src/toDeliveryDto.js";
import type { DeliveryDetailEntry, DeliveryLogEntry } from "../src/listDeliveries.js";

function entry(overrides: Partial<DeliveryLogEntry> = {}): DeliveryLogEntry {
  return {
    id: "dlv-1",
    attendee_id: "att-1",
    attendee_name: "Jane Guest",
    status: "accepted",
    provider: "smtp",
    provider_message_id: null,
    attempts: 1,
    retryable: null,
    purpose: "resend",
    recipient_email: "guest@example.com",
    rendered_subject: "Your ticket",
    template_id: null,
    template_name: null,
    error_code: null,
    error: null,
    queued_at: new Date("2026-09-01T12:00:00Z"),
    attempted_at: new Date("2026-09-01T12:00:01Z"),
    accepted_at: new Date("2026-09-01T12:00:02Z"),
    sent_at: null,
    failed_at: null,
    delivered_at: null,
    created_at: new Date("2026-09-01T12:00:00Z"),
    client_timezone: null,
    ...overrides,
  };
}

describe("toDeliveryDto", () => {
  it("maps an accepted SMTP send with accepted_at and null sent_at", () => {
    expect(toDeliveryDto(entry())).toEqual({
      id: "dlv-1",
      attendee_id: "att-1",
      attendee_name: "Jane Guest",
      purpose: "resend",
      status: "accepted",
      provider: "smtp",
      provider_message_id: null,
      attempts: 1,
      retryable: null,
      recipient_email: "guest@example.com",
      rendered_subject: "Your ticket",
      template_id: null,
      template_name: null,
      queued_at: "2026-09-01T12:00:00.000Z",
      accepted_at: "2026-09-01T12:00:02.000Z",
      sent_at: null,
      failed_at: null,
      error_code: null,
      error: null,
      client_timezone: null,
    });
  });

  it("maps a custom template name and non-default provider/attempts", () => {
    const dto = toDeliveryDto(
      entry({
        provider: "graph",
        attempts: 3,
        retryable: true,
        template_id: "tmpl-1",
        template_name: "VIP invite",
      }),
    );
    expect(dto.provider).toBe("graph");
    expect(dto.attempts).toBe(3);
    expect(dto.retryable).toBe(true);
    expect(dto.template_id).toBe("tmpl-1");
    expect(dto.template_name).toBe("VIP invite");
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

describe("toDeliveryDetailDto", () => {
  function detailEntry(overrides: Partial<DeliveryDetailEntry> = {}): DeliveryDetailEntry {
    return {
      ...entry(),
      batch_id: "batch-1",
      actor_user_id: "user-1",
      session_id: "sess-1",
      ...overrides,
    };
  }

  it("spreads the base DTO fields and adds detail-only fields plus the resolved actor display", () => {
    const timeline = [entry({ id: "dlv-0", purpose: "initial" }), entry({ id: "dlv-1" })];

    const dto = toDeliveryDetailDto(detailEntry(), "Admin User", timeline);

    expect(dto).toMatchObject({
      id: "dlv-1",
      attendee_name: "Jane Guest",
      batch_id: "batch-1",
      actor_user_id: "user-1",
      actor_display: "Admin User",
      session_id: "sess-1",
    });
    expect(dto.timeline).toEqual([
      expect.objectContaining({ id: "dlv-0", purpose: "initial" }),
      expect.objectContaining({ id: "dlv-1" }),
    ]);
  });

  it("maps a null actor display (deleted or system-sent) and null batch/session ids", () => {
    const dto = toDeliveryDetailDto(
      detailEntry({ batch_id: null, actor_user_id: null, session_id: null }),
      null,
      [],
    );

    expect(dto.actor_display).toBeNull();
    expect(dto.batch_id).toBeNull();
    expect(dto.actor_user_id).toBeNull();
    expect(dto.session_id).toBeNull();
    expect(dto.timeline).toEqual([]);
  });
});
