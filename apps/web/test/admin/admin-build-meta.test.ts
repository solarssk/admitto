import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  adminDistCandidates,
  readAdminBuildMeta,
  resolveDefaultAdminDistRoot,
} from "../../src/admin/admin-build-meta.js";

describe("adminDistCandidates", () => {
  it("resolves apps/admin/dist candidates from this package layout", () => {
    const paths = adminDistCandidates();
    expect(paths).toHaveLength(3);
    expect(paths[0]).toMatch(/admin[/\\]dist$/);
    expect(paths.some((p) => /apps[/\\]admin[/\\]dist$/.test(p))).toBe(true);
  });
});

describe("resolveDefaultAdminDistRoot", () => {
  it("returns a candidate path string", () => {
    const root = resolveDefaultAdminDistRoot();
    expect(root.length).toBeGreaterThan(0);
    expect(root).toMatch(/dist$/);
  });
});

describe("readAdminBuildMeta", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  it("reads version and short commit from build-meta.json", async () => {
    root = await mkdtemp(join(tmpdir(), "admitto-build-meta-"));
    await writeFile(
      join(root, "build-meta.json"),
      JSON.stringify({ version: "0.4.12", commit: "abcdef0123456789" }),
      "utf8",
    );
    expect(readAdminBuildMeta(root)).toEqual({ version: "0.4.12", commit: "abcdef0" });
  });

  it("returns null when build-meta.json is missing or invalid", async () => {
    root = await mkdtemp(join(tmpdir(), "admitto-build-meta-"));
    expect(readAdminBuildMeta(root)).toBeNull();
    await writeFile(join(root, "build-meta.json"), "{not-json", "utf8");
    expect(readAdminBuildMeta(root)).toBeNull();
    await writeFile(join(root, "build-meta.json"), JSON.stringify({ version: 1 }), "utf8");
    expect(readAdminBuildMeta(root)).toBeNull();
  });

  it("returns null for blank version or commit", async () => {
    root = await mkdtemp(join(tmpdir(), "admitto-build-meta-"));
    await mkdir(root, { recursive: true });
    for (const body of [
      { version: "  ", commit: "abc" },
      { version: "0.4.12", commit: "   " },
    ]) {
      await writeFile(join(root, "build-meta.json"), JSON.stringify(body), "utf8");
      expect(readAdminBuildMeta(root)).toBeNull();
    }
  });

  it("scans default candidates when distRoot is omitted", () => {
    const meta = readAdminBuildMeta();
    if (meta) {
      expect(meta.version.length).toBeGreaterThan(0);
      expect(meta.commit).toMatch(/^[0-9a-f]{7}$|^unknown$/);
    } else {
      expect(meta).toBeNull();
    }
  });
});
