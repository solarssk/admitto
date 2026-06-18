import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { devConsoleExportSink, warnExportOnlyProductionEnv } from "../src/dev-export-sink.js";

describe("devConsoleExportSink", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs recipient hash and byte lengths without email, subject text, or html body", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    // sender is required by ExportPayload but intentionally unused by the sink
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
    expect(line).toContain("recipientRef=");
    expect(line).toContain(`subjectBytes=${Buffer.byteLength("Your ticket", "utf8")}`);
    expect(line).toContain(`htmlBytes=${Buffer.byteLength("<p>Secret attendee content</p>", "utf8")}`);
    expect(line).not.toContain("tester@example.com");
    expect(line).not.toContain("Your ticket");
    expect(line).not.toContain("Secret attendee content");
    expect(line).not.toContain("<p>");
  });

  it("uses deterministic hash for empty recipient (validation should block earlier in prod)", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    devConsoleExportSink({
      message: { to: "", subject: "x", html: "<p>x</p>" },
      sender: { fromAddress: "events@example.com" },
    });
    const line = String(log.mock.calls[0]?.[0]);
    const expected = createHash("sha256").update("").digest("hex").slice(0, 8);
    expect(line).toContain(`recipientRef=${expected}`);
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
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain("export_only");
    expect(message).toContain("sends will fail");
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
