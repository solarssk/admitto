// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveWeatherSettings } from "../../src/api/client.js";

describe("parseJson — Zod details passthrough", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("carries the server's Zod .flatten() details onto the thrown ApiError", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({
        error: "validation_failed",
        details: {
          formErrors: [],
          fieldErrors: { api_key: ["API key is required for this Open-Meteo host."] },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveWeatherSettings({} as never)).rejects.toMatchObject({
      status: 400,
      code: "validation_failed",
      details: {
        fieldErrors: { api_key: ["API key is required for this Open-Meteo host."] },
      },
    });
  });

  it("leaves details undefined when the server sends none", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ error: "validation_failed" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveWeatherSettings({} as never)).rejects.toMatchObject({ details: undefined });
  });
});
