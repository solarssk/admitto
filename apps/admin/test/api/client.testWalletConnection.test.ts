// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { testWalletConnection } from "../../src/api/client.js";

describe("testWalletConnection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the wallet test endpoint and returns the parsed response", async () => {
    const body = { ok: true, message: 'Connected - template "Gala Pass".' };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);

    const result = await testWalletConnection("evt-1", { templateId: "tmpl-1", apiKey: "a-key" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/wallet/test",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ templateId: "tmpl-1", apiKey: "a-key" }),
      }),
    );
    expect(result).toEqual(body);
  });

  it("surfaces API errors from testWalletConnection", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "forbidden" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      testWalletConnection("evt-1", { templateId: "tmpl-1" }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
