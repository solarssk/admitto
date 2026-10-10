/**
 * LocalStorageAdapter.put when the write fails half way: nothing is left at the key that nobody received.
 * The file system module is wrapped for this file only, so that a write can create the file and then fail,
 * as a full disk does.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { realWriteFile, writeFile } = vi.hoisted(() => {
  const state = { real: undefined as undefined | ((path: string, data: unknown) => Promise<void>) };
  return {
    realWriteFile: state,
    writeFile: vi.fn(async (path: string, data: unknown) => state.real!(path, data)),
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  realWriteFile.real = actual.writeFile as unknown as (path: string, data: unknown) => Promise<void>;
  return { ...actual, writeFile };
});

import { LocalStorageAdapter } from "../src/index.js";

const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));

describe("LocalStorageAdapter.put when the write fails", () => {
  let uploadDir: string;
  let storage: LocalStorageAdapter;

  beforeEach(() => {
    uploadDir = mkdtempSync(join(tmpdir(), "admitto-put-failure-"));
    storage = new LocalStorageAdapter({ UPLOAD_DIR: uploadDir });
    writeFile.mockClear();
  });

  afterEach(() => {
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it("deletes the truncated file the failed write left, and passes the error on", async () => {
    writeFile.mockImplementationOnce(async (path: string) => {
      await realWriteFile.real!(path, "name,email\nfirst rows only");
      throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
    });

    await expect(
      storage.put(Buffer.from("x"), { orgId: "org-1", eventId: "evt-1", scope: "event", ext: ".csv" }),
    ).rejects.toMatchObject({ code: "ENOSPC" });

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(filesUnder(uploadDir)).toEqual([]);
  });

  it("still passes the original error on when there is nothing to delete", async () => {
    writeFile.mockRejectedValueOnce(Object.assign(new Error("permission denied"), { code: "EACCES" }));

    await expect(
      storage.put(Buffer.from("x"), { orgId: "org-1", eventId: "evt-1", scope: "event", ext: ".csv" }),
    ).rejects.toMatchObject({ code: "EACCES" });
  });

  it("keeps working: a write that succeeds leaves its file", async () => {
    const { key } = await storage.put(Buffer.from("rows"), { orgId: "org-1", eventId: "evt-1", scope: "event", ext: ".csv" });

    expect(existsSync(join(uploadDir, key))).toBe(true);
  });
});
