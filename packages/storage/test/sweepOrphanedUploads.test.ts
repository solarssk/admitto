import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { LocalStorageAdapter, sweepOrphanedUploads } from "../src/index.js";

vi.mock("@admitto/auth", () => ({
  getBrandingTheme: vi.fn().mockResolvedValue({}),
}));

const REFERENCED_KEY = "default/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png";
const ORPHAN_OLD_KEY = "default/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.png";
const ORPHAN_NEW_KEY = "default/cccccccc-cccc-cccc-cccc-cccccccccccc.png";
const RACE_KEY = "default/dddddddd-dddd-dddd-dddd-dddddddddddd.png";

function emptyDbReferencing(keys: string[]): PrismaClient {
  const urls = keys.map((k) => `/uploads/${k}`);
  const urlSet = new Set(urls);
  const matchUrl = (where: { OR?: Array<Record<string, string>> } | undefined) => {
    for (const clause of where?.OR ?? []) {
      for (const value of Object.values(clause)) {
        if (typeof value === "string" && urlSet.has(value)) return { id: "hit" };
      }
    }
    return null;
  };

  return {
    organization: {
      findMany: vi.fn().mockResolvedValue(
        urls.length
          ? [{ logo_url: urls[0], logo_original_url: null, header_image_url: null }]
          : [],
      ),
      findFirst: vi.fn().mockImplementation(async ({ where }) => matchUrl(where)),
    },
    event: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    eventImageAsset: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    mailTemplate: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  } as unknown as PrismaClient;
}

describe("sweepOrphanedUploads", () => {
  let uploadDir: string;
  let storage: LocalStorageAdapter;
  const nowMs = Date.parse("2026-08-04T12:00:00.000Z");
  const oldMs = nowMs - 72 * 60 * 60 * 1000;
  const recentMs = nowMs - 1 * 60 * 60 * 1000;

  beforeEach(() => {
    uploadDir = mkdtempSync(join(tmpdir(), "admitto-gc-"));
    storage = new LocalStorageAdapter({ UPLOAD_DIR: uploadDir });
    mkdirSync(join(uploadDir, "default"), { recursive: true });
    for (const [key, mtime] of [
      [REFERENCED_KEY, oldMs],
      [ORPHAN_OLD_KEY, oldMs],
      [ORPHAN_NEW_KEY, recentMs],
    ] as const) {
      const abs = join(uploadDir, key);
      writeFileSync(abs, Buffer.from(`data-${key}`));
      const sec = mtime / 1000;
      utimesSync(abs, sec, sec);
    }
  });

  afterEach(() => {
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it("keeps referenced files and too-new orphans; deletes old orphans only when not dry-run", async () => {
    const db = emptyDbReferencing([REFERENCED_KEY]);

    const dry = await sweepOrphanedUploads(db, storage, {
      dryRun: true,
      graceHours: 48,
      nowMs,
    });
    expect(dry).toMatchObject({
      dryRun: true,
      scanned: 3,
      referenced: 1,
      tooNew: 1,
      deleted: 1,
    });
    expect(await storage.exists(ORPHAN_OLD_KEY)).toBe(true);

    const real = await sweepOrphanedUploads(db, storage, {
      dryRun: false,
      graceHours: 48,
      nowMs,
    });
    expect(real).toMatchObject({
      dryRun: false,
      scanned: 3,
      referenced: 1,
      tooNew: 1,
      deleted: 1,
    });
    expect(real.bytesReclaimed).toBeGreaterThan(0);
    expect(await storage.exists(REFERENCED_KEY)).toBe(true);
    expect(await storage.exists(ORPHAN_NEW_KEY)).toBe(true);
    expect(await storage.exists(ORPHAN_OLD_KEY)).toBe(false);
  });

  it("rechecks references before delete so a concurrent save keeps the file", async () => {
    writeFileSync(join(uploadDir, RACE_KEY), Buffer.from("race"));
    utimesSync(join(uploadDir, RACE_KEY), oldMs / 1000, oldMs / 1000);

    const raceUrl = `/uploads/${RACE_KEY}`;
    const db = {
      organization: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          for (const clause of where?.OR ?? []) {
            if (Object.values(clause).includes(raceUrl)) return { id: "org" };
          }
          return null;
        }),
      },
      event: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      eventImageAsset: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      mailTemplate: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaClient;

    // Only race file in dir for a clear count: wipe the beforeEach trio.
    for (const key of [REFERENCED_KEY, ORPHAN_OLD_KEY, ORPHAN_NEW_KEY]) {
      rmSync(join(uploadDir, key), { force: true });
    }

    const result = await sweepOrphanedUploads(db, storage, {
      dryRun: false,
      graceHours: 48,
      nowMs,
    });
    expect(result).toMatchObject({ scanned: 1, referenced: 1, deleted: 0 });
    expect(await storage.exists(RACE_KEY)).toBe(true);
  });

  it("defaults invalid graceHours and skips when delete reports missing", async () => {
    for (const key of [REFERENCED_KEY, ORPHAN_NEW_KEY]) {
      rmSync(join(uploadDir, key), { force: true });
    }
    const db = emptyDbReferencing([]);
    const deleteSpy = vi.spyOn(storage, "delete").mockResolvedValue({ deleted: false });

    const result = await sweepOrphanedUploads(db, storage, {
      dryRun: false,
      graceHours: Number.NaN,
      nowMs,
    });
    expect(result.deleted).toBe(0);
    expect(deleteSpy).toHaveBeenCalled();
    deleteSpy.mockRestore();
  });

  it("uses Date.now when nowMs is omitted", async () => {
    for (const key of [REFERENCED_KEY, ORPHAN_OLD_KEY, ORPHAN_NEW_KEY]) {
      rmSync(join(uploadDir, key), { force: true });
    }
    const db = emptyDbReferencing([]);
    const result = await sweepOrphanedUploads(db, storage, { dryRun: true, graceHours: 0 });
    expect(result.scanned).toBe(0);
    expect(result.dryRun).toBe(true);
  });
});
