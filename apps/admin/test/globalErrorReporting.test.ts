// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const reportClientError = vi.fn();
vi.mock("../src/reportClientError.js", () => ({ reportClientError }));

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

  it("reports CSP violations with directive/source/line/sample detail, stripping the source URL's query string", () => {
    const event = new Event("securitypolicyviolation");
    Object.defineProperty(event, "violatedDirective", { value: "script-src-elem" });
    Object.defineProperty(event, "blockedURI", { value: "inline" });
    Object.defineProperty(event, "sourceFile", {
      value: "https://admitto.example.com/admin/events/x/settings?tab=mail&token=secret123",
    });
    Object.defineProperty(event, "lineNumber", { value: 25 });
    Object.defineProperty(event, "sample", { value: "some blocked inline code" });
    document.dispatchEvent(event);

    expect(reportClientError).toHaveBeenCalledTimes(1);
    const [err, ctx] = reportClientError.mock.calls[0];
    expect(ctx).toEqual({ source: "csp-violation" });
    expect(err.message).toContain("script-src-elem");
    expect(err.message).toContain("https://admitto.example.com/admin/events/x/settings:25");
    expect(err.message).not.toContain("tab=mail");
    expect(err.message).not.toContain("token=secret123");
    // The sample is the blocked script/style's own (third-party) content, not first-party
    // user data - kept, truncated, since it's the one field that actually identifies the
    // culprit; see PR #1053 review discussion.
    expect(err.message).toContain("some blocked inline code");
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

  it("falls back to placeholders when the violation event has no blockedURI/sourceFile/lineNumber", () => {
    const event = new Event("securitypolicyviolation");
    Object.defineProperty(event, "violatedDirective", { value: "style-src" });
    document.dispatchEvent(event);

    const [err] = reportClientError.mock.calls[0];
    expect(err.message).toBe('style-src blocked (inline) at ?:? sample=""');
  });
});
