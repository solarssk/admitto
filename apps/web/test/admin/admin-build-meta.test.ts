import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { adminDistCandidates, readAdminBuildMeta } from "../../src/admin/admin-build-meta.js";

describe("adminDistCandidates", () => {
  it("resolves the same relative roots as staff-spa", () => {
    const paths = adminDistCandidates("file:///repo/apps/web/src/admin/admin-build-meta.ts");
    expect(paths).toHaveLength(3);
    expect(paths[0]).toMatch(/admin[/\\]dist$/);
    expect(paths[1]).toMatch(/apps[/\\]admin[/\\]dist$/);
    expect(paths[2]).toMatch(/admin[/\\]dist$/);
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

  it("returns null for an empty commit or version", async () => {
    root = await mkdtemp(join(tmpdir(), "admitto-build-meta-"));
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "build-meta.json"),
      JSON.stringify({ version: "  ", commit: "abc" }),
      "utf8",
    );
    expect(readAdminBuildMeta(root)).toBeNull();
    await writeFile(
      join(root, "build-meta.json"),
      JSON.stringify({ version: "0.4.12", commit: "   " }),
      "utf8",
    );
    expect(readAdminBuildMeta(root)).toBeNull();
  });

  it("scans default candidates when distRoot is omitted", () => {
    // May resolve ambient apps/admin/dist after a local build, or null - either exercises the scan.
    const meta = readAdminBuildMeta();
    if (meta) {
      expect(meta.version.length).toBeGreaterThan(0);
      expect(meta.commit).toMatch(/^[0-9a-f]{7}$|^unknown$/);
    } else {
      expect(meta).toBeNull();
    }
  });
});
