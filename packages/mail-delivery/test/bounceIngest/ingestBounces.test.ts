import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BounceIngestSettings } from "@admitto/db";

const { resolveImapConnectConfigMock, ImapInboundProviderMock } = vi.hoisted(() => ({
  resolveImapConnectConfigMock: vi.fn(),
  ImapInboundProviderMock: vi.fn(),
}));

vi.mock("../../src/bounceIngest/resolveAuth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/bounceIngest/resolveAuth.js")>();
  return { ...actual, resolveImapConnectConfig: resolveImapConnectConfigMock };
});

vi.mock("../../src/bounceIngest/imapProvider.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/bounceIngest/imapProvider.js")>();
  return { ...actual, ImapInboundProvider: ImapInboundProviderMock };
});

import { ingestBounces, testBounceImapConnection } from "../../src/bounceIngest/index.js";
import { BounceAuthError } from "../../src/bounceIngest/resolveAuth.js";
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
    last_run_at: null,
    last_run_ok: null,
    last_run_summary: null,
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

/** Minimal Prisma stubs for event-scoped ingest (findUnique) + UID prune. */
function eventScopedDb(
  row: BounceIngestSettings,
  extras: {
    bounceIngestProcessedUid?: Record<string, unknown>;
    emailDelivery?: Record<string, unknown>;
    bounceIngestSettings?: Record<string, unknown>;
  } = {},
) {
  return {
    bounceIngestSettings: {
      findUnique: vi.fn().mockResolvedValue(row),
      update: vi.fn().mockResolvedValue(row),
      ...extras.bounceIngestSettings,
    },
    bounceIngestProcessedUid: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      ...extras.bounceIngestProcessedUid,
    },
    emailDelivery: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      ...extras.emailDelivery,
    },
  };
}

const HARD_BODY =
  "user@example.com failed: host mx.example.com (203.0.113.1) said: 550 5.1.1 user@example.com: User unknown (in reply to RCPT TO command)";

const SOFT_BODY =
  "user@example.com failed: host mx.example.com (203.0.113.1) said: 450 4.2.1 Greylisted (in reply to RCPT TO command)";

describe("ingestBounces", () => {
  it("returns not_configured when no settings row exists for eventId", async () => {
    const db = {
      bounceIngestSettings: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      bounceIngestProcessedUid: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
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
        findUnique: vi.fn().mockResolvedValue(row),
      },
      bounceIngestProcessedUid: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
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
    const findManyDelivery = vi.fn().mockResolvedValue([
      {
        id: "del_1",
        status: "sent",
        recipient_email: "user@example.com",
        event_id: "evt_1",
      },
    ]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });

    const db = eventScopedDb(row, {
      bounceIngestProcessedUid: { findUnique: findUniqueUid, upsert },
      emailDelivery: { findMany: findManyDelivery, updateMany },
    }) as never;

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
    expect(updateMany).toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(db.bounceIngestSettings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { event_id: "evt_1" },
        data: expect.objectContaining({
          last_run_ok: true,
          last_run_summary: expect.objectContaining({
            messagesSeen: 2,
            bouncesApplied: 1,
            unparsed: 1,
            errors: 0,
            connectFailed: false,
          }),
        }),
      }),
    );
  });

  it("persists last_run_ok false when IMAP connect fails", async () => {
    const row = settings();
    const update = vi.fn().mockResolvedValue(row);
    const db = eventScopedDb(row, {
      bounceIngestSettings: { update },
    }) as never;

    const summary = await ingestBounces(db, {
      eventId: "evt_1",
      createProvider: async () => {
        throw new Error("auth failed");
      },
      log: () => undefined,
    });

    expect(summary.connectFailed).toBe(true);
    expect(summary.errors).toBe(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          last_run_ok: false,
          last_run_summary: expect.objectContaining({
            connectFailed: true,
            errors: 1,
          }),
        }),
      }),
    );
  });

  it("logs when persist last_run fails without failing the ingest", async () => {
    const row = settings();
    const logs: string[] = [];
    const update = vi.fn().mockRejectedValue(new Error("db write failed"));
    const db = eventScopedDb(row, {
      bounceIngestSettings: { update },
    }) as never;

    const summary = await ingestBounces(db, {
      eventId: "evt_1",
      createProvider: async () => mockProvider([]),
      log: (msg) => logs.push(msg),
    });

    expect(summary.connectFailed).toBe(false);
    expect(logs.some((m) => m.includes("persist last_run failed"))).toBe(true);
  });

  it("does not persist last_run on noop disabled settings", async () => {
    const row = settings({ enabled: false });
    const update = vi.fn();
    const db = {
      bounceIngestSettings: {
        findUnique: vi.fn().mockResolvedValue(row),
        update,
      },
      bounceIngestProcessedUid: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    } as never;

    await ingestBounces(db, { eventId: "evt_1" });
    expect(update).not.toHaveBeenCalled();
  });

  it("hard-bounces older in-flight delivery when a second NDR hits the same recipient", async () => {
    const row = settings();
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = eventScopedDb(row, {
      emailDelivery: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "del_newer",
            status: "sent",
            recipient_email: "user@example.com",
            event_id: "evt_1",
            queued_at: new Date("2026-08-02"),
          },
          {
            id: "del_older",
            status: "queued",
            recipient_email: "user@example.com",
            event_id: "evt_1",
            queued_at: new Date("2026-08-01"),
          },
        ]),
        updateMany,
      },
    }) as never;

    const provider = mockProvider([
      {
        uid: "201",
        receivedAt: new Date(),
        subject: "Undeliverable 1",
        bodyText: HARD_BODY,
      },
      {
        uid: "202",
        receivedAt: new Date(),
        subject: "Undeliverable 2",
        bodyText: HARD_BODY,
      },
    ]);

    const summary = await ingestBounces(db, {
      eventId: "evt_1",
      createProvider: async () => provider,
      log: () => undefined,
    });

    expect(summary.bouncesApplied).toBe(2);
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls.map((c) => c[0].where.id)).toEqual(["del_newer", "del_older"]);
  });

  it("counts errors when the batch delivery lookup fails", async () => {
    const row = settings();
    const log = vi.fn();
    const db = eventScopedDb(row, {
      emailDelivery: {
        findMany: vi.fn().mockRejectedValue(new Error("batch lookup down")),
        updateMany: vi.fn(),
      },
    }) as never;

    const summary = await ingestBounces(db, {
      eventId: "evt_1",
      createProvider: async () =>
        mockProvider([
          {
            uid: "601",
            receivedAt: new Date(),
            subject: "undeliverable",
            bodyText: HARD_BODY,
          },
        ]),
      log,
    });

    expect(summary.errors).toBe(1);
    expect(summary.bouncesApplied).toBe(0);
    expect(db.emailDelivery.updateMany).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/batch delivery lookup failed: batch lookup down/),
    );
  });

  it("stringifies non-Error batch delivery lookup failures", async () => {
    const row = settings();
    const log = vi.fn();
    const db = eventScopedDb(row, {
      emailDelivery: {
        findMany: vi.fn().mockRejectedValue("lookup blew up"),
        updateMany: vi.fn(),
      },
    }) as never;

    await ingestBounces(db, {
      eventId: "evt_1",
      createProvider: async () =>
        mockProvider([
          {
            uid: "602",
            receivedAt: new Date(),
            subject: "undeliverable",
            bodyText: HARD_BODY,
          },
        ]),
      log,
    });

    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/batch delivery lookup failed: lookup blew up/),
    );
  });

  it("sets connectFailed when provider.connect throws", async () => {
    const row = settings();
    const db = eventScopedDb(row) as never;

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

    let updates = 0;
    const db = eventScopedDb(row, {
      emailDelivery: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "del_1",
            status: "sent",
            recipient_email: "user@example.com",
            event_id: "evt_1",
          },
          {
            id: "del_2",
            status: "sent",
            recipient_email: "other@example.com",
            event_id: "evt_1",
          },
        ]),
        updateMany: vi.fn().mockImplementation(async () => {
          updates += 1;
          if (updates === 1) throw new Error("db blip");
          return { count: 1 };
        }),
      },
    }) as never;

    const summary = await ingestBounces(db, {
      eventId: "evt_1",
      createProvider: async () => mockProvider(messages),
      log: () => undefined,
    });

    expect(summary.errors).toBe(1);
    expect(summary.bouncesApplied).toBe(1);
    expect(summary.messagesSeen).toBe(2);
  });

  it("prunes UIDs at the IMAP lookback boundary even when nothing is enabled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T10:00:00.000Z"));
    try {
      const deleteMany = vi.fn().mockResolvedValue({ count: 3 });
      const db = {
        bounceIngestSettings: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        bounceIngestProcessedUid: { deleteMany },
      } as never;

      const summary = await ingestBounces(db, {});

      expect(summary.noopReason).toBe("none_enabled");
      // Lookback is 2026-07-22T10:00Z; prune keeps the whole UTC boundary day.
      expect(deleteMany).toHaveBeenCalledWith({
        where: { processed_at: { lt: new Date("2026-07-22T00:00:00.000Z") } },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs prune failures without failing the ingest run", async () => {
    const deleteMany = vi.fn().mockRejectedValue(new Error("prune db down"));
    const log = vi.fn();
    const db = {
      bounceIngestSettings: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      bounceIngestProcessedUid: { deleteMany },
    } as never;

    const summary = await ingestBounces(db, { log });

    expect(summary.noopReason).toBe("none_enabled");
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/prune processed UIDs failed: prune db down/));
  });

  it("stringifies non-Error prune failures in the log line", async () => {
    const deleteMany = vi.fn().mockRejectedValue("prune blew up");
    const log = vi.fn();
    const db = {
      bounceIngestSettings: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      bounceIngestProcessedUid: { deleteMany },
    } as never;

    await ingestBounces(db, { log });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/prune processed UIDs failed: prune blew up/));
  });

  it("falls back to console.error when prune fails without a custom log", async () => {
    const deleteMany = vi.fn().mockRejectedValue(new Error("prune db down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const db = {
      bounceIngestSettings: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      bounceIngestProcessedUid: { deleteMany },
    } as never;

    try {
      const summary = await ingestBounces(db, {});
      expect(summary.noopReason).toBe("none_enabled");
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringMatching(/prune processed UIDs failed: prune db down/),
      );
    } finally {
      errSpy.mockRestore();
    }
  });

  it("skips already-processed UIDs", async () => {
    const row = settings();
    const messages: InboundMessage[] = [
      {
        uid: "already",
        receivedAt: new Date(),
        subject: "Delivery Status Notification",
        bodyText: HARD_BODY,
      },
    ];
    const db = eventScopedDb(row, {
      bounceIngestProcessedUid: {
        findMany: vi.fn().mockResolvedValue([{ uid: "already" }]),
        upsert: vi.fn(),
      },
      emailDelivery: {
        findMany: vi.fn(),
        updateMany: vi.fn(),
      },
    }) as never;

    const summary = await ingestBounces(db, {
      eventId: "evt_1",
      createProvider: async () => mockProvider(messages),
      log: () => undefined,
    });

    expect(summary.messagesSeen).toBe(0);
    expect(summary.bouncesApplied).toBe(0);
    expect(db.emailDelivery.findMany).not.toHaveBeenCalled();
  });

  it("counts noMatchingDelivery when no EmailDelivery row exists", async () => {
    const row = settings();
    const db = eventScopedDb(row) as never;

    const summary = await ingestBounces(db, {
      eventId: "evt_1",
      createProvider: async () =>
        mockProvider([
          {
            uid: "201",
            receivedAt: new Date(),
            subject: "undeliverable",
            bodyText: HARD_BODY,
          },
        ]),
      log: () => undefined,
    });

    expect(summary.noMatchingDelivery).toBe(1);
    expect(summary.bouncesApplied).toBe(0);
    expect(db.emailDelivery.updateMany).not.toHaveBeenCalled();
  });

  it("counts softBouncesLogged for a 4xx diagnostic", async () => {
    const row = settings();
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = eventScopedDb(row, {
      emailDelivery: {
        findMany: vi.fn().mockResolvedValue([{
          id: "del_soft",
          status: "sent",
          recipient_email: "user@example.com",
          event_id: "evt_1",
    }]),
        updateMany,
      },
    }) as never;

    const summary = await ingestBounces(db, {
      eventId: "evt_1",
      createProvider: async () =>
        mockProvider([
          {
            uid: "301",
            receivedAt: new Date(),
            subject: "delayed",
            bodyText: SOFT_BODY,
          },
        ]),
      log: () => undefined,
    });

    expect(summary.softBouncesLogged).toBe(1);
    expect(summary.bouncesApplied).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("continues to the next folder when fetch throws", async () => {
    const row = settings({ folders: ["INBOX", "Junk Email"] });
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("folder missing"))
      .mockResolvedValueOnce([
        {
          uid: "401",
          receivedAt: new Date(),
          subject: "undeliverable",
          bodyText: HARD_BODY,
        },
      ]);
    const provider: InboundMailProvider = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      fetchCandidateMessages: fetch,
      markSeen: vi.fn().mockResolvedValue(undefined),
    };
    const db = eventScopedDb(row, {
      emailDelivery: {
        findMany: vi.fn().mockResolvedValue([{
          id: "del_1",
          status: "sent",
          recipient_email: "user@example.com",
          event_id: "evt_1",
    }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }) as never;

    const summary = await ingestBounces(db, {
      eventId: "evt_1",
      createProvider: async () => provider,
      log: () => undefined,
    });

    expect(summary.errors).toBe(1);
    expect(summary.bouncesApplied).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("counts errors when listProcessedUids fails", async () => {
    const row = settings();
    const db = eventScopedDb(row, {
      bounceIngestProcessedUid: {
        findMany: vi.fn().mockRejectedValue(new Error("db timeout")),
        findUnique: vi.fn(),
        upsert: vi.fn(),
        deleteMany: vi.fn(),
      },
    }) as never;

    const summary = await ingestBounces(db, {
      eventId: "evt_1",
      createProvider: async () => mockProvider([]),
      log: () => undefined,
    });

    expect(summary.errors).toBe(1);
    expect(summary.messagesSeen).toBe(0);
  });

  it("counts errors when markUidProcessed fails after parsing", async () => {
    const row = settings();
    const db = eventScopedDb(row, {
      bounceIngestProcessedUid: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockRejectedValue(new Error("uid write failed")),
        deleteMany: vi.fn(),
      },
      emailDelivery: {
        findMany: vi.fn().mockResolvedValue([{
          id: "del_1",
          status: "sent",
          recipient_email: "user@example.com",
          event_id: "evt_1",
    }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }) as never;

    const summary = await ingestBounces(db, {
      eventId: "evt_1",
      createProvider: async () =>
        mockProvider([
          {
            uid: "801",
            receivedAt: new Date(),
            subject: "undeliverable",
            bodyText: HARD_BODY,
          },
        ]),
      log: () => undefined,
    });

    expect(summary.errors).toBe(1);
    expect(summary.bouncesApplied).toBe(1);
  });

  it("counts errors when applyBounceResult throws", async () => {
    const row = settings();
    const db = eventScopedDb(row, {
      emailDelivery: {
        findMany: vi.fn().mockResolvedValue([{
          id: "del_1",
          status: "sent",
          recipient_email: "user@example.com",
          event_id: "evt_1",
    }]),
        updateMany: vi.fn().mockRejectedValue(new Error("update failed")),
      },
    }) as never;

    const summary = await ingestBounces(db, {
      eventId: "evt_1",
      createProvider: async () =>
        mockProvider([
          {
            uid: "601",
            receivedAt: new Date(),
            subject: "undeliverable",
            bodyText: HARD_BODY,
          },
        ]),
      log: () => undefined,
    });

    expect(summary.errors).toBe(1);
    expect(summary.bouncesApplied).toBe(0);
  });

  it("stringifies non-Error applyBounceResult failures", async () => {
    const row = settings();
    const log = vi.fn();
    const db = eventScopedDb(row, {
      emailDelivery: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "del_1",
            status: "sent",
            recipient_email: "user@example.com",
            event_id: "evt_1",
          },
        ]),
        updateMany: vi.fn().mockRejectedValue("update blew up"),
      },
    }) as never;

    const summary = await ingestBounces(db, {
      eventId: "evt_1",
      createProvider: async () =>
        mockProvider([
          {
            uid: "603",
            receivedAt: new Date(),
            subject: "undeliverable",
            bodyText: HARD_BODY,
          },
        ]),
      log,
    });

    expect(summary.errors).toBe(1);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/apply failed.*update blew up/));
  });

  it("leaves already-terminal deliveries counted as neither hard nor soft", async () => {
    const row = settings();
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const db = eventScopedDb(row, {
      emailDelivery: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "del_1",
            status: "sent",
            recipient_email: "user@example.com",
            event_id: "evt_1",
          },
        ]),
        updateMany,
      },
    }) as never;

    const summary = await ingestBounces(db, {
      eventId: "evt_1",
      createProvider: async () =>
        mockProvider([
          {
            uid: "604",
            receivedAt: new Date(),
            subject: "undeliverable",
            bodyText: HARD_BODY,
          },
        ]),
      log: () => undefined,
    });

    expect(summary.bouncesApplied).toBe(0);
    expect(summary.softBouncesLogged).toBe(0);
    expect(summary.errors).toBe(0);
    expect(updateMany).toHaveBeenCalled();
  });

  it("swallows markSeen failures on unparsed messages", async () => {
    const row = settings();
    const markSeen = vi.fn().mockRejectedValue(new Error("flags failed"));
    const db = eventScopedDb(row) as never;

    const summary = await ingestBounces(db, {
      eventId: "evt_1",
      createProvider: async () => ({
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        fetchCandidateMessages: vi.fn().mockResolvedValue([
          {
            uid: "701",
            receivedAt: new Date(),
            subject: "not a bounce",
            bodyText: "Hello world",
          },
        ]),
        markSeen,
      }),
      log: () => undefined,
    });

    expect(summary.unparsed).toBe(1);
    expect(markSeen).toHaveBeenCalledWith("INBOX", ["701"]);
    expect(summary.errors).toBe(0);
  });

  it("returns disabled when eventId matches a disabled settings row", async () => {
    const row = settings({ enabled: false });
    const db = {
      bounceIngestSettings: {
        findUnique: vi.fn().mockResolvedValue(row),
      },
      bounceIngestProcessedUid: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    } as never;

    const summary = await ingestBounces(db, { eventId: "evt_1" });
    expect(summary.noopReason).toBe("disabled");
    expect(summary.eventsProcessed).toBe(0);
  });

  it("ingests all enabled events when eventId is omitted", async () => {
    const row1 = settings({ event_id: "evt_1", id: "bis_1" });
    const row2 = settings({ event_id: "evt_2", id: "bis_2" });
    let connectCalls = 0;
    const db = {
      bounceIngestSettings: {
        findMany: vi.fn().mockResolvedValue([row1, row2]),
        update: vi.fn().mockResolvedValue({}),
      },
      bounceIngestProcessedUid: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      emailDelivery: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn(),
      },
    } as never;

    const summary = await ingestBounces(db, {
      createProvider: async () => {
        connectCalls += 1;
        return mockProvider([]);
      },
      log: () => undefined,
    });

    expect(summary.eventsProcessed).toBe(2);
    expect(connectCalls).toBe(2);
  });

  it("uses the default ImapInboundProvider when createProvider is omitted", async () => {
    const row = settings();
    resolveImapConnectConfigMock.mockResolvedValue({
      host: "imap.example.com",
      port: 993,
      user: "u",
      password: "p",
    });
    const connect = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    ImapInboundProviderMock.mockImplementation(function MockProvider() {
      return {
        connect,
        close,
        fetchCandidateMessages: vi.fn().mockResolvedValue([]),
      };
    });
    const db = eventScopedDb(row) as never;

    await ingestBounces(db, { eventId: "evt_1", log: () => undefined });

    expect(resolveImapConnectConfigMock).toHaveBeenCalled();
    expect(ImapInboundProviderMock).toHaveBeenCalled();
    expect(connect).toHaveBeenCalled();
  });

  it("swallows provider.close failures", async () => {
    const row = settings();
    const markSeen = vi.fn().mockRejectedValue(new Error("flags failed"));
    const db = eventScopedDb(row, {
      emailDelivery: {
        findMany: vi.fn().mockResolvedValue([{
          id: "del_1",
          status: "sent",
          recipient_email: "user@example.com",
          event_id: "evt_1",
    }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }) as never;

    const summary = await ingestBounces(db, {
      eventId: "evt_1",
      createProvider: async () => ({
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        fetchCandidateMessages: vi.fn().mockResolvedValue([
          {
            uid: "501",
            receivedAt: new Date(),
            subject: "undeliverable",
            bodyText: HARD_BODY,
          },
        ]),
        markSeen,
      }),
      log: () => undefined,
    });

    expect(summary.bouncesApplied).toBe(1);
    expect(markSeen).toHaveBeenCalledWith("INBOX", ["501"]);
  });
});

describe("testBounceImapConnection", () => {
  const db = {} as never;

  beforeEach(() => {
    resolveImapConnectConfigMock.mockReset();
    ImapInboundProviderMock.mockReset();
  });

  it("probes the first configured folder when connect succeeds", async () => {
    resolveImapConnectConfigMock.mockResolvedValue({
      host: "imap.example.com",
      port: 993,
      user: "u",
      password: "p",
    });
    const probeFolder = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    ImapInboundProviderMock.mockImplementation(function MockProvider() {
      return { connect, close, probeFolder };
    });

    const result = await testBounceImapConnection(db, settings());

    expect(result).toEqual({ ok: true, foldersChecked: 1 });
    expect(probeFolder).toHaveBeenCalledWith("INBOX");
    expect(close).toHaveBeenCalled();
  });

  it("returns connect error detail including IMAP responseText", async () => {
    resolveImapConnectConfigMock.mockResolvedValue({
      host: "imap.example.com",
      port: 993,
      user: "u",
      password: "p",
    });
    const err = new Error("Command failed") as Error & { responseText: string };
    err.responseText = "AUTHENTICATIONFAILED";
    const connect = vi.fn().mockRejectedValue(err);
    ImapInboundProviderMock.mockImplementation(function MockProvider() {
      return {
        connect,
        close: vi.fn(),
        probeFolder: vi.fn(),
      };
    });

    const result = await testBounceImapConnection(db, settings());

    expect(result).toEqual({
      ok: false,
      error: "Command failed: AUTHENTICATIONFAILED",
    });
  });

  it("returns resolve auth errors without throwing", async () => {
    resolveImapConnectConfigMock.mockRejectedValue(new BounceAuthError("IMAP host is not configured"));

    const result = await testBounceImapConnection(db, settings({ imap_host: null }));

    expect(result).toEqual({ ok: false, error: "IMAP host is not configured" });
  });

  it("falls back to default folders when settings.folders is empty", async () => {
    resolveImapConnectConfigMock.mockResolvedValue({
      host: "imap.example.com",
      port: 993,
      user: "u",
      password: "p",
    });
    const connect = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const probeFolder = vi.fn().mockResolvedValue(undefined);
    ImapInboundProviderMock.mockImplementation(function MockProvider() {
      return { connect, close, probeFolder };
    });

    const result = await testBounceImapConnection(db, settings({ folders: [] }));

    expect(result).toEqual({ ok: true, foldersChecked: 1 });
    expect(probeFolder).toHaveBeenCalledWith("INBOX");
    expect(close).toHaveBeenCalled();
  });
});
