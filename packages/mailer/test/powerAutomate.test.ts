import { describe, expect, it, vi } from "vitest";
import { PowerAutomateAdapter } from "../src/adapters/powerAutomate.js";
import type { PowerAutomateConfig } from "../src/config.js";

const config: PowerAutomateConfig = {
  provider: "powerautomate",
  url: "https://prod-1.westeurope.logic.azure.com/workflows/x/triggers/manual/paths/invoke?sig=secret",
  key: "test-secret-key",
};

describe("PowerAutomateAdapter", () => {
  it("POSTs JSON {to,subject,html} with x-admitto-key header and maps 2xx => sent", async () => {
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

    expect(res.status).toBe("sent");
    expect(res.providerMessageId).toBe("run-9");
    expect(res.idempotencyKey).toBe("k1");
    expect(captured.headers["x-admitto-key"]).toBe("test-secret-key");
    expect(JSON.parse(captured.body)).toMatchObject({ to: "x@example.com", subject: "S", html: "<p>h</p>" });
  });

  it("omits key header when key is not configured", async () => {
    let captured: any;
    const fetchFn = vi.fn(async (_url: string, init: any) => {
      captured = init;
      return { ok: true, status: 202, text: async () => "", headers: { get: () => null } };
    });
    const adapter = new PowerAutomateAdapter(
      { provider: "powerautomate", url: config.url },
      fetchFn as unknown as typeof fetch,
    );
    await adapter.send({ to: "x@example.com", subject: "S", html: "<p>h</p>" });
    expect(captured.headers["x-admitto-key"]).toBeUndefined();
  });

  it("maps HTTP error to failed", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
      headers: { get: () => null },
    }));
    const adapter = new PowerAutomateAdapter(config, fetchFn as unknown as typeof fetch);
    const res = await adapter.send({ to: "x@example.com", subject: "S", html: "<p>h</p>" });
    expect(res.status).toBe("failed");
    expect(res.error).toContain("401");
  });

  it("catches network exception => failed", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const adapter = new PowerAutomateAdapter(config, fetchFn as unknown as typeof fetch);
    const res = await adapter.send({ to: "x@example.com", subject: "S", html: "<p>h</p>" });
    expect(res.status).toBe("failed");
    expect(res.error).toContain("ECONNREFUSED");
  });
});
