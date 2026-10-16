import type { ForkOptions } from "node:child_process";
import type { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

interface FakeChild extends EventEmitter {
  file: string;
  args: string[];
  options: ForkOptions;
  send: Mock<(message: unknown) => boolean>;
  kill: Mock<(signal?: string) => boolean>;
}

const { children, emitSystemLog } = vi.hoisted(() => ({
  children: [] as FakeChild[],
  emitSystemLog: vi.fn(),
}));

vi.mock("@admitto/shared/system-log", () => ({ emitSystemLog }));

// The child process is replaced by an object the test drives, so what happens around the process
// (flags, answers, how it ends, one at a time) is tested without waiting for memory to run out. The
// process itself is tested for real in xlsx-to-csv.test.ts.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { EventEmitter: Emitter } = await import("node:events");
  const fork = vi.fn((file: string, args: string[], options: ForkOptions) => {
    const child = Object.assign(new Emitter(), {
      file,
      args,
      options,
      send: vi.fn(() => true),
      kill: vi.fn(() => true),
    });
    children.push(child as unknown as FakeChild);
    return child;
  });
  return { ...actual, fork };
});

const TIMEOUT_MS = 60_000;

// The module is imported again for every test: its queue of workbooks is module state, and a test that
// fails half way must not leave a workbook in it that holds up the next one.
let xlsx: typeof import("../src/admin/xlsx-to-csv.js");

const read = (): Promise<string> => xlsx.xlsxBufferToCsv(new ArrayBuffer(8));

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function lastChild(): FakeChild {
  const child = children.at(-1);
  if (!child) throw new Error("no process was started");
  return child;
}

beforeEach(async () => {
  children.length = 0;
  emitSystemLog.mockClear();
  vi.resetModules();
  xlsx = await import("../src/admin/xlsx-to-csv.js");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("xlsxBufferToCsv", () => {
  it("starts a process for the workbook, with the memory flags and nothing of the app's environment", async () => {
    const buf = new ArrayBuffer(8);
    const result = xlsx.xlsxBufferToCsv(buf);
    await flush();

    const child = lastChild();
    child.emit("message", { csv: "a" });
    await result;

    // The process runs this module itself: it loads the file as it is on disk.
    expect(child.file).toMatch(/xlsx-to-csv\.(ts|js)$/);
    expect(child.options.execArgv).toEqual(["--max-old-space-size=384", "--max-semi-space-size=8"]);
    expect(child.options).toMatchObject({
      serialization: "advanced",
      env: {},
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    expect(child.send).toHaveBeenCalledExactlyOnceWith({ workbook: buf });
  });

  it("hands on none of the node flags of this process, so that nothing of the app reaches the child or overrides its limits", async () => {
    const original = process.execArgv;
    process.execArgv = [
      "--import",
      "tsx",
      "--env-file=.env",
      "--env-file",
      "other.env",
      "--max-old-space-size-percentage=75",
      "--max-old-space-size-percentage",
      "5e1",
      "--max_old_space_size=2048",
      "-max-old-space-size=2048",
      "--max-heap-size=4096",
      "--conditions",
      "development",
    ];
    try {
      const result = read();
      await flush();
      expect(lastChild().options.execArgv).toEqual(["--max-old-space-size=384", "--max-semi-space-size=8"]);
      lastChild().emit("message", { csv: "a" });
      await result;
    } finally {
      process.execArgv = original;
    }
  });

  it("returns the text the process sends and ends the process", async () => {
    const result = read();
    await flush();
    lastChild().emit("message", { csv: "a,b\n1,2" });

    await expect(result).resolves.toBe("a,b\n1,2");
    expect(lastChild().kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
    expect(emitSystemLog).not.toHaveBeenCalled();
  });

  it.each([
    ["rows", "ImportRowLimitError"],
    ["zip", "ImportZipBombError"],
  ] as const)("turns the process's %s refusal back into its error", async (refusal, errorName) => {
    const result = read();
    await flush();
    lastChild().emit("message", { refusal });

    await expect(result).rejects.toBeInstanceOf(xlsx[errorName]);
    expect(emitSystemLog).not.toHaveBeenCalled();
  });

  it("turns any other refusal into a plain error", async () => {
    const result = read();
    await flush();
    lastChild().emit("message", { refusal: "invalid" });

    const error: unknown = await result.catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(xlsx.ImportRowLimitError);
    expect(error).not.toBeInstanceOf(xlsx.ImportZipBombError);
  });

  it.each([
    ["SIGABRT", "memory"],
    ["SIGKILL", "memory"],
    ["SIGSEGV", "crash"],
  ] as const)(
    "refuses a workbook whose process was ended by %s as one with too many rows, and logs it as %s",
    async (signal, reason) => {
      const result = read();
      await flush();
      lastChild().emit("close", null, signal);

      await expect(result).rejects.toBeInstanceOf(xlsx.ImportRowLimitError);
      expect(emitSystemLog).toHaveBeenCalledExactlyOnceWith("api", "warn", "xlsx_decode_stopped", { reason, signal });
      expect(lastChild().kill).toHaveBeenCalledTimes(1);
    },
  );

  it("waits for the channel to close before it gives up on a process that has exited", async () => {
    const result = read();
    await flush();
    const child = lastChild();

    // The process is gone, but its answer was still on the way.
    child.emit("exit", 0, null);
    child.emit("message", { csv: "late but whole" });
    child.emit("close", 0, null);

    await expect(result).resolves.toBe("late but whole");
    expect(emitSystemLog).not.toHaveBeenCalled();
  });

  it("fails a workbook whose process exits without an answer and without a signal", async () => {
    const result = read();
    await flush();
    lastChild().emit("close", 1, null);

    await expect(result).rejects.toThrow("xlsx child process ended without an answer");
    expect(emitSystemLog).toHaveBeenCalledExactlyOnceWith("api", "error", "xlsx_decode_failed", { cause: "exit 1" });
  });

  it.each([
    ["has a code", Object.assign(new Error("boom"), { code: "EAGAIN" }), "EAGAIN"],
    ["has no code", new TypeError("boom"), "TypeError"],
  ])("passes on a process error that %s and logs where it came from, without its message", async (_case, error, cause) => {
    const result = read();
    await flush();
    lastChild().emit("error", error);

    await expect(result).rejects.toBe(error);
    expect(emitSystemLog).toHaveBeenCalledExactlyOnceWith("api", "error", "xlsx_decode_failed", { cause });
  });

  it("ignores whatever the process does after the workbook was settled", async () => {
    const result = read();
    await flush();
    const child = lastChild();
    child.emit("message", { csv: "a" });
    await expect(result).resolves.toBe("a");

    child.emit("message", { refusal: "rows" });
    child.emit("error", new Error("late"));
    child.emit("close", null, "SIGKILL");

    expect(emitSystemLog).not.toHaveBeenCalled();
  });

  it("stops a process that has not answered in time and refuses the workbook as one with too many rows", async () => {
    vi.useFakeTimers();
    const refused = expect(read()).rejects.toBeInstanceOf(xlsx.ImportRowLimitError);

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(emitSystemLog).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await refused;

    expect(emitSystemLog).toHaveBeenCalledExactlyOnceWith("api", "warn", "xlsx_decode_stopped", { reason: "time" });
    expect(lastChild().kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
    // An answer that comes too late changes nothing.
    lastChild().emit("message", { csv: "late" });
    expect(emitSystemLog).toHaveBeenCalledTimes(1);
  });

  it("does not leave its timer behind once the process has answered", async () => {
    vi.useFakeTimers();
    const result = read();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);

    lastChild().emit("message", { csv: "a" });
    await result;

    expect(vi.getTimerCount()).toBe(0);
  });

  it("reads one workbook at a time, in the order they came", async () => {
    const first = read();
    const second = read();
    await flush();
    expect(children).toHaveLength(1);

    children[0]!.emit("message", { csv: "first" });
    await expect(first).resolves.toBe("first");
    await flush();
    expect(children).toHaveLength(2);

    children[1]!.emit("message", { csv: "second" });
    await expect(second).resolves.toBe("second");
  });

  it("holds four workbooks at most and turns a fifth away at once", async () => {
    const held = [read(), read(), read(), read()];
    await flush();
    expect(children).toHaveLength(1);

    await expect(read()).rejects.toBeInstanceOf(xlsx.ImportBusyError);
    expect(children).toHaveLength(1);

    for (const [i, answer] of held.entries()) {
      await flush();
      children[i]!.emit("message", { csv: String(i) });
      await expect(answer).resolves.toBe(String(i));
    }
  });

  it("takes a workbook again as soon as a place is free, whatever became of the one before", async () => {
    const held = [read(), read(), read(), read()];
    await flush();
    children[0]!.emit("close", null, "SIGABRT");
    await expect(held[0]).rejects.toBeInstanceOf(xlsx.ImportRowLimitError);

    const next = read();
    await expect(read()).rejects.toBeInstanceOf(xlsx.ImportBusyError);

    for (const [i, answer] of [...held.slice(1), next].entries()) {
      await flush();
      children[i + 1]!.emit("message", { csv: "ok" });
      await expect(answer).resolves.toBe("ok");
    }
  });

  it("reads the next workbook after one that was refused", async () => {
    const first = read();
    const second = read();
    await flush();

    children[0]!.emit("close", null, "SIGABRT");
    await expect(first).rejects.toBeInstanceOf(xlsx.ImportRowLimitError);
    await flush();
    expect(children).toHaveLength(2);

    children[1]!.emit("message", { csv: "second" });
    await expect(second).resolves.toBe("second");
  });

  it("counts the time a workbook may take from the start of its process, not from when it was queued", async () => {
    vi.useFakeTimers();
    const first = read();
    const second = read();
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1_000);
    children[0]!.emit("message", { csv: "first" });
    await expect(first).resolves.toBe("first");
    await vi.advanceTimersByTimeAsync(0);
    expect(children).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(emitSystemLog).not.toHaveBeenCalled();
    children[1]!.emit("message", { csv: "second" });
    await expect(second).resolves.toBe("second");
  });
});
