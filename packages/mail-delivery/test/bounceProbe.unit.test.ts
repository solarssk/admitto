import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BounceIngestSettings } from "@admitto/db";
import { resolveMailConfig } from "@admitto/mailer-config";

const { imapProviderCtor, resolveImapConnectConfigMock } = vi.hoisted(() => ({
  imapProviderCtor: vi.fn(),
  resolveImapConnectConfigMock: vi.fn(),
}));

vi.mock("../src/bounceIngest/imapProvider.js", () => ({
  ImapInboundProvider: imapProviderCtor,
}));

vi.mock("../src/bounceIngest/resolveAuth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/bounceIngest/resolveAuth.js")>();
  return {
    ...actual,
    resolveImapConnectConfig: resolveImapConnectConfigMock,
  };
});

import {
  BounceProbeSetupError,
  runEventBounceProbe,
} from "../src/bounceProbe.js";
import { sendEventTransportTestEmail } from "../src/transportTest.js";
import type { InboundMailProvider, InboundMessage } from "../src/bounceIngest/types.js";

vi.mock("@admitto/mailer-config", () => ({
  resolveMailConfig: vi.fn(),
}));

vi.mock("../src/transportTest.js", () => ({
  sendEventTransportTestEmail: vi.fn(),
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

function baseDb(overrides: {
  bounceIngestSettings?: { findUnique?: ReturnType<typeof vi.fn> };
  bounceIngestProcessedUid?: {
    findUnique?: ReturnType<typeof vi.fn>;
    findMany?: ReturnType<typeof vi.fn>;
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
      findMany: overrides.bounceIngestProcessedUid?.findMany ?? vi.fn().mockResolvedValue([]),
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
    imapProviderCtor.mockImplementation(function MockImapProvider() {
      return mockProvider([]);
    });
    resolveImapConnectConfigMock.mockResolvedValue({
      host: "imap.example.com",
      port: 993,
      user: "bounce@example.com",
      password: "secret",
    });
    vi.mocked(resolveMailConfig).mockResolvedValue({
      provider: "export_only",
      fromAddress: "org@example.com",
    } as never);
    vi.mocked(sendEventTransportTestEmail).mockResolvedValue({
      status: "sent",
      provider: "export_only",
      providerMessageId: "<mid@example.com>",
    });
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
    vi.mocked(sendEventTransportTestEmail).mockResolvedValueOnce({
      status: "failed",
      provider: "smtp",
      error: "SMTP rejected recipient",
    });

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

  it("returns failed with operator-safe copy when mailer setup throws", async () => {
    vi.mocked(sendEventTransportTestEmail).mockRejectedValueOnce(
      new Error("destination is a private, loopback, or link-local address"),
    );
    vi.mocked(resolveMailConfig).mockResolvedValueOnce({
      provider: "smtp",
      fromAddress: "org@example.com",
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
    expect(result.message).toMatch(
      /ALLOW_PRIVATE_MAIL_DESTINATIONS|MAIL_PRIVATE_DESTINATION_ALLOWLIST|private address/i,
    );
    expect(result.message).not.toMatch(/getaddrinfo|ECONNREFUSED/i);
    expect(result.sendResult.status).toBe("rejected");
    expect(result.sendResult.provider).toBe("smtp");
  });

  it("uses export_only provider when setup fails before mail config resolves", async () => {
    vi.mocked(sendEventTransportTestEmail).mockRejectedValueOnce(new Error("mail transport not configured"));
    vi.mocked(resolveMailConfig).mockRejectedValueOnce(new Error("Cannot resolve mail provider"));

    const result = await runEventBounceProbe(
      {
        eventId: "evt_1",
        toAddress: "nobody@example.com",
        ingestOptions: { createProvider: async () => mockProvider([]) },
      },
      baseDb() as never,
    );

    expect(result.status).toBe("failed");
    expect(result.sendResult.provider).toBe("export_only");
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
    const markSeen = vi.fn().mockRejectedValue(new Error("flags failed"));

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
        ingestOptions: {
          createProvider: async () => ({
            ...mockProvider(messages),
            markSeen,
          }),
        },
      },
      baseDb() as never,
    );

    expect(result.status).toBe("ok");
    expect(result.smtpCode).toMatch(/^550/);
    expect(result.message).toMatch(/Bounce received/i);
    expect(markSeen).toHaveBeenCalled();
  });

  it("opens the default IMAP provider when createProvider is not injected", async () => {
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
      },
      baseDb() as never,
    );

    expect(resolveImapConnectConfigMock).toHaveBeenCalled();
    expect(imapProviderCtor).toHaveBeenCalled();
    expect(result.status).toBe("timeout");
  });

  it("uses the default sleep between poll iterations", async () => {
    vi.useFakeTimers();
    const promise = runEventBounceProbe(
      {
        eventId: "evt_1",
        toAddress: "nobody@example.com",
        timeoutMs: 100,
        pollMs: 40,
        ingestOptions: { createProvider: async () => mockProvider([]) },
      },
      baseDb() as never,
    );
    await vi.advanceTimersByTimeAsync(150);
    const result = await promise;
    expect(result.status).toBe("timeout");
    vi.useRealTimers();
  });

  it("does not skip sidecar-processed UIDs (probe vs sidecar race)", async () => {
    const db = baseDb({
      bounceIngestProcessedUid: {
        findUnique: vi.fn().mockResolvedValue({ id: "seen" }),
        findMany: vi.fn().mockResolvedValue([{ uid: "seen" }]),
        upsert: vi.fn().mockResolvedValue({}),
      },
    });
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

    expect(result.status).toBe("ok");
    expect(result.smtpCode).toMatch(/^550/);
    expect(db.bounceIngestProcessedUid.upsert).toHaveBeenCalled();
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
    expect(result.message).toMatch(/within 1 seconds|IMAP/i);
  });

  it("returns failed (not 500) when IMAP never connects", async () => {
    let t = 0;
    const provider: InboundMailProvider = {
      connect: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      close: vi.fn().mockResolvedValue(undefined),
      fetchCandidateMessages: vi.fn(),
    };

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
        ingestOptions: { createProvider: async () => provider },
      },
      baseDb() as never,
    );

    expect(result.status).toBe("failed");
    expect(result.message).toMatch(/connect|IMAP|refused/i);
    expect(result.message).not.toMatch(/ECONNREFUSED/);
  });

  it("returns failed when opening the IMAP provider throws before connect", async () => {
    const result = await runEventBounceProbe(
      {
        eventId: "evt_1",
        toAddress: "nobody@example.com",
        timeoutMs: 30,
        pollMs: 5,
        sleep: async () => undefined,
        ingestOptions: {
          createProvider: async () => {
            throw new Error("IMAP password decrypt failed");
          },
        },
      },
      baseDb() as never,
    );

    expect(result.status).toBe("failed");
    expect(result.message).toMatch(/open the bounce mailbox|IMAP settings/i);
    expect(result.message).not.toMatch(/decrypt/i);
  });

  it("reconnects after a mid-poll IMAP failure and still finds the bounce", async () => {
    let tick = 0;
    let poll = 0;
    const messages: InboundMessage[] = [
      {
        uid: "fresh",
        receivedAt: new Date(),
        subject: "Undeliverable",
        bodyText: HARD_BODY,
      },
    ];
    const connect = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const fetch = vi.fn().mockImplementation(async () => {
      poll += 1;
      if (poll === 1) throw new Error("connection reset");
      return messages;
    });
    const provider: InboundMailProvider = { connect, close, fetchCandidateMessages: fetch };

    const result = await runEventBounceProbe(
      {
        eventId: "evt_1",
        toAddress: "nobody@example.com",
        timeoutMs: 80,
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
    expect(connect).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalled();
  });

  it("ignores a stale same-recipient hard bounce from before this probe", async () => {
    let t = 0;
    const stale: InboundMessage = {
      uid: "old",
      receivedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      subject: "Undeliverable",
      bodyText: HARD_BODY,
    };
    const fetch = vi.fn().mockResolvedValue([stale]);
    const provider: InboundMailProvider = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      fetchCandidateMessages: fetch,
    };

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
        ingestOptions: { createProvider: async () => provider },
      },
      baseDb() as never,
    );

    expect(result.status).toBe("timeout");
    expect(fetch).toHaveBeenCalled();
    const sinceArg = fetch.mock.calls[0]?.[1] as Date;
    expect(sinceArg.getTime()).toBeGreaterThan(Date.now() - 5 * 60 * 1000);
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
