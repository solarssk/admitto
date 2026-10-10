import { afterEach, describe, expect, it, vi } from "vitest";
import { emitSystemLog, resetSystemLogBufferForTest, type SystemLogEntry } from "@admitto/shared/system-log";
import { installSystemLogRelay, publishSystemLogEntry, uninstallSystemLogRelay } from "../src/lib/system-log-publish.js";

function entry(overrides: Partial<SystemLogEntry> = {}): SystemLogEntry {
  return {
    id: 1,
    ts: "2026-08-22T00:00:00.000Z",
    level: "info",
    source: "worker",
    message: "ok claimed=1",
    ...overrides,
  };
}

afterEach(() => {
  resetSystemLogBufferForTest();
  uninstallSystemLogRelay();
});

describe("publishSystemLogEntry", () => {
  it("no-ops when neither BOUNCE_INGEST_APP_URL nor ADMITTO_INTERNAL_URL is set", () => {
    const fetchImpl = vi.fn();
    publishSystemLogEntry(entry(), { env: { OPS_HEALTH_TOKEN: "token" }, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("no-ops when OPS_HEALTH_TOKEN is missing", () => {
    const fetchImpl = vi.fn();
    publishSystemLogEntry(entry(), { env: { ADMITTO_INTERNAL_URL: "http://app:3000" }, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("prefers BOUNCE_INGEST_APP_URL over ADMITTO_INTERNAL_URL and POSTs the entry", () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    publishSystemLogEntry(entry({ source: "wallet", level: "error", message: "push failed", fields: { attempt: 2 } }), {
      env: {
        BOUNCE_INGEST_APP_URL: "http://app:3000/",
        ADMITTO_INTERNAL_URL: "http://other:3000",
        OPS_HEALTH_TOKEN: "ops-token",
      },
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://app:3000/api/ops/system-logs",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer ops-token" }),
      }),
    );
    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as { body: string }).body) as Record<string, unknown>;
    expect(body).toMatchObject({ source: "wallet", level: "error", message: "push failed", fields: { attempt: 2 } });
  });

  it("truncates an over-length message to the ingest endpoint's 200-char cap", () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    publishSystemLogEntry(entry({ message: "x".repeat(250) }), {
      env: { ADMITTO_INTERNAL_URL: "http://app:3000", OPS_HEALTH_TOKEN: "ops-token" },
      fetchImpl,
    });

    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as { body: string }).body) as { message: string };
    expect(body.message).toHaveLength(200);
  });

  it("warns to stdout (not throw) on a non-ok response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    publishSystemLogEntry(entry(), {
      env: { ADMITTO_INTERNAL_URL: "http://app:3000", OPS_HEALTH_TOKEN: "ops-token" },
      fetchImpl,
    });

    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("POST 500")));
    warnSpy.mockRestore();
  });

  it("does not throw when the request rejects", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    expect(() =>
      publishSystemLogEntry(entry(), {
        env: { ADMITTO_INTERNAL_URL: "http://app:3000", OPS_HEALTH_TOKEN: "ops-token" },
        fetchImpl,
      }),
    ).not.toThrow();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
  });
});

describe("the limits of the relay", () => {
  const env = { ADMITTO_INTERNAL_URL: "http://app:3000", OPS_HEALTH_TOKEN: "ops-token" };
  const send = (fetchImpl: ReturnType<typeof vi.fn>, message: string, nowMs: number) =>
    publishSystemLogEntry(entry({ source: "wallet", level: "warn", message, fields: { n: 1 } }), { env, fetchImpl, nowMs });
  const relayed = (fetchImpl: ReturnType<typeof vi.fn>) =>
    fetchImpl.mock.calls.map((call) => JSON.parse((call[1] as { body: string }).body) as { message: string; fields?: Record<string, unknown> });

  it("relays at most 20 lines of one message in a minute, marks the last of them, and holds the rest back", () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    for (let i = 0; i < 200; i += 1) send(fetchImpl, "passcreator_request_rejected", 1_000 + i);

    const lines = relayed(fetchImpl);
    expect(lines).toHaveLength(20);
    expect(lines[18]!.fields).toEqual({ n: 1 });
    expect(lines[19]!.fields).toMatchObject({ n: 1, relay_note: expect.stringContaining("not relayed") });
  });

  it("still relays other messages after a burst of one, which is where the line that sums it up comes", () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    for (let i = 0; i < 300; i += 1) send(fetchImpl, "passcreator_request_rejected", 1_000);

    send(fetchImpl, "wallet_pass_erasure_delete_failed", 1_000);
    send(fetchImpl, "retention summary", 1_000);

    expect(relayed(fetchImpl).slice(-2).map((line) => line.message)).toEqual(["wallet_pass_erasure_delete_failed", "retention summary"]);
  });

  it("relays again once the minute is over", () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    for (let i = 0; i < 25; i += 1) send(fetchImpl, "passcreator_request_rejected", 1_000);
    expect(fetchImpl).toHaveBeenCalledTimes(20);

    send(fetchImpl, "passcreator_request_rejected", 1_000 + 60_000);

    expect(fetchImpl).toHaveBeenCalledTimes(21);
  });

  it("keeps the whole relay below 90 lines a minute, however many different messages there are", () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    for (let i = 0; i < 400; i += 1) send(fetchImpl, `message ${i}`, 1_000);

    expect(fetchImpl).toHaveBeenCalledTimes(90);
  });

  it("forgets the messages whose minute is over when it has seen very many different ones", () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    for (let i = 0; i < 250; i += 1) send(fetchImpl, `old message ${i}`, 1_000);

    // A minute later: the table is cleaned, and a message that was at its limit can be relayed again.
    send(fetchImpl, "old message 0", 70_000);

    expect(relayed(fetchImpl).filter((line) => line.message === "old message 0")).toHaveLength(2);
  });
});

describe("installSystemLogRelay / uninstallSystemLogRelay", () => {
  afterEach(() => {
    uninstallSystemLogRelay();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("makes emitSystemLog trigger a relay POST once installed, and stops once uninstalled", () => {
    vi.stubEnv("ADMITTO_INTERNAL_URL", "http://app:3000");
    vi.stubEnv("OPS_HEALTH_TOKEN", "ops-token");
    vi.spyOn(console, "info").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200 } as Response);

    installSystemLogRelay();
    emitSystemLog("worker", "info", "relayed via install");
    expect(fetchSpy).toHaveBeenCalledWith("http://app:3000/api/ops/system-logs", expect.anything());

    uninstallSystemLogRelay();
    fetchSpy.mockClear();
    emitSystemLog("worker", "info", "not relayed after uninstall");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
