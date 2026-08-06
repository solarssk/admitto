import { describe, expect, it, vi } from "vitest";
import {
  bounceIngestSystemLogEnv,
  reportBounceIngestSystemLog,
} from "../../src/bounceIngest/reportSystemLog.js";
import type { IngestSummary } from "../../src/bounceIngest/types.js";

function summary(partial: Partial<IngestSummary> = {}): IngestSummary {
  return {
    eventsProcessed: 1,
    messagesSeen: 1,
    bouncesApplied: 0,
    softBouncesLogged: 0,
    unparsed: 0,
    noMatchingDelivery: 0,
    errors: 0,
    connectFailed: false,
    ...partial,
  };
}

describe("bounceIngestSystemLogEnv", () => {
  it("prefers BOUNCE_INGEST_APP_URL over ADMITTO_INTERNAL_URL", () => {
    expect(
      bounceIngestSystemLogEnv({
        BOUNCE_INGEST_APP_URL: " http://app:3000/ ",
        ADMITTO_INTERNAL_URL: "http://other:3000",
        OPS_HEALTH_TOKEN: " token-value ",
      }),
    ).toEqual({
      appBaseUrl: "http://app:3000",
      opsHealthToken: "token-value",
    });
  });

  it("falls back to ADMITTO_INTERNAL_URL when BOUNCE_INGEST_APP_URL is unset", () => {
    expect(
      bounceIngestSystemLogEnv({
        ADMITTO_INTERNAL_URL: "http://internal:3000/",
        OPS_HEALTH_TOKEN: "ops",
      }),
    ).toEqual({
      appBaseUrl: "http://internal:3000",
      opsHealthToken: "ops",
    });
  });

  it("treats blank BOUNCE_INGEST_APP_URL as unset", () => {
    expect(
      bounceIngestSystemLogEnv({
        BOUNCE_INGEST_APP_URL: "   ",
        ADMITTO_INTERNAL_URL: "http://internal:3000",
        OPS_HEALTH_TOKEN: "ops",
      }),
    ).toEqual({
      appBaseUrl: "http://internal:3000",
      opsHealthToken: "ops",
    });
  });

  it("returns undefined URL and token when env is empty", () => {
    expect(bounceIngestSystemLogEnv({})).toEqual({
      appBaseUrl: undefined,
      opsHealthToken: undefined,
    });
    expect(bounceIngestSystemLogEnv({ OPS_HEALTH_TOKEN: "   " })).toEqual({
      appBaseUrl: undefined,
      opsHealthToken: undefined,
    });
  });
});

describe("reportBounceIngestSystemLog", () => {
  it("no-ops when URL or token is missing", async () => {
    const fetchImpl = vi.fn();
    await reportBounceIngestSystemLog({
      eventId: "evt_1",
      summary: summary(),
      fetchImpl: fetchImpl as never,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("POSTs mail_bounce_ingest_ok with counts on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await reportBounceIngestSystemLog({
      eventId: "evt_1",
      summary: summary({ messagesSeen: 2, bouncesApplied: 1 }),
      appBaseUrl: "http://app:3000/",
      opsHealthToken: "ops-token",
      fetchImpl: fetchImpl as never,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://app:3000/api/ops/system-logs",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer ops-token",
        }),
      }),
    );
    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as { body: string }).body) as {
      message: string;
      level: string;
      fields: Record<string, unknown>;
    };
    expect(body.message).toBe("mail_bounce_ingest_ok");
    expect(body.level).toBe("info");
    expect(body.fields).toMatchObject({
      event_id: "evt_1",
      messagesSeen: 2,
      bouncesApplied: 1,
    });
  });

  it("uses global fetch when fetchImpl is omitted", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true, status: 200 } as Response);
    try {
      await reportBounceIngestSystemLog({
        eventId: "evt_1",
        summary: summary(),
        appBaseUrl: "http://app:3000",
        opsHealthToken: "ops-token",
      });
      expect(fetchSpy).toHaveBeenCalledWith(
        "http://app:3000/api/ops/system-logs",
        expect.objectContaining({ method: "POST" }),
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("POSTs mail_bounce_ingest_failed when errors are present without connectFailed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await reportBounceIngestSystemLog({
      eventId: "evt_1",
      summary: summary({ errors: 2, connectFailed: false }),
      appBaseUrl: "http://app:3000",
      opsHealthToken: "ops-token",
      fetchImpl: fetchImpl as never,
      timeoutMs: 0,
    });
    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as { body: string }).body) as {
      message: string;
      level: string;
    };
    expect(body.message).toBe("mail_bounce_ingest_failed");
    expect(body.level).toBe("error");
  });

  it("POSTs mail_bounce_ingest_failed on connect failure and does not throw on network error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    const log = vi.fn();
    await expect(
      reportBounceIngestSystemLog({
        eventId: "evt_1",
        summary: summary({ connectFailed: true, errors: 1 }),
        appBaseUrl: "http://app:3000",
        opsHealthToken: "ops-token",
        fetchImpl: fetchImpl as never,
        log,
      }),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
  });

  it("stringifies non-Error network failures", async () => {
    const fetchImpl = vi.fn().mockRejectedValue("offline-string");
    const log = vi.fn();
    await reportBounceIngestSystemLog({
      eventId: "evt_1",
      summary: summary({ connectFailed: true }),
      appBaseUrl: "http://app:3000",
      opsHealthToken: "ops-token",
      fetchImpl: fetchImpl as never,
      log,
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("offline-string"));
  });

  it("passes an AbortSignal so a hung app cannot stall the ingest tick", async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve({ ok: false, status: 503 });
    });
    const log = vi.fn();
    await reportBounceIngestSystemLog({
      eventId: "evt_1",
      summary: summary(),
      appBaseUrl: "http://app:3000",
      opsHealthToken: "ops-token",
      fetchImpl: fetchImpl as never,
      log,
      timeoutMs: 50,
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("system-log POST 503"));
  });

  it("aborts when the app never responds within timeoutMs", async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    const log = vi.fn();
    await reportBounceIngestSystemLog({
      eventId: "evt_1",
      summary: summary(),
      appBaseUrl: "http://app:3000",
      opsHealthToken: "ops-token",
      fetchImpl: fetchImpl as never,
      log,
      timeoutMs: 20,
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("system-log POST failed"));
  });
});
