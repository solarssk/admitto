import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  currentSystemLogCursor,
  emitSystemLog,
  querySystemLogs,
  recordSystemLog,
  resetSystemLogBufferForTest,
  setSystemLogPublisher,
} from "../src/systemLog.js";

beforeEach(() => {
  resetSystemLogBufferForTest();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recordSystemLog / querySystemLogs", () => {
  it("returns entries oldest-first with a monotonic id and cursor", () => {
    recordSystemLog({ level: "info", source: "api", message: "first" });
    recordSystemLog({ level: "info", source: "api", message: "second" });

    const entries = querySystemLogs();
    expect(entries.map((e) => e.message)).toEqual(["first", "second"]);
    expect(entries[0]!.id).toBeLessThan(entries[1]!.id);
    expect(currentSystemLogCursor()).toBe(entries[1]!.id);
  });

  it("evicts the oldest entry once capacity (1000) is exceeded", () => {
    for (let i = 0; i < 1001; i++) {
      recordSystemLog({ level: "info", source: "api", message: `entry-${i}` });
    }

    const entries = querySystemLogs();
    expect(entries).toHaveLength(1000);
    expect(entries[0]!.message).toBe("entry-1");
    expect(entries[999]!.message).toBe("entry-1000");
  });

  it("filters by sinceId, returning only entries with a strictly greater id", () => {
    recordSystemLog({ level: "info", source: "api", message: "old" });
    const cursor = currentSystemLogCursor();
    recordSystemLog({ level: "info", source: "api", message: "new" });

    expect(querySystemLogs({ sinceId: cursor }).map((e) => e.message)).toEqual(["new"]);
  });

  it("filters by level", () => {
    recordSystemLog({ level: "info", source: "api", message: "ok" });
    recordSystemLog({ level: "error", source: "api", message: "boom" });

    expect(querySystemLogs({ level: "error" }).map((e) => e.message)).toEqual(["boom"]);
  });

  it("filters by source", () => {
    recordSystemLog({ level: "info", source: "api", message: "from api" });
    recordSystemLog({ level: "info", source: "db", message: "from db" });

    expect(querySystemLogs({ source: "db" }).map((e) => e.message)).toEqual(["from db"]);
  });

  it("filters by a case-insensitive message substring", () => {
    recordSystemLog({ level: "info", source: "mail", message: "SMTP connected" });
    recordSystemLog({ level: "info", source: "mail", message: "mail sent" });

    expect(querySystemLogs({ search: "smtp" }).map((e) => e.message)).toEqual(["SMTP connected"]);
  });

  it("combines multiple filters", () => {
    recordSystemLog({ level: "warn", source: "cache", message: "redis unavailable" });
    recordSystemLog({ level: "error", source: "cache", message: "redis unavailable" });
    recordSystemLog({ level: "warn", source: "db", message: "slow query" });

    expect(
      querySystemLogs({ level: "warn", source: "cache", search: "redis" }).map((e) => e.message),
    ).toEqual(["redis unavailable"]);
  });

  it("currentSystemLogCursor reflects the buffer's true max id regardless of a concurrent filter", () => {
    recordSystemLog({ level: "info", source: "api", message: "one" });
    recordSystemLog({ level: "info", source: "db", message: "two" });

    expect(querySystemLogs({ source: "api" })).toHaveLength(1);
    expect(currentSystemLogCursor()).toBe(2);
  });
});

describe("emitSystemLog", () => {
  it("writes the same JSON shape apps/web's logger produces, and records into the buffer", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    emitSystemLog("cache", "warn", "Rate limit Redis unavailable; failing open", { retries: 3 });

    expect(spy).toHaveBeenCalledOnce();
    const stdoutEntry = JSON.parse(String(spy.mock.calls[0]![0])) as Record<string, unknown>;
    expect(stdoutEntry.level).toBe("warn");
    expect(stdoutEntry.msg).toBe("Rate limit Redis unavailable; failing open");
    expect(stdoutEntry.retries).toBe(3);
    expect(typeof stdoutEntry.ts).toBe("string");

    const [buffered] = querySystemLogs();
    expect(buffered).toMatchObject({
      level: "warn",
      source: "cache",
      message: "Rate limit Redis unavailable; failing open",
      fields: { retries: 3 },
    });
  });

  it.each([
    ["info", "info"],
    ["error", "error"],
  ] as const)("writes %s entries to console.%s", (level, consoleMethod) => {
    const spy = vi.spyOn(console, consoleMethod).mockImplementation(() => {});

    emitSystemLog("api", level, `${level} message`);

    expect(spy).toHaveBeenCalledOnce();
    expect(querySystemLogs()).toEqual([
      expect.objectContaining({ level, source: "api", message: `${level} message` }),
    ]);
  });
});

describe("setSystemLogPublisher", () => {
  it("forwards the recorded entry (with its assigned id/ts) to the publisher after a local emit", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const publisher = vi.fn();
    setSystemLogPublisher(publisher);

    emitSystemLog("worker", "info", "job ok", { job: "mail_delivery" });

    expect(publisher).toHaveBeenCalledOnce();
    const [entry] = publisher.mock.calls[0]!;
    expect(entry).toMatchObject({ level: "info", source: "worker", message: "job ok", fields: { job: "mail_delivery" } });
    expect(typeof entry.id).toBe("number");
    expect(typeof entry.ts).toBe("string");
  });

  it("does not call the publisher when none is set", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    expect(() => emitSystemLog("api", "info", "no publisher set")).not.toThrow();
  });

  it("swallows a publisher that throws instead of letting it escape emitSystemLog", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    setSystemLogPublisher(() => {
      throw new Error("relay unavailable");
    });

    expect(() => emitSystemLog("worker", "info", "still recorded locally")).not.toThrow();
    expect(querySystemLogs()).toEqual([expect.objectContaining({ message: "still recorded locally" })]);
  });

  it("resetSystemLogBufferForTest also clears any registered publisher", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const publisher = vi.fn();
    setSystemLogPublisher(publisher);

    resetSystemLogBufferForTest();
    emitSystemLog("api", "info", "after reset");

    expect(publisher).not.toHaveBeenCalled();
  });
});
