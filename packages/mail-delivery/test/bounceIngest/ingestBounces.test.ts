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

const SOFT_BODY =
  "user@example.com failed: host mx.example.com (203.0.113.1) said: 450 4.2.1 Greylisted (in reply to RCPT TO command)";

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

  it("returns none_enabled when no eventId and nothing is enabled", async () => {
    const db = {
      bounceIngestSettings: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as never;

    const summary = await ingestBounces(db, {});
    expect(summary.noopReason).toBe("none_enabled");
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
    const db = {
      bounceIngestSettings: {
        findMany: vi.fn().mockResolvedValue([row]),
      },
      bounceIngestProcessedUid: {
        findUnique: vi.fn().mockResolvedValue({ id: "processed_1" }),
        upsert: vi.fn(),
      },
      emailDelivery: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    } as never;

    const summary = await ingestBounces(db, {
      eventId: "evt_1",
      createProvider: async () => mockProvider(messages),
      log: () => undefined,
    });

    expect(summary.messagesSeen).toBe(0);
    expect(summary.bouncesApplied).toBe(0);
    expect(db.emailDelivery.findFirst).not.toHaveBeenCalled();
  });

  it("counts noMatchingDelivery when no EmailDelivery row exists", async () => {
    const row = settings();
    const db = {
      bounceIngestSettings: {
        findMany: vi.fn().mockResolvedValue([row]),
      },
      bounceIngestProcessedUid: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
      },
      emailDelivery: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    } as never;

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
    expect(db.emailDelivery.update).not.toHaveBeenCalled();
  });

  it("counts softBouncesLogged for a 4xx diagnostic", async () => {
    const row = settings();
    const updateDelivery = vi.fn().mockResolvedValue({});
    const db = {
      bounceIngestSettings: {
        findMany: vi.fn().mockResolvedValue([row]),
      },
      bounceIngestProcessedUid: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
      },
      emailDelivery: {
        findFirst: vi.fn().mockResolvedValue({
          id: "del_soft",
          status: "sent",
          recipient_email: "user@example.com",
          event_id: "evt_1",
        }),
        update: updateDelivery,
      },
    } as never;

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
    const db = {
      bounceIngestSettings: {
        findMany: vi.fn().mockResolvedValue([row]),
      },
      bounceIngestProcessedUid: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
      },
      emailDelivery: {
        findFirst: vi.fn().mockResolvedValue({
          id: "del_1",
          status: "sent",
          recipient_email: "user@example.com",
          event_id: "evt_1",
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    } as never;

    const summary = await ingestBounces(db, {
      eventId: "evt_1",
      createProvider: async () => provider,
      log: () => undefined,
    });

    expect(summary.errors).toBe(1);
    expect(summary.bouncesApplied).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("counts errors when applyBounceResult throws", async () => {
    const row = settings();
    const db = {
      bounceIngestSettings: {
        findMany: vi.fn().mockResolvedValue([row]),
      },
      bounceIngestProcessedUid: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
      },
      emailDelivery: {
        findFirst: vi.fn().mockResolvedValue({
          id: "del_1",
          status: "sent",
          recipient_email: "user@example.com",
          event_id: "evt_1",
        }),
        update: vi.fn().mockRejectedValue(new Error("update failed")),
      },
    } as never;

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

  it("swallows markSeen failures on unparsed messages", async () => {
    const row = settings();
    const markSeen = vi.fn().mockRejectedValue(new Error("flags failed"));
    const db = {
      bounceIngestSettings: {
        findMany: vi.fn().mockResolvedValue([row]),
      },
      bounceIngestProcessedUid: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
      },
      emailDelivery: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    } as never;

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
    expect(markSeen).toHaveBeenCalled();
    expect(summary.errors).toBe(0);
  });

  it("returns disabled when eventId matches only a disabled row in the filter path", async () => {
    const row = settings({ enabled: false });
    const db = {
      bounceIngestSettings: {
        findMany: vi.fn().mockResolvedValue([row]),
        findUnique: vi.fn().mockResolvedValue(row),
      },
    } as never;

    const summary = await ingestBounces(db, { eventId: "evt_1" });
    expect(summary.noopReason).toBe("disabled");
    expect(summary.eventsProcessed).toBe(0);
  });

  it("returns disabled when findMany is empty but a disabled row exists", async () => {
    const row = settings({ enabled: false });
    const db = {
      bounceIngestSettings: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(row),
      },
    } as never;

    const summary = await ingestBounces(db, { eventId: "evt_1" });
    expect(summary.noopReason).toBe("disabled");
  });

  it("ingests all enabled events when eventId is omitted", async () => {
    const row1 = settings({ event_id: "evt_1", id: "bis_1" });
    const row2 = settings({ event_id: "evt_2", id: "bis_2" });
    let connectCalls = 0;
    const db = {
      bounceIngestSettings: {
        findMany: vi.fn().mockResolvedValue([row1, row2]),
      },
      bounceIngestProcessedUid: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
      },
      emailDelivery: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
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
    const db = {
      bounceIngestSettings: {
        findMany: vi.fn().mockResolvedValue([row]),
      },
      bounceIngestProcessedUid: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
      },
      emailDelivery: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    } as never;

    await ingestBounces(db, { eventId: "evt_1", log: () => undefined });

    expect(resolveImapConnectConfigMock).toHaveBeenCalled();
    expect(ImapInboundProviderMock).toHaveBeenCalled();
    expect(connect).toHaveBeenCalled();
  });

  it("swallows provider.close failures", async () => {
    const row = settings();
    const markSeen = vi.fn().mockRejectedValue(new Error("flags failed"));
    const db = {
      bounceIngestSettings: {
        findMany: vi.fn().mockResolvedValue([row]),
      },
      bounceIngestProcessedUid: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
      },
      emailDelivery: {
        findFirst: vi.fn().mockResolvedValue({
          id: "del_1",
          status: "sent",
          recipient_email: "user@example.com",
          event_id: "evt_1",
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    } as never;

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
    expect(markSeen).toHaveBeenCalled();
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
