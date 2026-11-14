// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { testRegistrationTurnstile } from "../../src/api/client.js";

describe("testRegistrationTurnstile (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the typed secret key to the test endpoint and returns the answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, message: "Cloudflare accepted the secret key." }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await testRegistrationTurnstile({ secret_key: "typed-secret" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/registration/turnstile/test",
      expect.objectContaining({ method: "POST", credentials: "same-origin", body: JSON.stringify({ secret_key: "typed-secret" }) }),
    );
    expect(result).toEqual({ ok: true, message: "Cloudflare accepted the secret key." });
  });

  it("sends an empty body to check the saved key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: false, error: "Cloudflare did not accept the secret key." }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await testRegistrationTurnstile({});

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/registration/turnstile/test", expect.objectContaining({ body: "{}" }));
    expect(result.ok).toBe(false);
  });
});
