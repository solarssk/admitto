// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { signOut } from "../../src/api/client.js";

describe("signOut (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the JSON logout endpoint from the same origin and returns the identity provider's end-session address", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ ok: true, end_session_url: "https://idp.example.com/end-session?client_id=admitto" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await expect(signOut(controller.signal)).resolves.toBe("https://idp.example.com/end-session?client_id=admitto");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ method: "POST", credentials: "same-origin", signal: controller.signal }),
    );
  });

  it.each([
    ["no end-session address (password session)", { ok: true, end_session_url: null }],
    ["a body without the field (an older server)", { ok: true }],
    ["something that is not an address", { ok: true, end_session_url: 42 }],
  ])("returns null for %s", async (_label, body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL, _init?: RequestInit) => ({ ok: true, json: async () => body })),
    );

    await expect(signOut()).resolves.toBeNull();
  });

  it("propagates API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL, _init?: RequestInit) => ({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({ error: "internal_error" }),
      })),
    );

    await expect(signOut()).rejects.toMatchObject({ status: 500 });
  });
});
