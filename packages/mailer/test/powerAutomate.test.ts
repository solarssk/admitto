import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import { Agent, fetch as undiciFetch } from "undici";
import { PowerAutomateAdapter } from "../src/adapters/powerAutomate.js";
import type { PowerAutomateConfig } from "../src/config.js";
import * as ssrfGuard from "../src/ssrfGuard.js";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { resetMailSentThrottleForTest } from "../src/adapterUtils.js";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

vi.mock("undici", () => {
  function MockAgent(this: { close: () => Promise<void> }) {
    this.close = vi.fn().mockResolvedValue(undefined);
  }
  return {
    Agent: vi.fn(MockAgent),
    fetch: vi.fn(),
  };
});

const mockedLookup = vi.mocked(lookup);
const mockedUndiciFetch = vi.mocked(undiciFetch);
const MockedAgent = vi.mocked(Agent);

beforeEach(() => {
  mockedLookup.mockClear();
  mockedLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as Awaited<
    ReturnType<typeof lookup>
  >);
  mockedUndiciFetch.mockClear();
  MockedAgent.mockClear();
  resetSystemLogBufferForTest();
  resetMailSentThrottleForTest();
});

const config: PowerAutomateConfig = {
  provider: "powerautomate",
  url: "https://prod-1.westeurope.logic.azure.com/workflows/x/triggers/manual/paths/invoke?sig=secret",
  key: "test-secret-key",
  fromAddress: "events@example.com",
  fromName: "Events",
  replyTo: "reply@example.com",
};

describe("PowerAutomateAdapter", () => {
  it("POSTs JSON with sender fields and x-admitto-key; maps 2xx => accepted", async () => {
    let captured: any;
    const fetchFn = vi.fn(async (_url: string, init: any) => {
      captured = init;
      return {
        ok: true,
        status: 200,
        text: async () => '{"status":"sent"}',
        headers: { get: (h: string) => (h === "x-ms-workflow-run-id" ? "run-9" : null) },
      };
    });

    const adapter = new PowerAutomateAdapter(config, fetchFn as unknown as typeof fetch);
    const res = await adapter.send({ to: "x@example.com", subject: "S", html: "<p>h</p>", idempotencyKey: "k1" });

    expect(res.status).toBe("accepted");
    expect(res.providerMessageId).toBe("run-9");
    expect(res.idempotencyKey).toBe("k1");
    expect(captured.headers["x-admitto-key"]).toBe("test-secret-key");
    expect(JSON.parse(captured.body)).toMatchObject({
      to: "x@example.com",
      subject: "S",
      html: "<p>h</p>",
      fromAddress: "events@example.com",
      fromName: "Events",
      replyTo: "reply@example.com",
    });
    expect(adapter.capabilities.deliveryResultSemantics).toBe("accepted_only");

    const logs = querySystemLogs({ source: "mail" });
    expect(
      logs.some((entry) => entry.message === "mail_sent" && entry.fields?.provider === "powerautomate"),
    ).toBe(true);
  });

  it("omits key header when key is not configured", async () => {
    let captured: any;
    const fetchFn = vi.fn(async (_url: string, init: any) => {
      captured = init;
      return { ok: true, status: 202, text: async () => "", headers: { get: () => null } };
    });
    const adapter = new PowerAutomateAdapter(
      { provider: "powerautomate", url: config.url, fromAddress: "a@example.com" },
      fetchFn as unknown as typeof fetch,
    );
    await adapter.send({ to: "x@example.com", subject: "S", html: "<p>h</p>" });
    expect(captured.headers["x-admitto-key"]).toBeUndefined();
  });

  it("maps HTTP 401 to rejected", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
      headers: { get: () => null },
    }));
    const adapter = new PowerAutomateAdapter(config, fetchFn as unknown as typeof fetch);
    const res = await adapter.send({ to: "x@example.com", subject: "S", html: "<p>h</p>" });
    expect(res.status).toBe("rejected");
    expect(res.retryable).toBe(false);
    expect(res.error).toContain("401");

    const logs = querySystemLogs({ source: "mail" });
    expect(logs.some((entry) => entry.message === "mail_send_failed" && entry.level === "error")).toBe(true);
  });

  it("does not append a delimiter when a failed workflow response has no body", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "",
      headers: { get: () => null },
    }));
    const adapter = new PowerAutomateAdapter(config, fetchFn as unknown as typeof fetch);

    const res = await adapter.send({ to: "x@example.com", subject: "S", html: "<p>h</p>" });

    expect(res.error).toBe("Power Automate: HTTP 500");
  });

  it("catches network exception => failed+retryable", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const adapter = new PowerAutomateAdapter(config, fetchFn as unknown as typeof fetch);
    const res = await adapter.send({ to: "x@example.com", subject: "S", html: "<p>h</p>" });
    expect(res.status).toBe("failed");
    expect(res.retryable).toBe(true);
    expect(res.error).toContain("ECONNREFUSED");
  });

  it("throws MailDestinationError for a private/loopback destination without calling fetchFn (SSRF guard)", async () => {
    const fetchFn = vi.fn();
    const adapter = new PowerAutomateAdapter(
      { ...config, url: "https://127.0.0.1:9999/internal-webhook" },
      fetchFn as unknown as typeof fetch,
    );
    await expect(
      adapter.send({ to: "x@example.com", subject: "S", html: "<p>h</p>" }),
    ).rejects.toMatchObject({
      name: "MailDestinationError",
      code: "mail_destination_blocked",
    });
    expect(fetchFn).not.toHaveBeenCalled();

    const logs = querySystemLogs({ source: "security" });
    expect(logs.some((entry) => entry.message === "mail_destination_blocked" && entry.level === "warn")).toBe(true);
  });

  it("throws MailDestinationError when hostname resolves to a private address at send-time (DNS rebinding)", async () => {
    mockedLookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }] as Awaited<
      ReturnType<typeof lookup>
    >);
    const fetchFn = vi.fn();
    const adapter = new PowerAutomateAdapter(config, fetchFn as unknown as typeof fetch);
    await expect(
      adapter.send({ to: "x@example.com", subject: "S", html: "<p>h</p>" }),
    ).rejects.toMatchObject({
      name: "MailDestinationError",
      code: "mail_destination_blocked",
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("falls back to a generic message when the destination guard throws a non-Error", async () => {
    const spy = vi
      .spyOn(ssrfGuard, "resolveSafeMailDestination")
      .mockRejectedValueOnce("not-an-error");
    const fetchFn = vi.fn();
    const adapter = new PowerAutomateAdapter(config, fetchFn as unknown as typeof fetch);
    const res = await adapter.send({ to: "x@example.com", subject: "S", html: "<p>h</p>" });
    expect(res.status).toBe("rejected");
    expect(res.error).toBe("mail transport destination is not permitted");
    expect(fetchFn).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("soft-rejects with the Error message when the destination guard throws a non-MailDestinationError", async () => {
    const spy = vi
      .spyOn(ssrfGuard, "resolveSafeMailDestination")
      .mockRejectedValueOnce(new Error("unexpected guard failure"));
    const fetchFn = vi.fn();
    const adapter = new PowerAutomateAdapter(config, fetchFn as unknown as typeof fetch);
    const res = await adapter.send({ to: "x@example.com", subject: "S", html: "<p>h</p>" });
    expect(res.status).toBe("rejected");
    expect(res.error).toBe("unexpected guard failure");
    expect(fetchFn).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("sends with redirect: 'error' so the fetch itself refuses to follow a redirect", async () => {
    let captured: any;
    const fetchFn = vi.fn(async (_url: string, init: any) => {
      captured = init;
      return { ok: true, status: 200, text: async () => "", headers: { get: () => null } };
    });
    const adapter = new PowerAutomateAdapter(config, fetchFn as unknown as typeof fetch);
    await adapter.send({ to: "x@example.com", subject: "S", html: "<p>h</p>" });
    expect(captured.redirect).toBe("error");
  });

  describe("DNS pinning (no fetchFn injected — production path)", () => {
    beforeEach(() => {
      mockedUndiciFetch.mockResolvedValue(
        new Response("{}", { status: 200, headers: { "x-ms-workflow-run-id": "run-1" } }),
      );
    });

    it("pins the connection via undici to the resolved address, keeping the real hostname for SNI", async () => {
      const adapter = new PowerAutomateAdapter(config);
      const res = await adapter.send({ to: "x@example.com", subject: "S", html: "<p>h</p>" });

      expect(res.status).toBe("accepted");
      expect(mockedLookup).toHaveBeenCalledTimes(1);
      expect(MockedAgent).toHaveBeenCalledWith({
        connect: {
          servername: "prod-1.westeurope.logic.azure.com",
          lookup: expect.any(Function),
        },
      });
      expect(mockedUndiciFetch).toHaveBeenCalledWith(
        config.url,
        expect.objectContaining({ redirect: "error", dispatcher: expect.any(Object) }),
      );
    });

    it("throws MailDestinationError without calling undici fetch when DNS resolves to a private address (DNS rebinding)", async () => {
      mockedLookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }] as Awaited<
        ReturnType<typeof lookup>
      >);
      const adapter = new PowerAutomateAdapter(config);
      await expect(
        adapter.send({ to: "x@example.com", subject: "S", html: "<p>h</p>" }),
      ).rejects.toMatchObject({
        name: "MailDestinationError",
        code: "mail_destination_blocked",
      });

      expect(mockedUndiciFetch).not.toHaveBeenCalled();
    });

    it("pins to the first resolved record when DNS returns multiple addresses", async () => {
      mockedLookup.mockResolvedValue([
        { address: "93.184.216.34", family: 4 },
        { address: "203.0.113.9", family: 4 },
      ] as Awaited<ReturnType<typeof lookup>>);
      const adapter = new PowerAutomateAdapter(config);
      await adapter.send({ to: "x@example.com", subject: "S", html: "<p>h</p>" });

      const lookupHook = MockedAgent.mock.calls[0]![0]!.connect!.lookup!;
      const addresses: { address: string; family: number }[] = [];
      lookupHook(
        "prod-1.westeurope.logic.azure.com",
        { all: true } as never,
        ((_err: null, result: typeof addresses) => addresses.push(...result)) as never,
      );
      expect(addresses).toEqual([{ address: "93.184.216.34", family: 4 }]);
    });
  });

  it("close() resolves (no persistent connection to release)", async () => {
    const adapter = new PowerAutomateAdapter(config);
    await expect(adapter.close()).resolves.toBeUndefined();
  });
});
