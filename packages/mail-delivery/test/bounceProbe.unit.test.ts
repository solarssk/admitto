import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BounceIngestSettings } from "@admitto/db";
import { closeMailer, createMailer } from "@admitto/mailer";
import { resolveMailConfig } from "@admitto/mailer-config";
import {
  BounceProbeSetupError,
  bounceProbeAttendeeEmail,
  cleanupLegacyBounceProbeAttendee,
  runEventBounceProbe,
} from "../src/bounceProbe.js";
import type { InboundMailProvider, InboundMessage } from "../src/bounceIngest/types.js";

vi.mock("@admitto/mailer-config", () => ({
  resolveMailConfig: vi.fn(),
}));

vi.mock("@admitto/mailer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/mailer")>();
  return {
    ...actual,
    createMailer: vi.fn(),
    closeMailer: vi.fn(),
  };
});

vi.mock("../src/transportTest.js", () => ({
  buildEventTransportTestMessage: vi.fn().mockResolvedValue({
    subject: "Admitto mail transport test",
    html: "<p>test</p>",
  }),
}));

const HARD_BODY =
  "nobody@example.com failed: host mx.example.com (203.0.113.1) said: 550 5.1.1 nobody@example.com: User unknown (in reply to RCPT TO command)";

const SOFT_BODY =
  "nobody@example.com failed: host mx.example.com (203.0.113.1) said: 450 4.2.1 Greylisted (in reply to RCPT TO command)";

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

function baseDb(overrides: {
  bounceIngestSettings?: { findUnique?: ReturnType<typeof vi.fn> };
  bounceIngestProcessedUid?: {
    findUnique?: ReturnType<typeof vi.fn>;
    upsert?: ReturnType<typeof vi.fn>;
  };
  attendee?: {
    findUnique?: ReturnType<typeof vi.fn>;
    deleteMany?: ReturnType<typeof vi.fn>;
  };
  emailDelivery?: {
    deleteMany?: ReturnType<typeof vi.fn>;
    count?: ReturnType<typeof vi.fn>;
  };
} = {}) {
  return {
    bounceIngestSettings: {
      findUnique:
        overrides.bounceIngestSettings?.findUnique ??
        vi.fn().mockResolvedValue(settings()),
    },
    bounceIngestProcessedUid: {
      findUnique: overrides.bounceIngestProcessedUid?.findUnique ?? vi.fn().mockResolvedValue(null),
      upsert: overrides.bounceIngestProcessedUid?.upsert ?? vi.fn().mockResolvedValue({}),
    },
    attendee: {
      findUnique: overrides.attendee?.findUnique ?? vi.fn().mockResolvedValue(null),
      deleteMany: overrides.attendee?.deleteMany ?? vi.fn().mockResolvedValue({ count: 0 }),
    },
    emailDelivery: {
      deleteMany: overrides.emailDelivery?.deleteMany ?? vi.fn().mockResolvedValue({ count: 0 }),
      count: overrides.emailDelivery?.count ?? vi.fn().mockResolvedValue(0),
    },
  };
}

describe("runEventBounceProbe (unit)", () => {
  beforeEach(() => {
    vi.mocked(resolveMailConfig).mockResolvedValue({
      provider: "export_only",
      fromAddress: "org@example.com",
    } as never);
    vi.mocked(createMailer).mockResolvedValue({
      send: vi.fn().mockResolvedValue({
        status: "sent",
        provider: "export_only",
        providerMessageId: "<mid@example.com>",
      }),
    } as never);
    vi.mocked(closeMailer).mockResolvedValue(undefined);
  });

  it("throws BounceProbeSetupError when bounce settings are missing", async () => {
    const db = baseDb({
      bounceIngestSettings: { findUnique: vi.fn().mockResolvedValue(null) },
    });

    await expect(
      runEventBounceProbe({ eventId: "evt_1", toAddress: "nobody@example.com" }, db as never),
    ).rejects.toBeInstanceOf(BounceProbeSetupError);
  });

  it("throws when bounce detection is configured but Off", async () => {
    const db = baseDb({
      bounceIngestSettings: {
        findUnique: vi.fn().mockResolvedValue(settings({ enabled: false })),
      },
    });

    await expect(
      runEventBounceProbe({ eventId: "evt_1", toAddress: "nobody@example.com" }, db as never),
    ).rejects.toThrow(/Turn bounce detection On/i);
  });

  it("returns failed when the transport send fails", async () => {
    vi.mocked(createMailer).mockResolvedValueOnce({
      send: vi.fn().mockResolvedValue({
        status: "failed",
        provider: "smtp",
        error: "SMTP rejected recipient",
      }),
    } as never);

    const result = await runEventBounceProbe(
      {
        eventId: "evt_1",
        toAddress: "nobody@example.com",
        ingestOptions: { createProvider: async () => mockProvider([]) },
      },
      baseDb() as never,
    );

    expect(result.status).toBe("failed");
    expect(result.message).toMatch(/SMTP rejected recipient|Send failed/i);
  });

  it("reports ok when IMAP yields a hard bounce for the recipient", async () => {
    let tick = 0;
    const messages: InboundMessage[] = [
      {
        uid: "1",
        receivedAt: new Date(),
        subject: "Undeliverable",
        bodyText: HARD_BODY,
      },
    ];

    const result = await runEventBounceProbe(
      {
        eventId: "evt_1",
        toAddress: "nobody@example.com",
        timeoutMs: 100,
        pollMs: 1,
        now: () => {
          tick += 1;
          return tick * 10;
        },
        sleep: async () => undefined,
        ingestOptions: { createProvider: async () => mockProvider(messages) },
      },
      baseDb() as never,
    );

    expect(result.status).toBe("ok");
    expect(result.smtpCode).toMatch(/^550/);
    expect(result.message).toMatch(/Bounce received/i);
  });

  it("reports timeout when no hard bounce arrives", async () => {
    let t = 0;
    const result = await runEventBounceProbe(
      {
        eventId: "evt_1",
        toAddress: "nobody@example.com",
        timeoutMs: 30,
        pollMs: 5,
        now: () => {
          const v = t;
          t += 20;
          return v;
        },
        sleep: async () => undefined,
        ingestOptions: { createProvider: async () => mockProvider([]) },
      },
      baseDb() as never,
    );

    expect(result.status).toBe("timeout");
    expect(result.message).toMatch(/90 seconds|IMAP/i);
  });

  it("ignores soft bounces and keeps polling until timeout", async () => {
    let t = 0;
    const messages: InboundMessage[] = [
      {
        uid: "soft",
        receivedAt: new Date(),
        subject: "Delayed",
        bodyText: SOFT_BODY,
      },
    ];

    const result = await runEventBounceProbe(
      {
        eventId: "evt_1",
        toAddress: "nobody@example.com",
        timeoutMs: 25,
        pollMs: 5,
        now: () => {
          const v = t;
          t += 20;
          return v;
        },
        sleep: async () => undefined,
        ingestOptions: { createProvider: async () => mockProvider(messages) },
      },
      baseDb() as never,
    );

    expect(result.status).toBe("timeout");
  });

  it("skips already-processed UIDs when scanning IMAP", async () => {
    const db = baseDb({
      bounceIngestProcessedUid: {
        findUnique: vi.fn().mockResolvedValue({ id: "seen" }),
        upsert: vi.fn(),
      },
    });
    let tick = 0;

    const result = await runEventBounceProbe(
      {
        eventId: "evt_1",
        toAddress: "nobody@example.com",
        timeoutMs: 20,
        pollMs: 5,
        now: () => {
          tick += 1;
          return tick * 10;
        },
        sleep: async () => undefined,
        ingestOptions: {
          createProvider: async () =>
            mockProvider([
              {
                uid: "seen",
                receivedAt: new Date(),
                subject: "Undeliverable",
                bodyText: HARD_BODY,
              },
            ]),
        },
      },
      db as never,
    );

    expect(result.status).toBe("timeout");
    expect(db.bounceIngestProcessedUid.upsert).not.toHaveBeenCalled();
  });

  it("swallows markSeen failures while still returning ok", async () => {
    const markSeen = vi.fn().mockRejectedValue(new Error("flags failed"));
    const provider: InboundMailProvider = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      fetchCandidateMessages: vi.fn().mockResolvedValue([
        {
          uid: "1",
          receivedAt: new Date(),
          subject: "Undeliverable",
          bodyText: HARD_BODY,
        },
      ]),
      markSeen,
    };
    let tick = 0;

    const result = await runEventBounceProbe(
      {
        eventId: "evt_1",
        toAddress: "nobody@example.com",
        timeoutMs: 50,
        pollMs: 1,
        now: () => {
          tick += 1;
          return tick * 10;
        },
        sleep: async () => undefined,
        ingestOptions: { createProvider: async () => provider },
      },
      baseDb() as never,
    );

    expect(result.status).toBe("ok");
    expect(markSeen).toHaveBeenCalled();
  });
});

describe("cleanupLegacyBounceProbeAttendee (unit)", () => {
  it("removes legacy attendee and delivery rows when present", async () => {
    const deleteDeliveries = vi.fn().mockResolvedValue({ count: 1 });
    const deleteAttendees = vi.fn().mockResolvedValue({ count: 1 });
    const db = baseDb({
      attendee: {
        findUnique: vi.fn().mockResolvedValue({ id: "att_1" }),
        deleteMany: deleteAttendees,
      },
      emailDelivery: { deleteMany: deleteDeliveries },
    });

    await cleanupLegacyBounceProbeAttendee(db as never, "evt_1");

    expect(deleteDeliveries).toHaveBeenCalledWith({
      where: { attendee_id: "att_1", event_id: "evt_1" },
    });
    expect(deleteAttendees).toHaveBeenCalledWith({
      where: { id: "att_1", event_id: "evt_1" },
    });
  });

  it("swallows database errors", async () => {
    const db = baseDb({
      attendee: {
        findUnique: vi.fn().mockRejectedValue(new Error("db down")),
      },
    });

    await expect(
      cleanupLegacyBounceProbeAttendee(db as never, "evt_1"),
    ).resolves.toBeUndefined();
  });
});

describe("bounceProbeAttendeeEmail", () => {
  it("falls back to event when the id is empty after sanitization", () => {
    expect(bounceProbeAttendeeEmail("!!!")).toBe("bounce-probe+event@admitto.invalid");
  });
});
