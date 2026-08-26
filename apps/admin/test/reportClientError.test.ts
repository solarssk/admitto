// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_ERROR_REPORT_PATH, reportClientError } from "../src/reportClientError.js";

describe("reportClientError", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // reportClientError only posts outside dev (see reportClientError.ts) - vitest's default
    // mode leaves import.meta.env.DEV true, so this module's whole production path is
    // otherwise untested. Force it off here to exercise the real fetch call.
    vi.stubEnv("DEV", false);
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("POSTs a same-origin, credentialed, truncated report to the client-error endpoint", async () => {
    reportClientError(new Error("boom"), { source: "window-error" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(CLIENT_ERROR_REPORT_PATH);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.keepalive).toBe(true);
    expect(init.headers).toEqual({ "Content-Type": "application/json" });

    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body).toEqual({
      source: "window-error",
      name: "Error",
      message: "boom",
      path: window.location.pathname,
    });
  });

  it("wraps a non-Error reason in an Error before reporting", async () => {
    reportClientError("plain string reason", { source: "unhandled-rejection" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body.name).toBe("Error");
    expect(body.message).toBe("plain string reason");
  });

  it("never throws when the fire-and-forget fetch itself rejects", () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    expect(() => reportClientError(new Error("boom"), { source: "window-error" })).not.toThrow();
  });
});
