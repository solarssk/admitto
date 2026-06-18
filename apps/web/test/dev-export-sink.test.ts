import { afterEach, describe, expect, it, vi } from "vitest";
import { devConsoleExportSink, warnExportOnlyProductionEnv } from "../src/dev-export-sink.js";

describe("devConsoleExportSink", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs to, subject, and html byte length without full html body", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    devConsoleExportSink({
      message: {
        to: "tester@example.com",
        subject: "Your ticket",
        html: "<p>Secret attendee content</p>",
      },
      sender: { fromAddress: "events@example.com" },
    });

    expect(log).toHaveBeenCalledOnce();
    const line = String(log.mock.calls[0]?.[0]);
    expect(line).toContain("[export_only dry-run]");
    expect(line).toContain("to=tester@example.com");
    expect(line).toContain("subject=Your ticket");
    expect(line).toContain(`htmlBytes=${Buffer.byteLength("<p>Secret attendee content</p>", "utf8")}`);
    expect(line).not.toContain("Secret attendee content");
    expect(line).not.toContain("<p>");
  });
});

describe("warnExportOnlyProductionEnv", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("warns in production when EMAIL_PROVIDER is export_only", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnExportOnlyProductionEnv({
      NODE_ENV: "production",
      EMAIL_PROVIDER: "export_only",
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain("export_only");
  });

  it("does not warn in development", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnExportOnlyProductionEnv({
      NODE_ENV: "development",
      EMAIL_PROVIDER: "export_only",
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not warn when provider is smtp", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnExportOnlyProductionEnv({
      NODE_ENV: "production",
      EMAIL_PROVIDER: "smtp",
    });
    expect(warn).not.toHaveBeenCalled();
  });
});
