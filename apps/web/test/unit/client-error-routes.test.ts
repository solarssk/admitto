import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handlePostClientError } from "../../src/admin/client-error-routes.js";
import { querySystemLogs, resetSystemLogBufferForTest } from "@admitto/shared/system-log";
import { logger } from "../../src/logger.js";

const app = new Hono().post("/client-errors", handlePostClientError);
afterEach(() => {
  vi.restoreAllMocks();
  resetSystemLogBufferForTest();
});

function post(body: unknown) {
  return app.request("/client-errors", { method: "POST", body: JSON.stringify(body) });
}

describe("client diagnostic privacy boundary", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
  });
  it.each([
    "admin-error-boundary", "window-error", "unhandled-rejection", "resource-error", "csp-violation",
  ])("logs only the allowed source %s", async (source) => {
    const response = await post({ source });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(warn).toHaveBeenCalledExactlyOnceWith("Admin SPA client error", { source });
  });

  it.each([
    null, [], "window-error", {}, { source: null }, { source: 1 },
    { source: "" }, { source: "window-error " }, { source: "person@example.com" },
    { source: "x".repeat(10000) }, { source: { category: "window-error" } },
    ...["name", "message", "path", "stack", "componentStack", "url", "category"].map((field) =>
      ({ source: "window-error", [field]: "person@example.com?token=synthetic-token" })),
    { source: "window-error", metadata: { email: "person@example.com" } },
    { source: "window-error", name: "Error", message: "person@example.com", path: "/private/synthetic-token" },
  ])("rejects untrusted report shape %# without logging it", async (body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "validation_failed" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON without logging the input", async () => {
    const response = await app.request("/client-errors", { method: "POST", body: "{" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_json" });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("client diagnostic console and System-log sinks", () => {
  it.each(["Unexpected render failure", "Unexpected render failure: person@example.com synthetic-token"])(
    "rejects arbitrary diagnostic text (%s) while recording the fixed category control",
    async (message) => {
      resetSystemLogBufferForTest();
      const output = vi.spyOn(console, "warn").mockImplementation(() => {});
      const rejected = await post({ source: "window-error", name: "Error", message, path: "/account" });
      expect(rejected.status).toBe(400);
      expect(output).not.toHaveBeenCalled();
      expect(querySystemLogs({ source: "api" })).toHaveLength(0);

      const accepted = await post({ source: "window-error" });
      expect(accepted.status).toBe(200);
      expect(output).toHaveBeenCalledTimes(1);
      const buffered = querySystemLogs({ source: "api" });
      expect(buffered).toHaveLength(1);
      const serialized = JSON.stringify([output.mock.calls, buffered]);
      expect(serialized).toContain("Admin SPA client error");
      expect(serialized).toContain("window-error");
      expect(serialized).not.toContain(message);
      expect(serialized).not.toContain("person@example.com");
      expect(serialized).not.toContain("synthetic-token");
      expect(serialized).not.toContain("/account");
    },
  );
});
