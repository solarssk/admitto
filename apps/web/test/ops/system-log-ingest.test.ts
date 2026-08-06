import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  currentSystemLogCursor,
  querySystemLogs,
  resetSystemLogBufferForTest,
} from "@admitto/shared/system-log";
import { handleOpsSystemLogIngest } from "../../src/ops/system-log-ingest.js";

const TOKEN = "a".repeat(32);

function appWithToken(token: string | null) {
  const app = new Hono();
  app.post("/api/ops/system-logs", (c) => handleOpsSystemLogIngest(c, { opsHealthToken: token }));
  return app;
}

afterEach(() => {
  resetSystemLogBufferForTest();
});

describe("handleOpsSystemLogIngest", () => {
  it("returns 404 when OPS_HEALTH_TOKEN is unset", async () => {
    const app = appWithToken(null);
    const res = await app.request("/api/ops/system-logs", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ source: "mail", level: "info", message: "mail_bounce_ingest_ok" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 401 for a bad token", async () => {
    const app = appWithToken(TOKEN);
    const res = await app.request("/api/ops/system-logs", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer wrong-token-wrong-token-xx" },
      body: JSON.stringify({ source: "mail", level: "info", message: "mail_bounce_ingest_ok" }),
    });
    expect(res.status).toBe(401);
  });

  it("records a sanitized mail entry into the system log buffer", async () => {
    const before = currentSystemLogCursor();
    const app = appWithToken(TOKEN);
    const res = await app.request("/api/ops/system-logs", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        source: "mail",
        level: "error",
        message: "mail_bounce_ingest_failed",
        fields: {
          event_id: "evt_1",
          errors: 1,
          password: "should-drop",
          imap_password: "should-drop",
        },
      }),
    });
    expect(res.status).toBe(200);
    const entries = querySystemLogs({ sinceId: before, source: "mail" });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.message).toBe("mail_bounce_ingest_failed");
    expect(entries[0]!.fields).toEqual({ event_id: "evt_1", errors: 1 });
  });

  it("drops credential-bearing field names from the buffer", async () => {
    const before = currentSystemLogCursor();
    const app = appWithToken(TOKEN);
    const res = await app.request("/api/ops/system-logs", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        source: "mail",
        level: "info",
        message: "mail_bounce_ingest_ok",
        fields: {
          event_id: "evt_1",
          access_token: "drop-me",
          refresh_token: "drop-me",
          auth_header: "Bearer x",
          cookie: "session=1",
          oauth_token_cache: "drop-substring",
          messagesSeen: 2,
        },
      }),
    });
    expect(res.status).toBe(200);
    const entries = querySystemLogs({ sinceId: before, source: "mail" });
    expect(entries[0]!.fields).toEqual({ event_id: "evt_1", messagesSeen: 2 });
  });

  it("truncates long string fields and rejects invalid JSON", async () => {
    const before = currentSystemLogCursor();
    const app = appWithToken(TOKEN);
    const long = "x".repeat(520);
    const ok = await app.request("/api/ops/system-logs", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        source: "mail",
        level: "info",
        message: "mail_bounce_ingest_ok",
        fields: { note: long, nested: { a: 1 }, ok: true },
      }),
    });
    expect(ok.status).toBe(200);
    const entries = querySystemLogs({ sinceId: before, source: "mail" });
    expect(entries[0]!.fields).toEqual({ note: `${"x".repeat(500)}…`, ok: true });

    const bad = await app.request("/api/ops/system-logs", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: "{not-json",
    });
    expect(bad.status).toBe(400);
  });

  it("rejects an invalid body", async () => {
    const app = appWithToken(TOKEN);
    const res = await app.request("/api/ops/system-logs", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ source: "mail", level: "info", message: "" }),
    });
    expect(res.status).toBe(400);
  });
});
