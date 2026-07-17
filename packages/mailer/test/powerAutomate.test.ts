import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import { PowerAutomateAdapter } from "../src/adapters/powerAutomate.js";
import type { PowerAutomateConfig } from "../src/config.js";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

const mockedLookup = vi.mocked(lookup);

beforeEach(() => {
  mockedLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as Awaited<
    ReturnType<typeof lookup>
  >);
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

  it("rejects a private/loopback destination without ever calling fetchFn (SSRF guard)", async () => {
    const fetchFn = vi.fn();
    const adapter = new PowerAutomateAdapter(
      { ...config, url: "https://127.0.0.1:9999/internal-webhook" },
      fetchFn as unknown as typeof fetch,
    );
    const res = await adapter.send({ to: "x@example.com", subject: "S", html: "<p>h</p>" });
    expect(res.status).toBe("rejected");
    expect(res.retryable).toBe(false);
    expect(res.error).toMatch(/private, loopback, or link-local/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects a hostname that resolves to a private address at send-time (DNS rebinding)", async () => {
    mockedLookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }] as Awaited<
      ReturnType<typeof lookup>
    >);
    const fetchFn = vi.fn();
    const adapter = new PowerAutomateAdapter(config, fetchFn as unknown as typeof fetch);
    const res = await adapter.send({ to: "x@example.com", subject: "S", html: "<p>h</p>" });
    expect(res.status).toBe("rejected");
    expect(fetchFn).not.toHaveBeenCalled();
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
});
