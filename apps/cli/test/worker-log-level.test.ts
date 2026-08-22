import { describe, expect, it } from "vitest";
import { isRoutineNoop, logLevel } from "../src/commands/worker.js";

describe("logLevel", () => {
  it("maps a FAILED-prefixed message to error", () => {
    expect(logLevel("FAILED connection refused")).toBe("error");
  });

  it("does not treat a message merely starting with the letters FAILED as error without the space", () => {
    expect(logLevel("FAILEDNESS is not a real message, but the prefix check must still be exact")).toBe("info");
  });

  it.each(["notify client unavailable, falling back to poll-only: x", "heartbeat refresh failed: x"])(
    "maps %s to warn",
    (message) => {
      expect(logLevel(message)).toBe("warn");
    },
  );

  it.each([
    "ok claimed=5 sent=4 failed=1 skipped=0",
    "ok claimed=5 succeeded=4 failed=1 reclaimed=0 healed=0",
    "ok events=3 seen=10 applied=8 errors=2",
  ])("maps an otherwise-ok summary with a nonzero failed/errors counter (%s) to warn", (message) => {
    expect(logLevel(message)).toBe("warn");
  });

  it.each(["idle", "skipped (lock held)", "ok claimed=1 sent=1 failed=0 skipped=0", "ok events=1 seen=1 applied=1 errors=0", "retry after failure backoff (15m)"])(
    "maps %s to info",
    (message) => {
      expect(logLevel(message)).toBe("info");
    },
  );
});

describe("isRoutineNoop", () => {
  it.each(["idle", "skipped (lock held)"])("treats %s as a routine no-op", (message) => {
    expect(isRoutineNoop(message)).toBe(true);
  });

  it.each(["ok claimed=1 sent=1 failed=0 skipped=0", "FAILED connection refused", "stopped", "skip drain: instance URL not configured"])(
    "does not treat %s as a routine no-op",
    (message) => {
      expect(isRoutineNoop(message)).toBe(false);
    },
  );
});
