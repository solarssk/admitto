import { describe, expect, it, vi } from "vitest";

describe("writeValidatedUpload post-transform size limit", () => {
  it("rejects when re-encode output exceeds the branding size cap", async () => {
    vi.resetModules();
    vi.doMock("sharp", () => {
      const chain = {
        metadata: vi.fn(async () => ({ width: 1, height: 1 })),
        rotate: vi.fn(() => chain),
        png: vi.fn(() => chain),
        jpeg: vi.fn(() => chain),
        webp: vi.fn(() => chain),
        toBuffer: vi.fn(async () => Buffer.alloc(2 * 1024 * 1024 + 10)),
      };
      const sharpMock = Object.assign(
        vi.fn(() => chain),
        { // keep callable default export shape
        },
      );
      return { default: sharpMock };
    });

    const { BrandingUploadError, saveBrandingUpload } = await import(
      "../../src/admin/branding-upload.js"
    );
    // Tiny PNG magic so detectMime accepts it before the mocked re-encode.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    await expect(saveBrandingUpload(new File([png], "logo.png", { type: "image/png" }), "default")).rejects.toBeInstanceOf(
      BrandingUploadError,
    );
    await expect(
      saveBrandingUpload(new File([png], "logo.png", { type: "image/png" }), "default"),
    ).rejects.toMatchObject({ code: "file_too_large", status: 413 });

    vi.doUnmock("sharp");
    vi.resetModules();
  });
});
