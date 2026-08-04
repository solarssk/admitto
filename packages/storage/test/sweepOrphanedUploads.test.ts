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

function emptyDbReferencing(keys: string[]): PrismaClient {
  const urls = keys.map((k) => `/uploads/${k}`);
  return {
    organization: {
      findMany: vi.fn().mockResolvedValue(
        urls.length
          ? [{ logo_url: urls[0], logo_original_url: null, header_image_url: null }]
          : [],
      ),
    },
    event: { findMany: vi.fn().mockResolvedValue([]) },
    eventImageAsset: { findMany: vi.fn().mockResolvedValue([]) },
    mailTemplate: { findMany: vi.fn().mockResolvedValue([]) },
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
});
