import { describe, expect, it, vi } from "vitest";
import { GraphAdapter } from "../src/adapters/graph.js";
import type { GraphConfig } from "../src/config.js";

const config: GraphConfig = {
  provider: "graph",
  tenantId: "00000000-0000-0000-0000-000000000000",
  clientId: "client-123",
  clientSecret: "secret-xyz",
  sender: "events@example.com",
  saveToSentItems: true,
};

function tokenResponse() {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ access_token: "tok-abc", expires_in: 3600 }),
    headers: { get: () => null },
  };
}

function acceptedResponse(requestId = "req-1") {
  return {
    ok: true,
    status: 202,
    text: async () => "",
    headers: { get: (h: string) => (h.toLowerCase() === "request-id" ? requestId : null) },
  };
}

describe("GraphAdapter", () => {
  it("fetches token and sends (202 => sent), maps payload correctly", async () => {
    const calls: { url: string; init: any }[] = [];
    const fetchFn = vi.fn(async (url: string, init: any) => {
      calls.push({ url, init });
      return url.includes("/oauth2/v2.0/token") ? tokenResponse() : acceptedResponse("req-42");
    });

    const adapter = new GraphAdapter(config, fetchFn as unknown as typeof fetch);
    const res = await adapter.send({
      to: "jan@example.com",
      cc: "audit@example.com, ops@example.com",
      replyTo: "events@example.com",
      subject: "Ticket",
      html: "<p>hello</p>",
      idempotencyKey: "att-1",
    });

    expect(res.status).toBe("sent");
    expect(res.provider).toBe("graph");
    expect(res.providerMessageId).toBe("req-42");
    expect(res.idempotencyKey).toBe("att-1");

    const sendCall = calls.find((c) => c.url.includes("/sendMail"))!;
    expect(sendCall.url).toBe(
      "https://graph.microsoft.com/v1.0/users/events%40example.com/sendMail",
    );
    expect(sendCall.init.headers.authorization).toBe("Bearer tok-abc");
    const body = JSON.parse(sendCall.init.body);
    expect(body.saveToSentItems).toBe(true);
    expect(body.message.subject).toBe("Ticket");
    expect(body.message.body).toEqual({ contentType: "HTML", content: "<p>hello</p>" });
    expect(body.message.toRecipients).toEqual([{ emailAddress: { address: "jan@example.com" } }]);
    expect(body.message.ccRecipients).toEqual([
      { emailAddress: { address: "audit@example.com" } },
      { emailAddress: { address: "ops@example.com" } },
    ]);
    expect(body.message.replyTo).toEqual([{ emailAddress: { address: "events@example.com" } }]);
  });

  it("caches token across sends (token endpoint called once)", async () => {
    const fetchFn = vi.fn(async (url: string) =>
      url.includes("/oauth2/v2.0/token") ? tokenResponse() : acceptedResponse(),
    );
    const adapter = new GraphAdapter(config, fetchFn as unknown as typeof fetch);
    await adapter.send({ to: "a@example.com", subject: "x", html: "<p>x</p>" });
    await adapter.send({ to: "b@example.com", subject: "y", html: "<p>y</p>" });

    const tokenCalls = fetchFn.mock.calls.filter((c) => String(c[0]).includes("/oauth2/v2.0/token"));
    expect(tokenCalls.length).toBe(1);
  });

  it("returns failed (no throw) when sendMail returns 403", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("/oauth2/v2.0/token")) return tokenResponse();
      return {
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ error: { code: "ErrorAccessDenied", message: "no send-as permission" } }),
        headers: { get: () => null },
      };
    });
    const adapter = new GraphAdapter(config, fetchFn as unknown as typeof fetch);
    const res = await adapter.send({ to: "a@example.com", subject: "x", html: "<p>x</p>" });
    expect(res.status).toBe("failed");
    expect(res.error).toContain("ErrorAccessDenied");
  });

  it("returns failed when token fetch fails", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: "invalid_client", error_description: "AADSTS7000215: bad secret" }),
      headers: { get: () => null },
    }));
    const adapter = new GraphAdapter(config, fetchFn as unknown as typeof fetch);
    const res = await adapter.send({ to: "a@example.com", subject: "x", html: "<p>x</p>" });
    expect(res.status).toBe("failed");
    expect(res.error).toContain("invalid_client");
  });

  it("returns failed with raw body when token endpoint returns non-JSON error", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => "Service Unavailable",
      headers: { get: () => null },
    }));
    const adapter = new GraphAdapter(config, fetchFn as unknown as typeof fetch);
    const res = await adapter.send({ to: "a@example.com", subject: "x", html: "<p>x</p>" });
    expect(res.status).toBe("failed");
    expect(res.error).toContain("HTTP 503");
    expect(res.error).toContain("Service Unavailable");
  });

  it("returns failed with raw body when sendMail returns non-JSON error body", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("/oauth2/v2.0/token")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ access_token: "tok-abc", expires_in: 3600 }),
          headers: { get: () => null },
        };
      }
      return {
        ok: false,
        status: 429,
        text: async () => "Too Many Requests",
        headers: { get: () => null },
      };
    });
    const adapter = new GraphAdapter(config, fetchFn as unknown as typeof fetch);
    const res = await adapter.send({ to: "a@example.com", subject: "x", html: "<p>x</p>" });
    expect(res.status).toBe("failed");
    expect(res.error).toContain("HTTP 429");
    expect(res.error).toContain("Too Many Requests");
  });
});
