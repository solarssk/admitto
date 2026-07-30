import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BrandingUploadError,
  resolveUploadDir,
  saveBrandingUpload,
  saveEventUpload,
  saveThemeFontUpload,
} from "../../src/admin/branding-upload.js";

/** Minimal valid 1×1 PNG (89 bytes). */
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
/** JPEG magic bytes only (FF D8 FF) - detection reads the first 3 bytes, no full image needed. */
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff]);
/** Minimal RIFF/WEBP container header - detection reads bytes 0-3 ("RIFF") and 8-11 ("WEBP"). */
const WEBP_BYTES = Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP", "ascii")]);
const WOFF_BYTES = Buffer.from("wOFF", "ascii");
const OTF_BYTES = Buffer.from("OTTO", "ascii");
const TTF_BYTES = Buffer.from([0x00, 0x01, 0x00, 0x00]);

function pngFile(name = "logo.png"): File {
  return new File([PNG_BYTES], name, { type: "image/png" });
}

let uploadDir: string;
let savedUploadDir: string | undefined;

beforeEach(() => {
  savedUploadDir = process.env.UPLOAD_DIR;
  uploadDir = mkdtempSync(join(tmpdir(), "admitto-branding-upload-"));
  process.env.UPLOAD_DIR = uploadDir;
});

afterEach(() => {
  if (savedUploadDir === undefined) {
    delete process.env.UPLOAD_DIR;
  } else {
    process.env.UPLOAD_DIR = savedUploadDir;
  }
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

  it("detects JPEG and WEBP from magic bytes alone (not the declared Content-Type)", async () => {
    const jpeg = await saveBrandingUpload(new File([JPEG_BYTES], "logo.jpg", { type: "image/jpeg" }), "default");
    expect(jpeg.url).toMatch(/\.jpg$/);
    const webp = await saveBrandingUpload(new File([WEBP_BYTES], "logo.webp", { type: "image/webp" }), "default");
    expect(webp.url).toMatch(/\.webp$/);
  });

  it("rejects invalid org IDs", async () => {
    await expect(saveBrandingUpload(pngFile(), "../escape")).rejects.toBeInstanceOf(BrandingUploadError);
  });

  it("rejects a file larger than the branding image size limit", async () => {
    const oversized = new File([Buffer.alloc(2 * 1024 * 1024 + 1)], "logo.png", { type: "image/png" });
    await expect(saveBrandingUpload(oversized, "default")).rejects.toMatchObject({
      code: "file_too_large",
      status: 413,
    });
  });

  it("rejects a file whose declared Content-Type disagrees with its detected magic bytes", async () => {
    const mismatched = new File([PNG_BYTES], "logo.png", { type: "image/jpeg" });
    await expect(saveBrandingUpload(mismatched, "default")).rejects.toMatchObject({
      code: "unsupported_file_type",
      status: 415,
    });
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

describe("saveThemeFontUpload", () => {
  it("writes theme-level font files under uploads/{orgId}/theme/", async () => {
    const woff2 = Buffer.from("wOF2", "ascii");
    const result = await saveThemeFontUpload(new File([woff2], "Brand.woff2", { type: "font/woff2" }), "default");
    expect(result.url).toMatch(/^\/uploads\/default\/theme\/[0-9a-f-]+\.woff2$/);
  });

  it("detects WOFF, OTF, and TTF from magic bytes alone", async () => {
    const woff = await saveThemeFontUpload(new File([WOFF_BYTES], "Brand.woff", { type: "font/woff" }), "default");
    expect(woff.url).toMatch(/\.woff$/);
    const otf = await saveThemeFontUpload(new File([OTF_BYTES], "Brand.otf", { type: "font/otf" }), "default");
    expect(otf.url).toMatch(/\.otf$/);
    const ttf = await saveThemeFontUpload(new File([TTF_BYTES], "Brand.ttf", { type: "font/ttf" }), "default");
    expect(ttf.url).toMatch(/\.ttf$/);
  });

  it("rejects a file larger than the font size limit", async () => {
    const oversized = new File([Buffer.alloc(5 * 1024 * 1024 + 1)], "Brand.woff2", { type: "font/woff2" });
    await expect(saveThemeFontUpload(oversized, "default")).rejects.toMatchObject({
      code: "file_too_large",
      status: 413,
    });
  });

  it("rejects bytes that don't match any known font signature", async () => {
    const bogus = new File([Buffer.from("nope")], "Brand.woff2", { type: "font/woff2" });
    await expect(saveThemeFontUpload(bogus, "default")).rejects.toMatchObject({
      code: "unsupported_file_type",
      status: 415,
    });
  });
});
