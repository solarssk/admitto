import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BrandingUploadError,
  absolutePathUnderUploadRoot,
  assertDecodedImageWithinLimits,
  bestEffortDeleteReplacedUploadUrls,
  bestEffortDeleteUploadUrl,
  deleteBrandingUploadByUrl,
  parseUploadsUrl,
  resolveUploadDir,
  saveBrandingUpload,
  saveEventUpload,
  saveThemeFontUpload,
} from "../../src/admin/branding-upload.js";

/** Minimal valid 1×1 PNG (transparent). */
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
/** JPEG magic only - not a decodable image (sharp must reject). */
const JPEG_MAGIC_ONLY = Buffer.from([0xff, 0xd8, 0xff]);
/** Minimal RIFF/WEBP header only - not a decodable image. */
const WEBP_MAGIC_ONLY = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBP", "ascii"),
]);
const WOFF_BYTES = Buffer.from("wOFF", "ascii");
const OTF_BYTES = Buffer.from("OTTO", "ascii");
const TTF_BYTES = Buffer.from([0x00, 0x01, 0x00, 0x00]);

function pngFile(name = "logo.png"): File {
  return new File([PNG_BYTES], name, { type: "image/png" });
}

let uploadDir: string;
let savedUploadDir: string | undefined;
let jpegBytes: Buffer;
let webpBytes: Buffer;

beforeEach(async () => {
  savedUploadDir = process.env.UPLOAD_DIR;
  uploadDir = mkdtempSync(join(tmpdir(), "admitto-branding-upload-"));
  process.env.UPLOAD_DIR = uploadDir;
  jpegBytes = await sharp({
    create: { width: 1, height: 1, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .jpeg()
    .toBuffer();
  webpBytes = await sharp({
    create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .webp()
    .toBuffer();
});

afterEach(() => {
  if (savedUploadDir === undefined) {
    delete process.env.UPLOAD_DIR;
  } else {
    process.env.UPLOAD_DIR = savedUploadDir;
  }
  rmSync(uploadDir, { recursive: true, force: true });
});

describe("resolveUploadDir", () => {
  it("falls back to ./uploads under cwd when UPLOAD_DIR is unset", () => {
    delete process.env.UPLOAD_DIR;
    expect(resolveUploadDir()).toBe(join(process.cwd(), "uploads"));
  });
});

describe("saveBrandingUpload", () => {
  it("writes a re-encoded PNG under uploads/{orgId}/", async () => {
    const result = await saveBrandingUpload(pngFile(), "default");
    expect(result.url).toMatch(/^\/uploads\/default\/[0-9a-f-]+\.png$/);
    expect(result.mimeType).toBe("image/png");
    expect(result.sizeBytes).toBeGreaterThan(0);

    const rel = result.url.slice("/uploads/".length);
    const diskPath = join(resolveUploadDir(), rel);
    const onDisk = readFileSync(diskPath);
    // Re-encode may change bytes; must remain a PNG and not be the raw client buffer when EXIF-like
    // garbage would have survived (here: still a valid PNG signature).
    expect(onDisk.subarray(0, 8).equals(PNG_BYTES.subarray(0, 8))).toBe(true);
    expect(onDisk).toHaveLength(result.sizeBytes);
  });

  it("strips EXIF and normalizes orientation on JPEG re-encode", async () => {
    const oriented = await sharp({
      create: { width: 4, height: 2, channels: 3, background: { r: 200, g: 40, b: 40 } },
    })
      .withMetadata({
        orientation: 6,
        exif: {
          IFD0: { Copyright: "synthetic-fixture@example.com" },
        },
      })
      .jpeg()
      .toBuffer();
    const before = await sharp(oriented).metadata();
    expect(before.orientation).toBe(6);
    expect(before.exif).toBeDefined();

    const result = await saveBrandingUpload(
      new File([oriented], "oriented.jpg", { type: "image/jpeg" }),
      "default",
    );
    const rel = result.url.slice("/uploads/".length);
    const onDisk = readFileSync(join(resolveUploadDir(), rel));
    const after = await sharp(onDisk).metadata();
    expect(after.orientation === undefined || after.orientation === 1).toBe(true);
    expect(after.exif).toBeUndefined();
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.sizeBytes).toBe(onDisk.length);
  });

  it("accepts decodable JPEG and WEBP and rejects magic-only stubs", async () => {
    const jpeg = await saveBrandingUpload(new File([jpegBytes], "logo.jpg", { type: "image/jpeg" }), "default");
    expect(jpeg.url).toMatch(/\.jpg$/);
    expect(jpeg.mimeType).toBe("image/jpeg");

    const webp = await saveBrandingUpload(new File([webpBytes], "logo.webp", { type: "image/webp" }), "default");
    expect(webp.url).toMatch(/\.webp$/);
    expect(webp.mimeType).toBe("image/webp");

    await expect(
      saveBrandingUpload(new File([JPEG_MAGIC_ONLY], "logo.jpg", { type: "image/jpeg" }), "default"),
    ).rejects.toMatchObject({ code: "invalid_image", status: 400 });
    await expect(
      saveBrandingUpload(new File([WEBP_MAGIC_ONLY], "logo.webp", { type: "image/webp" }), "default"),
    ).rejects.toMatchObject({ code: "invalid_image", status: 400 });
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

  it("accepts a file with no declared Content-Type at all, skipping the cross-check entirely", async () => {
    const noType = new File([PNG_BYTES], "logo.png", { type: "" });
    const result = await saveBrandingUpload(noType, "default");
    expect(result.url).toMatch(/\.png$/);
  });

  it("rejects bytes that are not a known image type (415)", async () => {
    const bogus = new File([Buffer.from("not-an-image")], "logo.png", { type: "image/png" });
    await expect(saveBrandingUpload(bogus, "default")).rejects.toMatchObject({
      code: "unsupported_file_type",
      status: 415,
    });
  });

  it("rejects decoded images larger than the max edge", async () => {
    const wide = await sharp({
      create: { width: 8193, height: 1, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    await expect(
      saveBrandingUpload(new File([wide], "wide.png", { type: "image/png" }), "default"),
    ).rejects.toMatchObject({ code: "invalid_image", status: 400 });
  });

  it("rejects decoded images over the total pixel budget without allocating a huge raster", () => {
    expect(() => assertDecodedImageWithinLimits(4096, 4096)).not.toThrow();
    expect(() => assertDecodedImageWithinLimits(5000, 4000)).toThrow(BrandingUploadError);
    try {
      assertDecodedImageWithinLimits(5000, 4000);
    } catch (err) {
      expect(err).toMatchObject({ code: "invalid_image", status: 400 });
    }
  });
});

describe("reencodeBrandingImage", () => {
  it("rejects an unsupported mime after a successful decode", async () => {
    const { reencodeBrandingImage } = await import("../../src/admin/branding-upload.js");
    await expect(reencodeBrandingImage(PNG_BYTES, "image/gif")).rejects.toMatchObject({
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
    const onDisk = readFileSync(diskPath);
    expect(onDisk.subarray(0, 8).equals(PNG_BYTES.subarray(0, 8))).toBe(true);
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

  it("accepts fonts with empty or generic declared MIME when magic bytes match", async () => {
    const empty = await saveThemeFontUpload(new File([WOFF_BYTES], "Brand.woff", { type: "" }), "default");
    expect(empty.url).toMatch(/\.woff$/);
    const octet = await saveThemeFontUpload(
      new File([WOFF_BYTES], "Brand.woff", { type: "application/octet-stream" }),
      "default",
    );
    expect(octet.url).toMatch(/\.woff$/);
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

const UUID_PNG = "a1b2c3d4-e5f6-7890-abcd-ef1234567890.png";
const UUID_WOFF2 = "b2c3d4e5-f6a7-8901-bcde-f12345678901.woff2";
const UUID_EVENT_PNG = "c3d4e5f6-a7b8-9012-cdef-123456789012.png";

describe("parseUploadsUrl", () => {
  it("parses org, theme, and event paths", () => {
    expect(parseUploadsUrl(`/uploads/default/${UUID_PNG}`)).toEqual({
      orgId: "default",
      kind: "org",
      filename: UUID_PNG,
      relativePath: `default/${UUID_PNG}`,
    });
    expect(parseUploadsUrl(`/uploads/default/theme/${UUID_WOFF2}`)).toEqual({
      orgId: "default",
      kind: "theme",
      filename: UUID_WOFF2,
      relativePath: `default/theme/${UUID_WOFF2}`,
    });
    expect(parseUploadsUrl(`/uploads/default/events/evt-1/${UUID_EVENT_PNG}`)).toEqual({
      orgId: "default",
      kind: "event",
      eventId: "evt-1",
      filename: UUID_EVENT_PNG,
      relativePath: `default/events/evt-1/${UUID_EVENT_PNG}`,
    });
  });

  it("rejects traversal, wrong shape, and non-UUID filenames", () => {
    expect(() => parseUploadsUrl("/uploads/default/../etc/passwd")).toThrow(BrandingUploadError);
    expect(() => parseUploadsUrl("/uploads/default/not-a-uuid.png")).toThrow(BrandingUploadError);
    expect(() => parseUploadsUrl("https://cdn.example.com/logo.png")).toThrow(BrandingUploadError);
    expect(() => parseUploadsUrl(`/uploads/default/events/${UUID_EVENT_PNG}`)).toThrow(
      BrandingUploadError,
    );
    expect(() => parseUploadsUrl("/uploads/default/")).toThrow(BrandingUploadError);
    expect(() => parseUploadsUrl("/uploads//default/x.png")).toThrow(BrandingUploadError);
    expect(() => parseUploadsUrl(`/uploads/default/theme/not-uuid.woff2`)).toThrow(BrandingUploadError);
    expect(() => parseUploadsUrl(`/uploads/default/events/evt-1/not-uuid.png`)).toThrow(
      BrandingUploadError,
    );
    expect(() => parseUploadsUrl(`/uploads/default/?q=1`)).toThrow(BrandingUploadError);
    expect(() => parseUploadsUrl(`/uploads/default/./${UUID_PNG}`)).toThrow(BrandingUploadError);
    expect(() => parseUploadsUrl(`/uploads/default//${UUID_PNG}`)).toThrow(BrandingUploadError);
  });
});

describe("absolutePathUnderUploadRoot", () => {
  it("rejects a relative path that escapes the upload root", () => {
    expect(() => absolutePathUnderUploadRoot("../outside.png")).toThrow(BrandingUploadError);
  });

  it("accepts a path under the upload root", () => {
    const abs = absolutePathUnderUploadRoot(`default/${UUID_PNG}`);
    expect(abs.startsWith(uploadDir)).toBe(true);
  });
});

describe("deleteBrandingUploadByUrl", () => {
  it("unlinks a managed file and treats missing as success", async () => {
    const result = await saveBrandingUpload(pngFile(), "default");
    const abs = join(uploadDir, result.url.slice("/uploads/".length));
    expect(existsSync(abs)).toBe(true);

    await deleteBrandingUploadByUrl(result.url, { expectedOrgId: "default" });
    expect(existsSync(abs)).toBe(false);

    await deleteBrandingUploadByUrl(result.url, { expectedOrgId: "default" });
  });

  it("rejects org mismatch", async () => {
    const result = await saveBrandingUpload(pngFile(), "default");
    await expect(
      deleteBrandingUploadByUrl(result.url, { expectedOrgId: "other" }),
    ).rejects.toMatchObject({ code: "invalid_upload_url" });
  });

  it("rejects eventId mismatch for event-scoped URLs", async () => {
    const result = await saveEventUpload(pngFile(), "default", "evt-a");
    await expect(
      deleteBrandingUploadByUrl(result.url, {
        expectedOrgId: "default",
        expectedEventId: "evt-b",
      }),
    ).rejects.toMatchObject({ code: "invalid_upload_url" });
  });

  it("rethrows non-ENOENT unlink failures", async () => {
    const result = await saveBrandingUpload(pngFile(), "default");
    const abs = join(uploadDir, result.url.slice("/uploads/".length));
    unlinkSync(abs);
    mkdirSync(abs);
    await expect(deleteBrandingUploadByUrl(result.url, { expectedOrgId: "default" })).rejects.toMatchObject({
      code: expect.not.stringMatching(/^ENOENT$/),
    });
  });
});

describe("bestEffortDeleteUploadUrl / bestEffortDeleteReplacedUploadUrls", () => {
  const orgTrust = { expectedOrgId: "default", expectedKind: "org" as const };

  it("deletes only replaced managed URLs and ignores external URLs", async () => {
    const kept = await saveBrandingUpload(pngFile(), "default");
    const gone = await saveBrandingUpload(pngFile(), "default");
    const goneAbs = join(uploadDir, gone.url.slice("/uploads/".length));
    const keptAbs = join(uploadDir, kept.url.slice("/uploads/".length));

    await bestEffortDeleteReplacedUploadUrls(
      [gone.url, kept.url, "https://cdn.example.com/x.png"],
      [kept.url],
      orgTrust,
    );
    expect(existsSync(goneAbs)).toBe(false);
    expect(existsSync(keptAbs)).toBe(true);

    await bestEffortDeleteUploadUrl("not-an-upload", orgTrust);
    await bestEffortDeleteUploadUrl(`/uploads/default/${UUID_PNG}`, orgTrust);
  });

  it("refuses to delete another event's managed upload (trusted owner)", async () => {
    const other = await saveEventUpload(pngFile(), "default", "evt-other");
    const otherAbs = join(uploadDir, other.url.slice("/uploads/".length));
    expect(existsSync(otherAbs)).toBe(true);

    await bestEffortDeleteReplacedUploadUrls(
      [other.url],
      [null],
      { expectedOrgId: "default", expectedKind: "event", expectedEventId: "evt-mine" },
    );
    expect(existsSync(otherAbs)).toBe(true);

    await bestEffortDeleteReplacedUploadUrls(
      [other.url],
      [null],
      { expectedOrgId: "default", expectedKind: "event", expectedEventId: "evt-other" },
    );
    expect(existsSync(otherAbs)).toBe(false);
  });

  it("skips unlink when isStillReferenced reports the URL is live again", async () => {
    const gone = await saveBrandingUpload(pngFile(), "default");
    const goneAbs = join(uploadDir, gone.url.slice("/uploads/".length));

    await bestEffortDeleteReplacedUploadUrls([gone.url], [null], orgTrust, {
      isStillReferenced: async () => true,
    });
    expect(existsSync(goneAbs)).toBe(true);

    await bestEffortDeleteReplacedUploadUrls([gone.url], [null], orgTrust, {
      isStillReferenced: async () => false,
    });
    expect(existsSync(goneAbs)).toBe(false);
  });
});
