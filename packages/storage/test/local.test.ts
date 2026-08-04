import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LocalStorageAdapter,
  StoragePathError,
  absolutePathUnderUploadRoot,
  createStorage,
  resolveUploadDir,
} from "../src/index.js";

describe("resolveUploadDir", () => {
  it("falls back to ./uploads under cwd when UPLOAD_DIR is unset", () => {
    expect(resolveUploadDir({})).toBe(join(process.cwd(), "uploads"));
  });

  it("uses UPLOAD_DIR when set", () => {
    expect(resolveUploadDir({ UPLOAD_DIR: "/tmp/admitto-uploads" })).toBe("/tmp/admitto-uploads");
  });
});

describe("createStorage", () => {
  it("defaults to local", () => {
    expect(createStorage({}).provider).toBe("local");
  });

  it("throws a clear error for s3 (not implemented)", () => {
    expect(() => createStorage({ STORAGE_PROVIDER: "s3" })).toThrow(/not implemented/i);
  });

  it("throws for an unknown provider", () => {
    expect(() => createStorage({ STORAGE_PROVIDER: "gcs" })).toThrow(/Unknown STORAGE_PROVIDER/);
  });
});

describe("LocalStorageAdapter", () => {
  let uploadDir: string;
  let storage: LocalStorageAdapter;

  beforeEach(() => {
    uploadDir = mkdtempSync(join(tmpdir(), "admitto-storage-"));
    storage = new LocalStorageAdapter({ UPLOAD_DIR: uploadDir });
  });

  afterEach(() => {
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it("put writes under UPLOAD_DIR and returns /uploads/… url + key", async () => {
    const bytes = Buffer.from("hello");
    const result = await storage.put(bytes, { orgId: "default", scope: "org", ext: ".png" });
    expect(result.url).toMatch(/^\/uploads\/default\/[0-9a-f-]{36}\.png$/);
    expect(result.key).toBe(result.url.slice("/uploads/".length));
    expect(existsSync(join(uploadDir, result.key))).toBe(true);
    expect(readFileSync(join(uploadDir, result.key))).toEqual(bytes);
  });

  it("put writes theme and event keys under the expected layout", async () => {
    const theme = await storage.put(Buffer.from("font"), {
      orgId: "default",
      scope: "theme",
      ext: ".woff2",
    });
    expect(theme.key).toMatch(/^default\/theme\/[0-9a-f-]{36}\.woff2$/);

    const event = await storage.put(Buffer.from("img"), {
      orgId: "default",
      eventId: "evt-1",
      scope: "event",
      ext: ".jpg",
    });
    expect(event.key).toMatch(/^default\/events\/evt-1\/[0-9a-f-]{36}\.jpg$/);
  });

  it("delete is idempotent on a missing key", async () => {
    const key = "default/00000000-0000-0000-0000-000000000001.png";
    expect(await storage.delete(key)).toEqual({ deleted: false });
  });

  it("delete removes an existing object once", async () => {
    const { key } = await storage.put(Buffer.from("x"), {
      orgId: "default",
      scope: "org",
      ext: ".png",
    });
    expect(await storage.delete(key)).toEqual({ deleted: true });
    expect(existsSync(join(uploadDir, key))).toBe(false);
    expect(await storage.delete(key)).toEqual({ deleted: false });
  });

  it("exists reports presence", async () => {
    const { key } = await storage.put(Buffer.from("x"), {
      orgId: "default",
      scope: "org",
      ext: ".png",
    });
    expect(await storage.exists(key)).toBe(true);
    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
  });

  it("rejects a key that escapes the upload root", () => {
    expect(() => absolutePathUnderUploadRoot("../outside.png", { UPLOAD_DIR: uploadDir })).toThrow(
      StoragePathError,
    );
  });

  it("delete rejects a key that escapes the upload root", async () => {
    await expect(storage.delete("../outside.png")).rejects.toBeInstanceOf(StoragePathError);
  });

  it("absolutePathUnderUploadRoot accepts a path under the upload root", () => {
    const abs = absolutePathUnderUploadRoot(
      "default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png",
      { UPLOAD_DIR: uploadDir },
    );
    expect(abs.startsWith(uploadDir)).toBe(true);
  });

  it("put rejects a path-escaping org id", async () => {
    await expect(
      storage.put(Buffer.from("x"), { orgId: "../escape", scope: "org", ext: ".png" }),
    ).rejects.toBeInstanceOf(StoragePathError);
  });
});
