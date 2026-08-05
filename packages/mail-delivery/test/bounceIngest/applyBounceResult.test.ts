import { describe, expect, it, vi } from "vitest";
import type { EmailDelivery } from "@admitto/db";
import { applyBounceResult } from "../../src/bounceIngest/applyBounceResult.js";
import { NON_TERMINAL } from "../../src/bounceIngest/correlate.js";
import type { ParsedBounceLine } from "../../src/bounceIngest/types.js";

function delivery(partial: Partial<EmailDelivery> = {}): EmailDelivery {
  return {
    id: "del_1",
    organization_id: "org_1",
    event_id: "evt_1",
    attendee_id: "att_1",
    purpose: "initial",
    batch_id: null,
    template_id: null,
    template_label_snapshot: null,
    provider: "smtp",
    provider_message_id: null,
    status: "sent",
    error_code: null,
    error: null,
    retryable: null,
    attempts: 1,
    recipient_email: "user@example.com",
    rendered_subject: null,
    rendered_html: null,
    queued_at: new Date(),
    attempted_at: null,
    accepted_at: null,
    sent_at: new Date(),
    delivered_at: null,
    failed_at: null,
    ...partial,
  } as EmailDelivery;
}

describe("applyBounceResult", () => {
  it("maps 5xx to bounced with error fields", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { emailDelivery: { updateMany } } as never;
    const line: ParsedBounceLine = {
      recipientEmail: "user@example.com",
      smtpCode: "550",
      enhancedCode: "5.1.1",
      reason: "User unknown",
    };

    const outcome = await applyBounceResult(db, delivery(), line, () => undefined);
    expect(outcome).toBe("hard_bounced");
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "del_1",
          status: { in: [...NON_TERMINAL] },
        },
        data: expect.objectContaining({
          status: "bounced",
          retryable: false,
          error_code: "550/5.1.1",
        }),
      }),
    );
    expect(updateMany.mock.calls[0]![0].data.error).toMatch(/User unknown/);
    expect(updateMany.mock.calls[0]![0].data.failed_at).toBeInstanceOf(Date);
  });

  it("logs soft 4xx without updating status", async () => {
    const updateMany = vi.fn();
    const log = vi.fn();
    const db = { emailDelivery: { updateMany } } as never;
    const line: ParsedBounceLine = {
      recipientEmail: "user@example.com",
      smtpCode: "452",
      reason: "Mailbox full",
    };

    const outcome = await applyBounceResult(db, delivery(), line, log);
    expect(outcome).toBe("soft_logged");
    expect(updateMany).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });

  it("skips non-bounce SMTP codes such as 250", async () => {
    const updateMany = vi.fn();
    const log = vi.fn();
    const db = { emailDelivery: { updateMany } } as never;
    const line: ParsedBounceLine = {
      recipientEmail: "user@example.com",
      smtpCode: "250",
      reason: "OK",
    };

    const outcome = await applyBounceResult(db, delivery(), line, log);
    expect(outcome).toBe("skipped");
    expect(updateMany).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });

  it("skips when updateMany matches no non-terminal row", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const log = vi.fn();
    const db = { emailDelivery: { updateMany } } as never;
    const line: ParsedBounceLine = {
      recipientEmail: "user@example.com",
      smtpCode: "550",
      reason: "User unknown",
    };

    const outcome = await applyBounceResult(db, delivery({ status: "bounced" }), line, log);
    expect(outcome).toBe("skipped");
    expect(updateMany).toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });
});
