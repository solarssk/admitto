import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PassCreatorClient, WalletProviderError } from "../src/index.js";
import { PASSCREATOR_DEFAULT_BASE_URL } from "../src/passcreator-config.js";
import type { WalletPassInput } from "../src/index.js";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";

const CONFIG = { apiKey: "test-key", templateId: "tmpl-1", baseUrl: "https://pc.test" };

const INPUT: WalletPassInput = {
  attendeeName: "Jane Doe",
  eventDateLabel: "12 August 2026",
  eventDateShortLabel: "12 Aug 2026",
  eventHoursLabel: "18:00-22:00",
  eventLocationLabel: "Test Venue",
  ticketTypeLabel: "General",
  userProvidedId: "admitto:event1:attendee1",
  barcodeValue: "https://tickets.example.com/t/tok-jane",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("PassCreatorClient.createPass", () => {
  it("sends templateId/userProvidedId/enforceUniqueUserProvidedId inside data, no Bearer prefix", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(url).toBe("https://pc.test/api/v3/pass?async=false");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>).Authorization).toBe("test-key");
      const body = JSON.parse(init?.body as string);
      expect(body.data).toMatchObject({
        templateId: "tmpl-1",
        userProvidedId: "admitto:event1:attendee1",
        enforceUniqueUserProvidedId: true,
        barcodeValue: "https://tickets.example.com/t/tok-jane",
      });
      return jsonResponse(200, {
        success: true,
        data: {
          identifier: "pass-1",
          downloadPage: "https://pc.test/p/pass-1",
          iPhoneUri: "https://pc.test/passinstance/pkpass/pass-1",
          androidUri: "https://pc.test/passinstance/googlewallet/pass-1",
        },
      });
    });

    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    const result = await client.createPass(INPUT);

    expect(result).toEqual({
      providerPassId: "pass-1",
      downloadUrl: "https://pc.test/p/pass-1",
      appleUrl: "https://pc.test/passinstance/pkpass/pass-1",
      androidUrl: "https://pc.test/passinstance/googlewallet/pass-1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws WalletProviderError with a stable code on 401", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(401, { success: false, errors: ["Invalid API key"] }),
    );
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);

    await expect(client.createPass(INPUT)).rejects.toMatchObject({
      code: "wallet_provider_unauthorized",
    });
  });

  it("maps a duplicate userProvidedId error to wallet_provider_duplicate", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(400, { success: false, errors: ["userProvidedId already exists"] }),
    );
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);

    await expect(client.createPass(INPUT)).rejects.toMatchObject({
      code: "wallet_provider_duplicate",
    });
  });

  it("retries on 429 with backoff, then succeeds", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls++;
      if (calls < 3) return jsonResponse(429, { success: false, errors: ["Rate limited"] });
      return jsonResponse(200, {
        success: true,
        data: { identifier: "pass-2", iPhoneUri: "a", androidUri: "b" },
      });
    });
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);

    const result = await client.createPass(INPUT);

    expect(result.providerPassId).toBe("pass-2");
    expect(calls).toBe(3);
  });

  it("throws wallet_provider_rate_limited after exhausting retries", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(429, { success: false, errors: ["Rate limited"] }),
    );
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);

    await expect(client.createPass(INPUT)).rejects.toMatchObject({
      code: "wallet_provider_rate_limited",
    });
    expect(fetchMock).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it("maps a non-JSON error body (e.g. an upstream HTML 502 page) by HTTP status", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("<html><body>Bad Gateway</body></html>", {
          status: 502,
          headers: { "Content-Type": "text/html" },
        }),
    );
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);

    await expect(client.createPass(INPUT)).rejects.toMatchObject({
      code: "wallet_provider_rejected",
    });
  });

  it("wraps network failures as wallet_provider_timeout", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);

    await expect(client.createPass(INPUT)).rejects.toMatchObject({
      code: "wallet_provider_timeout",
    });
  });

  it("wraps a non-Error network failure (e.g. a thrown string) as wallet_provider_timeout", async () => {
    const fetchMock = vi.fn(async () => {
      throw "connection reset";
    });
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);

    await expect(client.createPass(INPUT)).rejects.toMatchObject({
      code: "wallet_provider_timeout",
      message: expect.stringContaining("connection reset"),
    });
  });
});

describe("PassCreatorClient.describeTemplate", () => {
  it("GETs the v2 template-describe endpoint and returns the template name", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(url).toBe("https://pc.test/api/v2/pass-template/tmpl-1/describe");
      expect(init?.method).toBe("GET");
      return jsonResponse(200, { success: true, data: { name: "Cybersecurity Awareness" } });
    });
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await expect(client.describeTemplate()).resolves.toEqual({ name: "Cybersecurity Awareness" });
  });

  it("returns a null name when the response omits it", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { success: true, data: {} }));
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await expect(client.describeTemplate()).resolves.toEqual({ name: null });
  });

  it("throws wallet_provider_unauthorized on a bad key", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(401, { success: false, errors: ["Invalid API key"] }),
    );
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await expect(client.describeTemplate()).rejects.toMatchObject({
      code: "wallet_provider_unauthorized",
    });
  });
});

describe("PassCreatorClient.getWebhookPublicKey", () => {
  it("GETs the public-key endpoint and parses the confirmed live {publicKey} shape (2026-08-19)", async () => {
    const pem = "-----BEGIN PUBLIC KEY-----\nMFkw...\n-----END PUBLIC KEY-----\n";
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(url).toBe("https://pc.test/api/hook/publickey");
      expect(init?.method).toBe("GET");
      return jsonResponse(200, { publicKey: pem });
    });
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await expect(client.getWebhookPublicKey()).resolves.toBe(pem.trim());
  });

  it("throws when the response doesn't contain a recognizable PEM key", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { publicKey: "not a pem" }));
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await expect(client.getWebhookPublicKey()).rejects.toBeInstanceOf(WalletProviderError);
  });
});

describe("PassCreatorClient.subscribeWebhook", () => {
  it("POSTs to /api/hook/subscribe/:templateId with the event, signPayload, and retryEnabled", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(url).toBe("https://pc.test/api/hook/subscribe/tmpl-1");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(init?.body as string)).toEqual({
        target_url: "https://admitto.example.com/api/webhooks/passcreator",
        event: "pushnotification_registered",
        signPayload: true,
        retryEnabled: true,
      });
      return jsonResponse(201, { success: true, data: {} });
    });
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await expect(
      client.subscribeWebhook("https://admitto.example.com/api/webhooks/passcreator", "pushnotification_registered"),
    ).resolves.toBeUndefined();
  });

  it("succeeds on a 201 whose body doesn't match the v3 {success,data} envelope (live-observed 2026-08-13)", async () => {
    const fetchMock = vi.fn(async (_input: string | URL) => jsonResponse(201, { id: "hook-1" }));
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await expect(
      client.subscribeWebhook("https://admitto.example.com/api/webhooks/passcreator", "pass_voided"),
    ).resolves.toBeUndefined();
  });

  it("throws on a non-2xx status", async () => {
    const fetchMock = vi.fn(async (_input: string | URL) => jsonResponse(401, { success: false }));
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await expect(
      client.subscribeWebhook("https://admitto.example.com/api/webhooks/passcreator", "pass_voided"),
    ).rejects.toBeInstanceOf(WalletProviderError);
  });

  it("throws on a 2xx status whose body explicitly reports success: false (CodeRabbit review)", async () => {
    const fetchMock = vi.fn(async (_input: string | URL) =>
      jsonResponse(200, { success: false, errors: ["event already subscribed"] }),
    );
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await expect(
      client.subscribeWebhook("https://admitto.example.com/api/webhooks/passcreator", "pass_voided"),
    ).rejects.toBeInstanceOf(WalletProviderError);
  });
});

describe("PassCreatorClient.unsubscribeWebhook", () => {
  it("POSTs to /api/hook/unsubscribe with just target_url, no templateId or event", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(url).toBe("https://pc.test/api/hook/unsubscribe");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(init?.body as string)).toEqual({
        target_url: "https://admitto.example.com/api/wallet/webhook/passcreator/evt-1/voided",
      });
      return jsonResponse(200, { success: true });
    });
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await expect(
      client.unsubscribeWebhook("https://admitto.example.com/api/wallet/webhook/passcreator/evt-1/voided"),
    ).resolves.toBeUndefined();
  });

  it("throws on a non-2xx status", async () => {
    const fetchMock = vi.fn(async (_input: string | URL) => jsonResponse(404, { success: false }));
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await expect(client.unsubscribeWebhook("https://admitto.example.com/hook")).rejects.toBeInstanceOf(
      WalletProviderError,
    );
  });

  it("throws on a 2xx status whose body explicitly reports success: false", async () => {
    const fetchMock = vi.fn(async (_input: string | URL) =>
      jsonResponse(200, { success: false, errors: ["no such subscription"] }),
    );
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await expect(client.unsubscribeWebhook("https://admitto.example.com/hook")).rejects.toBeInstanceOf(
      WalletProviderError,
    );
  });
});

describe("PassCreatorClient.listWebhooks", () => {
  it("parses a bare array response (live-observed shape, 2026-08-13)", async () => {
    const fetchMock = vi.fn(async (_input: string | URL) =>
      jsonResponse(200, [
        { target_url: "https://admitto.example.com/hook", event: "pass_voided", pass_template: "tmpl-1" },
      ]),
    );
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await expect(client.listWebhooks()).resolves.toEqual([
      { targetUrl: "https://admitto.example.com/hook", event: "pass_voided", passTemplate: "tmpl-1" },
    ]);
  });

  it("parses a v3-style {data: [...]} wrapper", async () => {
    const fetchMock = vi.fn(async (_input: string | URL) =>
      jsonResponse(200, { success: true, data: [{ target_url: "https://a.test/hook", event: "pass_voided" }] }),
    );
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await expect(client.listWebhooks()).resolves.toEqual([
      { targetUrl: "https://a.test/hook", event: "pass_voided", passTemplate: null },
    ]);
  });

  it("returns an empty list for an unrecognized-but-successful body instead of throwing", async () => {
    const fetchMock = vi.fn(async (_input: string | URL) => jsonResponse(200, { ok: true }));
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await expect(client.listWebhooks()).resolves.toEqual([]);
  });

  it("still throws when the body explicitly reports success: false", async () => {
    const fetchMock = vi.fn(async (_input: string | URL) => jsonResponse(200, { success: false, errors: ["nope"] }));
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await expect(client.listWebhooks()).rejects.toBeInstanceOf(WalletProviderError);
  });

  it("throws on a non-2xx status", async () => {
    const fetchMock = vi.fn(async (_input: string | URL) => jsonResponse(500, {}));
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await expect(client.listWebhooks()).rejects.toBeInstanceOf(WalletProviderError);
  });

  it("throws a WalletProviderError instead of crashing when success: false carries a non-array errors field (CodeRabbit review)", async () => {
    const fetchMock = vi.fn(async (_input: string | URL) => jsonResponse(200, { success: false, errors: "nope" }));
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await expect(client.listWebhooks()).rejects.toBeInstanceOf(WalletProviderError);
  });

  it("skips a null row and defaults non-string fields instead of crashing (CodeRabbit review)", async () => {
    const fetchMock = vi.fn(async (_input: string | URL) =>
      jsonResponse(200, [null, { target_url: 42, event: "pass_voided", pass_template: null }]),
    );
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await expect(client.listWebhooks()).resolves.toEqual([
      { targetUrl: null, event: "pass_voided", passTemplate: null },
    ]);
  });
});

describe("PassCreatorClient fieldMapping", () => {
  it("passes the configured field mapping through to createPass's data payload", async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      expect(body.data).toMatchObject({ attendeeFullName: "Jane Doe" });
      expect(body.data).not.toHaveProperty("name");
      return jsonResponse(200, {
        success: true,
        data: { identifier: "pass-1", iPhoneUri: "a", androidUri: "b" },
      });
    });
    const client = new PassCreatorClient(
      { ...CONFIG, fieldMapping: { attendeeFullName: "full_name" } },
      fetchMock as unknown as typeof fetch,
    );
    await client.createPass(INPUT);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("PassCreatorClient config", () => {
  it("defaults baseUrl to the live PassCreator host when not configured", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(String(url).startsWith(PASSCREATOR_DEFAULT_BASE_URL)).toBe(true);
      return jsonResponse(200, {
        success: true,
        data: { identifier: "pass-1", iPhoneUri: "a", androidUri: "b" },
      });
    });
    const client = new PassCreatorClient(
      { apiKey: "test-key", templateId: "tmpl-1" },
      fetchMock as unknown as typeof fetch,
    );
    await client.createPass(INPUT);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("rejects a non-HTTPS baseUrl override at construction, before any request is sent", () => {
    expect(
      () => new PassCreatorClient({ apiKey: "test-key", templateId: "tmpl-1", baseUrl: "http://pc.test" }),
    ).toThrow(/HTTPS/);
  });
});

describe("PassCreatorClient.updatePass", () => {
  it("PATCHes the pass identifier with mapped data", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(url).toBe("https://pc.test/api/v3/pass/pass-1");
      expect(init?.method).toBe("PATCH");
      return jsonResponse(200, {
        success: true,
        data: { identifier: "pass-1", iPhoneUri: "a", androidUri: "b" },
      });
    });
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    const result = await client.updatePass("pass-1", INPUT);
    expect(result.providerPassId).toBe("pass-1");
  });

  it("sends enforceUniqueUserProvidedId: false, not true (live 2026-08-13: PassCreator rejects an update with 400 'not unique' when this is true, since the id is always already owned by the pass being updated)", async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      expect(body.data.enforceUniqueUserProvidedId).toBe(false);
      return jsonResponse(200, {
        success: true,
        data: { identifier: "pass-1", iPhoneUri: "a", androidUri: "b" },
      });
    });
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await client.updatePass("pass-1", INPUT);
  });
});

describe("PassCreatorClient.sendPushMessage", () => {
  it("PATCHes the v3 bulk endpoint with pushNotificationText and an identifiers filter", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(url).toBe("https://pc.test/api/v3/pass/bulk");
      expect(init?.method).toBe("PATCH");
      expect(JSON.parse(init?.body as string)).toEqual({
        data: { pushNotificationText: "Welcome to the event!" },
        filter: { identifiers: ["pass-1", "pass-2"] },
      });
      return jsonResponse(202, {
        success: true,
        data: { process: "https://pc.test/api/v3/process/xyz" },
      });
    });
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await expect(
      client.sendPushMessage(["pass-1", "pass-2"], "Welcome to the event!"),
    ).resolves.toBeUndefined();
  });

  it("uses the same bulk endpoint for a single recipient (never the deprecated v1 single-pass endpoint)", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(url).toBe("https://pc.test/api/v3/pass/bulk");
      expect(JSON.parse(init?.body as string).filter).toEqual({ identifiers: ["pass-1"] });
      return jsonResponse(202, {
        success: true,
        data: { process: "https://pc.test/api/v3/process/xyz" },
      });
    });
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await expect(client.sendPushMessage(["pass-1"], "Hi!")).resolves.toBeUndefined();
  });

  it("throws WalletProviderError on failure, same as other v3 endpoints", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(401, { success: false, errors: ["Invalid API key"] }),
    );
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await expect(client.sendPushMessage(["pass-1"], "Hi!")).rejects.toMatchObject({
      code: "wallet_provider_unauthorized",
    });
  });
});

describe("PassCreatorClient void/restore", () => {
  it("voidPass PUTs {voided: true} to the non-v3 endpoint", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(url).toBe("https://pc.test/api/pass/pass-1");
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(init?.body as string)).toEqual({ voided: true });
      return new Response(null, { status: 204 });
    });
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await expect(client.voidPass("pass-1")).resolves.toBeUndefined();
  });

  it("restorePass PUTs {voided: false}", async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(JSON.parse(init?.body as string)).toEqual({ voided: false });
      return new Response(null, { status: 204 });
    });
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await expect(client.restorePass("pass-1")).resolves.toBeUndefined();
  });

  it("throws on a failed void", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await expect(client.voidPass("missing")).rejects.toBeInstanceOf(WalletProviderError);
  });
});

describe("PassCreatorClient.deletePass", () => {
  it("DELETEs the v3 pass endpoint", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(url).toBe("https://pc.test/api/v3/pass/pass-1");
      expect(init?.method).toBe("DELETE");
      return new Response(null, { status: 204 });
    });
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await expect(client.deletePass("pass-1")).resolves.toBeUndefined();
  });

  it("treats a 404 (already gone) as success", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await expect(client.deletePass("already-gone")).resolves.toBeUndefined();
  });

  it("throws on other failures (e.g. unauthorized)", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 401 }));
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await expect(client.deletePass("pass-1")).rejects.toMatchObject({
      code: "wallet_provider_unauthorized",
    });
  });
});

describe("PassCreatorClient.findByUserProvidedId", () => {
  it("returns the mapped result when found", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(url).toBe(
        "https://pc.test/api/v3/pass?query=eyJ0ZW1wbGF0ZUlkIjoidG1wbC0xIiwiZ3JvdXBzIjpbW3siZmllbGQiOiJ1c2VyUHJvdmlkZWRJZCIsIm9wZXJhdG9yIjoiZXF1YWxzIiwidHlwZSI6InRleHQiLCJ2YWx1ZSI6WyJhZG1pdHRvOmV2ZW50MTphdHRlbmRlZTEiXX1dXX0",
      );
      return jsonResponse(200, {
        success: true,
        data: [
          {
            identifier: "pass-1",
            userProvidedId: "admitto:event1:attendee1",
            linkToPassPage: "https://pc.test/p/pass-1",
            iPhoneUri: "a",
            androidUri: "b",
          },
        ],
      });
    });
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    const result = await client.findByUserProvidedId("admitto:event1:attendee1");
    expect(result?.providerPassId).toBe("pass-1");
  });

  it("returns null when no match", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { success: true, data: [] }));
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    const result = await client.findByUserProvidedId("admitto:event1:nobody");
    expect(result).toBeNull();
  });

  it("falls back to empty strings when the row has no iPhoneUri/androidUri yet", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        success: true,
        data: [
          {
            identifier: "pass-1",
            userProvidedId: "admitto:event1:attendee1",
            linkToPassPage: "https://pc.test/p/pass-1",
          },
        ],
      }),
    );
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    const result = await client.findByUserProvidedId("admitto:event1:attendee1");
    expect(result).toMatchObject({ appleUrl: "", androidUrl: "" });
  });

  it("returns null and logs when no row in the (unfiltered) response matches the query (PassCreator search doesn't actually filter by userProvidedId, live 2026-08-13)", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        success: true,
        data: [{ identifier: "pass-wrong-attendee", userProvidedId: "admitto:event1:someone-else" }],
      }),
    );
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    const result = await client.findByUserProvidedId("admitto:event1:attendee1");
    expect(result).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("no row matching"));
    consoleErrorSpy.mockRestore();
  });

  it("finds the matching row even when it isn't first in the (unfiltered) response - GET /api/v3/pass?userProvidedId=X returns every pass under the template regardless of X, newest first, not just X's own pass (live 2026-08-13)", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        success: true,
        data: [
          { identifier: "pass-newest", userProvidedId: "admitto:event1:someone-else", linkToPassPage: "https://pc.test/p/newest" },
          { identifier: "pass-1", userProvidedId: "admitto:event1:attendee1", linkToPassPage: "https://pc.test/p/pass-1" },
          { identifier: "pass-oldest", userProvidedId: "admitto:event1:yet-another", linkToPassPage: "https://pc.test/p/oldest" },
        ],
      }),
    );
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    const result = await client.findByUserProvidedId("admitto:event1:attendee1");
    expect(result?.providerPassId).toBe("pass-1");
  });
});

describe("PassCreatorClient.getRegistrationStatus", () => {
  it("maps the search row's registration counts and firstDownloadedAt", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(url).toBe(
        "https://pc.test/api/v3/pass?query=eyJ0ZW1wbGF0ZUlkIjoidG1wbC0xIiwiZ3JvdXBzIjpbW3siZmllbGQiOiJ1c2VyUHJvdmlkZWRJZCIsIm9wZXJhdG9yIjoiZXF1YWxzIiwidHlwZSI6InRleHQiLCJ2YWx1ZSI6WyJhZG1pdHRvOmV2ZW50MTphdHRlbmRlZTEiXX1dXX0",
      );
      expect(init?.method).toBe("GET");
      return jsonResponse(200, {
        success: true,
        data: [
          {
            identifier: "pass-1",
            userProvidedId: "admitto:event1:attendee1",
            noOfActiveRegistrationsAppleWallet: 1,
            noOfInactiveRegistrationsAppleWallet: 0,
            noOfActiveRegistrationsGoogleWallet: 0,
            noOfInactiveRegistrationsGoogleWallet: 1,
            firstDownloadedAt: "2026-08-01 10:00:00",
          },
        ],
      });
    });
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    const result = await client.getRegistrationStatus("admitto:event1:attendee1");
    expect(result).toEqual({
      appleActiveRegistrations: 1,
      appleInactiveRegistrations: 0,
      googleActiveRegistrations: 0,
      googleInactiveRegistrations: 1,
      firstDownloadedAt: "2026-08-01 10:00:00",
    });
  });

  it("returns null when no pass matches", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { success: true, data: [] }));
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    const result = await client.getRegistrationStatus("admitto:event1:nobody");
    expect(result).toBeNull();
  });

  it("defaults missing count fields to 0 and firstDownloadedAt to null", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        success: true,
        data: [{ identifier: "pass-1", userProvidedId: "admitto:event1:attendee1" }],
      }),
    );
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    const result = await client.getRegistrationStatus("admitto:event1:attendee1");
    expect(result).toEqual({
      appleActiveRegistrations: 0,
      appleInactiveRegistrations: 0,
      googleActiveRegistrations: 0,
      googleInactiveRegistrations: 0,
      firstDownloadedAt: null,
    });
  });

  it("returns null and logs when no row in the (unfiltered) response matches the query (PassCreator search doesn't actually filter by userProvidedId, live 2026-08-13)", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        success: true,
        data: [
          {
            identifier: "pass-wrong-attendee",
            userProvidedId: "admitto:event1:someone-else",
            noOfActiveRegistrationsGoogleWallet: 1,
          },
        ],
      }),
    );
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    const result = await client.getRegistrationStatus("admitto:event1:attendee1");
    expect(result).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("no row matching"));
    consoleErrorSpy.mockRestore();
  });

  it("finds the matching row even when it isn't first in the (unfiltered) response (live 2026-08-13)", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        success: true,
        data: [
          { identifier: "pass-newest", userProvidedId: "admitto:event1:someone-else", noOfActiveRegistrationsGoogleWallet: 9 },
          { identifier: "pass-1", userProvidedId: "admitto:event1:attendee1", noOfActiveRegistrationsGoogleWallet: 1 },
        ],
      }),
    );
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    const result = await client.getRegistrationStatus("admitto:event1:attendee1");
    expect(result?.googleActiveRegistrations).toBe(1);
  });
});

describe("PassCreatorClient wallet system-log coverage", () => {
  beforeEach(() => {
    resetSystemLogBufferForTest();
  });

  afterEach(() => {
    resetSystemLogBufferForTest();
  });

  it("does not log a successful request - a bulk event-wide push can call this hundreds of times, which risked bursting the ops-ingest rate limit", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        success: true,
        data: { identifier: "pass-1", iPhoneUri: "u", androidUri: "u" },
      }),
    );
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    await client.createPass(INPUT);

    expect(querySystemLogs({ source: "wallet" })).toEqual([]);
  });

  it("logs a warn-level entry (no request body, no Authorization header) on a rejected request", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(401, { success: false, errors: ["Unauthorized"] }));
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);

    await expect(client.createPass(INPUT)).rejects.toThrow(WalletProviderError);

    const [entry] = querySystemLogs({ source: "wallet" });
    expect(entry).toMatchObject({ level: "warn", message: "passcreator_request_rejected", fields: { status: 401 } });
    expect(JSON.stringify(entry)).not.toContain("test-key");
    expect(JSON.stringify(entry)).not.toContain(INPUT.attendeeName);
  });

  it("strips the query string from a search request's route (avoids leaking the encoded userProvidedId)", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(500, { success: false, errors: ["boom"] }));
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);

    await expect(client.findByUserProvidedId("admitto:event1:attendee1")).rejects.toThrow(WalletProviderError);

    const [entry] = querySystemLogs({ source: "wallet" });
    expect(entry?.fields?.["route"]).toBe("/api/v3/pass");
    expect(JSON.stringify(entry)).not.toContain("attendee1");
  });

  it("logs a warn-level entry when the request itself throws (network failure)", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);

    await expect(client.createPass(INPUT)).rejects.toThrow(WalletProviderError);

    const [entry] = querySystemLogs({ source: "wallet" });
    expect(entry).toMatchObject({ level: "warn", message: "passcreator_request_failed" });
  });

  it("logs a warn-level rejected entry for an HTTP 200 that carries success: false in its envelope", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { success: false, errors: ["Duplicate userProvidedId"] }));
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);

    await expect(client.createPass(INPUT)).rejects.toThrow(WalletProviderError);

    const [entry] = querySystemLogs({ source: "wallet" });
    expect(entry).toMatchObject({ level: "warn", message: "passcreator_request_rejected", fields: { status: 200 } });
  });

  it("does not log deletePass's idempotent 404-as-success case as a rejection", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);

    await client.deletePass("already-gone");

    expect(querySystemLogs({ source: "wallet" })).toEqual([]);
  });

  it("logs a rejected deletePass for a genuine failure (not 404), with a static route template instead of the pass id", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 401 }));
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);

    await expect(client.deletePass("attendee-linked-pass-id")).rejects.toThrow(WalletProviderError);

    const [entry] = querySystemLogs({ source: "wallet" });
    expect(entry).toMatchObject({
      level: "warn",
      message: "passcreator_request_rejected",
      fields: { status: 401, route: "/api/v3/pass/{id}" },
    });
    expect(JSON.stringify(entry)).not.toContain("attendee-linked-pass-id");
  });

  it("logs a rejected updatePass with a static route template instead of the pass id", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(404, { success: false, errors: ["Not found"] }));
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);

    await expect(client.updatePass("attendee-linked-pass-id", INPUT)).rejects.toThrow(WalletProviderError);

    const [entry] = querySystemLogs({ source: "wallet" });
    expect(entry).toMatchObject({
      level: "warn",
      message: "passcreator_request_rejected",
      fields: { status: 404, route: "/api/v3/pass/{id}" },
    });
    expect(JSON.stringify(entry)).not.toContain("attendee-linked-pass-id");
  });

  it("logs a rejected voidPass/restorePass with a static route template instead of the pass id", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 401 }));
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);

    await expect(client.voidPass("attendee-linked-pass-id")).rejects.toThrow(WalletProviderError);

    const [entry] = querySystemLogs({ source: "wallet" });
    expect(entry).toMatchObject({
      level: "warn",
      message: "passcreator_request_rejected",
      fields: { status: 401, route: "/api/pass/{id}" },
    });
    expect(JSON.stringify(entry)).not.toContain("attendee-linked-pass-id");
  });

  it("logs a rejected subscribeWebhook with a static route template instead of the template id", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 500 }));
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);

    await expect(client.subscribeWebhook("https://example.com/hook", "pass_voided")).rejects.toThrow(WalletProviderError);

    const [entry] = querySystemLogs({ source: "wallet" });
    expect(entry).toMatchObject({
      level: "warn",
      message: "passcreator_request_rejected",
      fields: { status: 500, route: "/api/hook/subscribe/{templateId}" },
    });
    expect(JSON.stringify(entry)).not.toContain(CONFIG.templateId);
  });
});
