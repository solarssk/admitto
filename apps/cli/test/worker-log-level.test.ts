import { describe, expect, it } from "vitest";
import { logLevel } from "../src/commands/worker.js";

describe("logLevel", () => {
  it("maps a FAILED-prefixed message to error", () => {
    expect(logLevel("FAILED connection refused")).toBe("error");
  });

  it.each(["notify client unavailable, falling back to poll-only: x", "heartbeat refresh failed: x"])(
    "maps %s to warn",
    (message) => {
      expect(logLevel(message)).toBe("warn");
    },
  );

  it.each(["idle", "skipped (lock held)", "ok claimed=1 sent=1 failed=0 skipped=0", "retry after failure backoff (15m)"])(
    "maps %s to info",
    (message) => {
      expect(logLevel(message)).toBe("info");
    },
  );
});
