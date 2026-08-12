import { describe, expect, it, vi } from "vitest";
import { PassCreatorClient, WalletProviderError } from "../src/index.js";
import { PASSCREATOR_DEFAULT_BASE_URL } from "../src/passcreator-config.js";
import type { WalletPassInput } from "../src/index.js";

const CONFIG = { apiKey: "test-key", templateId: "tmpl-1", baseUrl: "https://pc.test" };

const INPUT: WalletPassInput = {
  attendeeName: "Jane Doe",
  eventDateLabel: "12 August 2026",
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
        "https://pc.test/api/v3/pass?userProvidedId=admitto%3Aevent1%3Aattendee1",
      );
      return jsonResponse(200, {
        success: true,
        data: [
          {
            identifier: "pass-1",
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
        data: [{ identifier: "pass-1", linkToPassPage: "https://pc.test/p/pass-1" }],
      }),
    );
    const client = new PassCreatorClient(CONFIG, fetchMock as unknown as typeof fetch);
    const result = await client.findByUserProvidedId("admitto:event1:attendee1");
    expect(result).toMatchObject({ appleUrl: "", androidUrl: "" });
  });
});

describe("PassCreatorClient.getRegistrationStatus", () => {
  it("maps the search row's registration counts and firstDownloadedAt", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(url).toBe("https://pc.test/api/v3/pass?userProvidedId=admitto%3Aevent1%3Aattendee1");
      expect(init?.method).toBe("GET");
      return jsonResponse(200, {
        success: true,
        data: [
          {
            identifier: "pass-1",
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
      jsonResponse(200, { success: true, data: [{ identifier: "pass-1" }] }),
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
});
