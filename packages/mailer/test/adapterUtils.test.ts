import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { logMailSent, resetMailSentThrottleForTest } from "../src/adapterUtils.js";

beforeEach(() => {
  resetSystemLogBufferForTest();
  resetMailSentThrottleForTest();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logMailSent", () => {
  it("logs the first send to both stdout and the System-logs buffer", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logMailSent("smtp", "a***@example.com");

    expect(spy).toHaveBeenCalledOnce();
    const logged = JSON.parse(String(spy.mock.calls[0]![0]));
    expect(logged).toMatchObject({ msg: "mail_sent", provider: "smtp", to: "a***@example.com" });

    const entries = querySystemLogs({ source: "mail" });
    expect(entries.some((e) => e.message === "mail_sent")).toBe(true);
  });

  it("throttles a second send within the window to stdout only, not the buffer", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logMailSent("smtp", "a***@example.com");
    logMailSent("smtp", "b***@example.com");

    // Both sends still reach stdout - durability (docker logs / SIEM) is never throttled.
    expect(spy).toHaveBeenCalledTimes(2);

    // Only the first landed in the shared live-tail buffer.
    const entries = querySystemLogs({ source: "mail" });
    expect(entries.filter((e) => e.message === "mail_sent")).toHaveLength(1);
    expect(entries[0]?.fields?.to).toBe("a***@example.com");
  });

  it("logs to the buffer again once the throttle is reset", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    logMailSent("smtp", "a***@example.com");
    logMailSent("smtp", "b***@example.com");

    resetMailSentThrottleForTest();
    logMailSent("smtp", "c***@example.com");

    const entries = querySystemLogs({ source: "mail" });
    expect(entries.filter((e) => e.message === "mail_sent")).toHaveLength(2);
  });
});
