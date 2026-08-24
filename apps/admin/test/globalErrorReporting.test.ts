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

  it("reports CSP violations with directive/source/line/sample detail", () => {
    const event = new Event("securitypolicyviolation");
    Object.defineProperty(event, "violatedDirective", { value: "script-src-elem" });
    Object.defineProperty(event, "blockedURI", { value: "inline" });
    Object.defineProperty(event, "sourceFile", {
      value: "https://admitto.example.com/admin/events/x/settings?tab=mail",
    });
    Object.defineProperty(event, "lineNumber", { value: 25 });
    Object.defineProperty(event, "sample", { value: "some blocked inline code" });
    document.dispatchEvent(event);

    expect(reportClientError).toHaveBeenCalledTimes(1);
    const [err, ctx] = reportClientError.mock.calls[0];
    expect(ctx).toEqual({ source: "csp-violation" });
    expect(err.message).toContain("script-src-elem");
    expect(err.message).toContain("settings?tab=mail:25");
    expect(err.message).toContain("some blocked inline code");
  });
});
