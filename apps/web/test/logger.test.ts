import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../src/logger.js";

describe("logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes JSON with level, msg, ts, and fields", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logger.info("Import preview complete", { importId: "abc-123", eventId: "evt-1" });

    expect(spy).toHaveBeenCalledOnce();
    const entry = JSON.parse(String(spy.mock.calls[0]![0])) as Record<string, unknown>;
    expect(entry.level).toBe("info");
    expect(entry.msg).toBe("Import preview complete");
    expect(entry.importId).toBe("abc-123");
    expect(entry.eventId).toBe("evt-1");
    expect(typeof entry.ts).toBe("string");
  });
});
