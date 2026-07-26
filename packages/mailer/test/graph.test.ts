import { beforeEach, describe, expect, it, vi } from "vitest";
import { GraphAdapter } from "../src/adapters/graph.js";
import type { GraphConfig } from "../src/config.js";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { resetMailSentThrottleForTest } from "../src/adapterUtils.js";

beforeEach(() => {
  resetSystemLogBufferForTest();
  resetMailSentThrottleForTest();
});

const config: GraphConfig = {
  provider: "graph",
  mailbox: "events@example.com",
  tenantId: "00000000-0000-0000-0000-000000000000",
  clientId: "client-123",
  clientSecret: "secret-xyz",
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
  it("fetches token and sends (202 => accepted), maps payload correctly", async () => {
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

    expect(res.status).toBe("accepted");
    expect(res.provider).toBe("graph");
    expect(res.providerMessageId).toBe("req-42");
    expect(res.idempotencyKey).toBe("att-1");
    expect(adapter.capabilities.supportsSentItems).toBe(true);
    expect(adapter.capabilities.deliveryResultSemantics).toBe("accepted_only");

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
    expect(body.message.from).toBeUndefined();

    const logs = querySystemLogs({ source: "mail" });
    expect(
      logs.some(
        (entry) =>
          entry.message === "mail_sent" && entry.fields?.provider === "graph" && entry.fields?.to === "j***@example.com",
      ),
    ).toBe(true);
  });

  it("parses RFC5322 cc with quoted commas into Graph recipients", async () => {
    const calls: { url: string; init: any }[] = [];
    const fetchFn = vi.fn(async (url: string, init: any) => {
      calls.push({ url, init });
      return url.includes("/oauth2/v2.0/token") ? tokenResponse() : acceptedResponse();
    });

    const adapter = new GraphAdapter(config, fetchFn as unknown as typeof fetch);
    await adapter.send({
      to: "jan@example.com",
      cc: '"Audit, Team" <audit@example.com>, ops@example.com',
      subject: "x",
      html: "<p>x</p>",
    });

    const body = JSON.parse(calls.find((c) => c.url.includes("/sendMail"))!.init.body);
    expect(body.message.ccRecipients).toEqual([
      { emailAddress: { address: "audit@example.com" } },
      { emailAddress: { address: "ops@example.com" } },
    ]);
  });

  it("sets message.from when fromName is configured", async () => {
    const calls: { url: string; init: any }[] = [];
    const fetchFn = vi.fn(async (url: string, init: any) => {
      calls.push({ url, init });
      return url.includes("/oauth2/v2.0/token") ? tokenResponse() : acceptedResponse();
    });

    const adapter = new GraphAdapter(
      { ...config, fromName: "Admitto Events" },
      fetchFn as unknown as typeof fetch,
    );
    await adapter.send({ to: "a@example.com", subject: "x", html: "<p>x</p>" });

    const body = JSON.parse(calls.find((c) => c.url.includes("/sendMail"))!.init.body);
    expect(body.message.from).toEqual({
      emailAddress: { address: "events@example.com", name: "Admitto Events" },
    });
  });

  it("sets message.from when fromAddress differs from mailbox (send-as)", async () => {
    const calls: { url: string; init: any }[] = [];
    const fetchFn = vi.fn(async (url: string, init: any) => {
      calls.push({ url, init });
      return url.includes("/oauth2/v2.0/token") ? tokenResponse() : acceptedResponse();
    });

    const adapter = new GraphAdapter(
      { ...config, fromAddress: "other@example.com" },
      fetchFn as unknown as typeof fetch,
    );
    await adapter.send({ to: "a@example.com", subject: "x", html: "<p>x</p>" });

    const body = JSON.parse(calls.find((c) => c.url.includes("/sendMail"))!.init.body);
    expect(body.message.from).toEqual({ emailAddress: { address: "other@example.com" } });
    expect(calls.find((c) => c.url.includes("/sendMail"))!.url).toContain("events%40example.com");
  });

  it("caches token across sends (token endpoint called once)", async () => {
    const fetchFn = vi.fn(async (url: string) =>
      url.includes("/oauth2/v2.0/token") ? tokenResponse() : acceptedResponse(),
    );
    const adapter = new GraphAdapter(config, fetchFn as unknown as typeof fetch);
    await adapter.send({ to: "a@example.com", subject: "x", html: "<p>x</p>" });
    await adapter.send({ to: "b@example.com", subject: "y", html: "<p>y</p>" });

    const tokenCalls = fetchFn.mock.calls.filter((c) => String(c[0]).includes("/oauth2/v2.0/token"));
    expect(tokenCalls).toHaveLength(1);
  });

  it("returns rejected (no throw) when sendMail returns 403", async () => {
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
    expect(res.status).toBe("rejected");
    expect(res.retryable).toBe(false);
    expect(res.error).toContain("ErrorAccessDenied");

    const logs = querySystemLogs({ source: "mail" });
    expect(
      logs.some(
        (entry) =>
          entry.message === "mail_send_failed" &&
          entry.level === "error" &&
          typeof entry.fields?.error === "string" &&
          (entry.fields.error as string).includes("ErrorAccessDenied"),
      ),
    ).toBe(true);
  });

  it("returns rejected when token fetch fails with 401", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: "invalid_client", error_description: "AADSTS7000215: bad secret" }),
      headers: { get: () => null },
    }));
    const adapter = new GraphAdapter(config, fetchFn as unknown as typeof fetch);
    const res = await adapter.send({ to: "a@example.com", subject: "x", html: "<p>x</p>" });
    expect(res.status).toBe("rejected");
    expect(res.retryable).toBe(false);
    expect(res.error).toContain("invalid_client");
  });

  it("uses a safe HTTP fallback when token-error fields are not strings", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { code: "invalid_client" }, error_description: ["bad secret"] }),
      headers: { get: () => null },
    }));
    const adapter = new GraphAdapter(config, fetchFn as unknown as typeof fetch);

    const res = await adapter.send({ to: "a@example.com", subject: "x", html: "<p>x</p>" });

    expect(res.status).toBe("rejected");
    expect(res.retryable).toBe(false);
    expect(res.error).toContain("Graph token error: HTTP 401");
    expect(res.error).not.toContain("[object Object]");
  });

  it("returns failed+retryable when token fetch throws (network)", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("/oauth2/v2.0/token")) throw new Error("ENOTFOUND");
      return acceptedResponse();
    });
    const adapter = new GraphAdapter(config, fetchFn as unknown as typeof fetch);
    const res = await adapter.send({ to: "a@example.com", subject: "x", html: "<p>x</p>" });
    expect(res.status).toBe("failed");
    expect(res.retryable).toBe(true);
    expect(res.error).toContain("ENOTFOUND");
  });

  it("returns failed+retryable when token endpoint returns 503", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => "Service Unavailable",
      headers: { get: () => null },
    }));
    const adapter = new GraphAdapter(config, fetchFn as unknown as typeof fetch);
    const res = await adapter.send({ to: "a@example.com", subject: "x", html: "<p>x</p>" });
    expect(res.status).toBe("failed");
    expect(res.retryable).toBe(true);
    expect(res.error).toContain("HTTP 503");
  });

  it("returns failed+retryable when sendMail returns 429", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("/oauth2/v2.0/token")) return tokenResponse();
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
    expect(res.retryable).toBe(true);
    expect(res.error).toContain("HTTP 429");
  });

  it("returns failed+retryable when the sendMail request throws after token acquisition", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("/oauth2/v2.0/token")) return tokenResponse();
      throw new Error("ECONNRESET while sending");
    });
    const adapter = new GraphAdapter(config, fetchFn as unknown as typeof fetch);

    const res = await adapter.send({ to: "a@example.com", subject: "x", html: "<p>x</p>" });

    expect(res).toMatchObject({
      status: "failed",
      retryable: true,
      error: "ECONNRESET while sending",
    });
  });

  it("returns a terminal failure when a successful token response omits access_token", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "{}",
      headers: { get: () => null },
    }));
    const adapter = new GraphAdapter(config, fetchFn as unknown as typeof fetch);

    const res = await adapter.send({ to: "a@example.com", subject: "x", html: "<p>x</p>" });

    expect(res).toMatchObject({
      status: "failed",
      error: "Graph token error: missing access_token in response",
    });
    expect(res.retryable).toBeUndefined();
  });

  it("maps a non-JSON Graph error body without losing its HTTP semantics", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("/oauth2/v2.0/token")) return tokenResponse();
      return {
        ok: false,
        status: 400,
        text: async () => "Malformed Graph request",
        headers: { get: () => null },
      };
    });
    const adapter = new GraphAdapter(config, fetchFn as unknown as typeof fetch);

    const res = await adapter.send({ to: "a@example.com", subject: "x", html: "<p>x</p>" });

    expect(res).toMatchObject({
      status: "rejected",
      retryable: false,
      error: "Graph sendMail: HTTP 400 — Malformed Graph request",
    });
  });
});
