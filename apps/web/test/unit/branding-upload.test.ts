import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BrandingUploadError,
  resolveUploadDir,
  saveBrandingUpload,
  saveEventUpload,
} from "../../src/admin/branding-upload.js";

/** Minimal valid 1×1 PNG (89 bytes). */
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function pngFile(name = "logo.png"): File {
  return new File([PNG_BYTES], name, { type: "image/png" });
}

let uploadDir: string;

beforeEach(() => {
  uploadDir = mkdtempSync(join(tmpdir(), "admitto-branding-upload-"));
  process.env.UPLOAD_DIR = uploadDir;
});

afterEach(() => {
  delete process.env.UPLOAD_DIR;
  rmSync(uploadDir, { recursive: true, force: true });
});

describe("saveBrandingUpload", () => {
  it("writes org-level files under uploads/{orgId}/", async () => {
    const result = await saveBrandingUpload(pngFile(), "default");
    expect(result.url).toMatch(/^\/uploads\/default\/[0-9a-f-]+\.png$/);

    const rel = result.url.slice("/uploads/".length);
    const diskPath = join(resolveUploadDir(), rel);
    expect(readFileSync(diskPath).equals(PNG_BYTES)).toBe(true);
  });
});

describe("saveEventUpload", () => {
  it("writes event-level files under uploads/{orgId}/events/{eventId}/", async () => {
    const result = await saveEventUpload(pngFile(), "default", "evt-demo");
    expect(result.url).toMatch(/^\/uploads\/default\/events\/evt-demo\/[0-9a-f-]+\.png$/);

    const rel = result.url.slice("/uploads/".length);
    const diskPath = join(resolveUploadDir(), rel);
    expect(readFileSync(diskPath).equals(PNG_BYTES)).toBe(true);
  });

  it("rejects invalid event IDs", async () => {
    await expect(saveEventUpload(pngFile(), "default", "../escape")).rejects.toBeInstanceOf(
      BrandingUploadError,
    );
  });
});
