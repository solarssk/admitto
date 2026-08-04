import { describe, expect, it, vi } from "vitest";
import type { BounceIngestSettings } from "@admitto/db";
import { ingestBounces } from "../../src/bounceIngest/index.js";
import type { InboundMailProvider, InboundMessage } from "../../src/bounceIngest/types.js";

function settings(partial: Partial<BounceIngestSettings> = {}): BounceIngestSettings {
  return {
    id: "bis_1",
    event_id: "evt_1",
    imap_host: "imap.example.com",
    imap_port: 993,
    imap_username: "bounce@example.com",
    imap_password_enc: "enc",
    reuse_smtp_credentials: false,
    folders: ["INBOX"],
    poll_interval_minutes: 5,
    enabled: true,
    created_at: new Date(),
    updated_at: new Date(),
    ...partial,
  };
}

function mockProvider(messages: InboundMessage[]): InboundMailProvider {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    fetchCandidateMessages: vi.fn().mockResolvedValue(messages),
    markSeen: vi.fn().mockResolvedValue(undefined),
  };
}

const HARD_BODY =
  "user@example.com failed: host mx.example.com (203.0.113.1) said: 550 5.1.1 user@example.com: User unknown (in reply to RCPT TO command)";

describe("ingestBounces", () => {
  it("returns not_configured when no settings row exists for eventId", async () => {
    const db = {
      bounceIngestSettings: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
      },
    } as never;

    const summary = await ingestBounces(db, { eventId: "evt_missing" });
    expect(summary.noopReason).toBe("not_configured");
    expect(summary.connectFailed).toBe(false);
  });

  it("returns disabled when settings exist but enabled is false", async () => {
    const row = settings({ enabled: false });
    const db = {
      bounceIngestSettings: {
        findMany: vi.fn().mockResolvedValue([row]),
        findUnique: vi.fn().mockResolvedValue(row),
      },
    } as never;

    const summary = await ingestBounces(db, { eventId: "evt_1" });
    expect(summary.noopReason).toBe("disabled");
  });

  it("applies hard bounce and marks UID processed", async () => {
    const row = settings();
    const messages: InboundMessage[] = [
      {
        uid: "101",
        receivedAt: new Date(),
        subject: "Delivery Status Notification",
        bodyText: HARD_BODY,
      },
      {
        uid: "102",
        receivedAt: new Date(),
        subject: "Hello",
        bodyText: "not a bounce",
      },
    ];

    const upsert = vi.fn().mockResolvedValue({});
    const findUniqueUid = vi.fn().mockResolvedValue(null);
    const findFirstDelivery = vi.fn().mockResolvedValue({
      id: "del_1",
      status: "sent",
      recipient_email: "user@example.com",
      event_id: "evt_1",
    });
    const updateDelivery = vi.fn().mockResolvedValue({});

    const db = {
      bounceIngestSettings: {
        findMany: vi.fn().mockResolvedValue([row]),
      },
      bounceIngestProcessedUid: {
        findUnique: findUniqueUid,
        upsert,
      },
      emailDelivery: {
        findFirst: findFirstDelivery,
        update: updateDelivery,
      },
    } as never;

    const provider = mockProvider(messages);
    const summary = await ingestBounces(db, {
      eventId: "evt_1",
      createProvider: async () => provider,
      log: () => undefined,
    });

    expect(summary.messagesSeen).toBe(2);
    expect(summary.bouncesApplied).toBe(1);
    expect(summary.unparsed).toBe(1);
    expect(summary.connectFailed).toBe(false);
    expect(updateDelivery).toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it("sets connectFailed when provider.connect throws", async () => {
    const row = settings();
    const db = {
      bounceIngestSettings: {
        findMany: vi.fn().mockResolvedValue([row]),
      },
    } as never;

    const summary = await ingestBounces(db, {
      eventId: "evt_1",
      createProvider: async () => ({
        connect: vi.fn().mockRejectedValue(new Error("auth failed")),
        close: vi.fn(),
        fetchCandidateMessages: vi.fn(),
      }),
      log: () => undefined,
    });

    expect(summary.connectFailed).toBe(true);
    expect(summary.errors).toBe(1);
  });

  it("continues after a per-message failure", async () => {
    const row = settings();
    const messages: InboundMessage[] = [
      {
        uid: "1",
        receivedAt: new Date(),
        subject: "a",
        bodyText: HARD_BODY,
      },
      {
        uid: "2",
        receivedAt: new Date(),
        subject: "b",
        bodyText: HARD_BODY.replaceAll("user@example.com", "other@example.com"),
      },
    ];

    let uidCalls = 0;
    const db = {
      bounceIngestSettings: {
        findMany: vi.fn().mockResolvedValue([row]),
      },
      bounceIngestProcessedUid: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockImplementation(async () => {
          uidCalls += 1;
          if (uidCalls === 1) throw new Error("db blip");
          return {};
        }),
      },
      emailDelivery: {
        findFirst: vi.fn().mockResolvedValue({
          id: "del_x",
          status: "sent",
          recipient_email: "user@example.com",
          event_id: "evt_1",
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    } as never;

    const summary = await ingestBounces(db, {
      eventId: "evt_1",
      createProvider: async () => mockProvider(messages),
      log: () => undefined,
    });

    expect(summary.errors).toBeGreaterThanOrEqual(1);
    expect(summary.messagesSeen).toBe(2);
  });
});
