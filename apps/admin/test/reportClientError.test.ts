// @vitest-environment jsdom

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_ERROR_REPORT_PATH, reportClientError } from "../src/reportClientError.js";

import { installGlobalErrorReporting } from "../src/globalErrorReporting.js";

describe("reportClientError", () => {
  beforeAll(() => installGlobalErrorReporting());
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

  it("POSTs a same-origin, credentialed, minimized report to the client-error endpoint", async () => {
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
    });
  });

  it.each([
    "admin-error-boundary", "window-error", "unhandled-rejection", "resource-error", "csp-violation",
  ] as const)("reports only the fixed source %s, even with identifying error and URL data", (source) => {
    window.history.replaceState(null, "", "/account/person@example.com?token=synthetic-token#secret");
    const error = new Error("person@example.com synthetic-token https://example.com/private");
    error.name = "person@example.com";
    error.stack = "private stack synthetic-token";
    reportClientError(error, { source, componentStack: "private component stack" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ source });
    window.history.replaceState(null, "", "/");
  });

  it("does not inspect or stringify untrusted production error values", () => {
    const inspect = vi.fn(() => { throw new Error("must not inspect"); });
    const reason = { toString: inspect, get name() { return inspect(); }, get message() { return inspect(); } };
    expect(() => reportClientError(reason, { source: "unhandled-rejection" })).not.toThrow();
    expect(inspect).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ source: "unhandled-rejection" });
  });

  it("drops an unexpected source at runtime instead of transmitting arbitrary text", () => {
    reportClientError(new Error("boom"), { source: "person@example.com" as "window-error" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps detailed local diagnostics in development without sending a report", () => {
    vi.stubEnv("DEV", true);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("local detail");
    reportClientError(error, { source: "window-error", componentStack: "local stack" });
    expect(consoleError).toHaveBeenCalledWith("[window-error]", error, "local stack");
    reportClientError("plain reason", { source: "unhandled-rejection" });
    expect(consoleError.mock.calls[1][1]).toEqual(new Error("plain reason"));
    expect(fetchMock).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("minimizes real global resource and CSP reports, including data URLs and private paths", () => {
    const script = document.createElement("script");
    script.src = "https://cdn.example.com/person@example.com?token=synthetic-token";
    document.body.appendChild(script);
    script.dispatchEvent(new Event("error"));
    script.remove();
    const violation = new Event("securitypolicyviolation");
    Object.defineProperties(violation, {
      violatedDirective: { value: "script-src" },
      blockedURI: { value: "data:text/javascript,person@example.com" },
      sourceFile: { value: "https://example.com/private/synthetic-token" },
      sample: { value: "person@example.com" },
      lineNumber: { value: 1 },
    });
    document.dispatchEvent(violation);
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body))).toEqual([
      { source: "resource-error" }, { source: "csp-violation" },
    ]);
  });

  it("does not report a CSP block of the report endpoint, including query and fragment", () => {
    const violation = new Event("securitypolicyviolation");
    Object.defineProperties(violation, {
      violatedDirective: { value: "connect-src" },
      blockedURI: { value: `${window.location.origin}${CLIENT_ERROR_REPORT_PATH}?token=synthetic-token#secret` },
    });
    document.dispatchEvent(violation);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws when the fire-and-forget fetch itself rejects", () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    expect(() => reportClientError(new Error("boom"), { source: "window-error" })).not.toThrow();
  });
});
