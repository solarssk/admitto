// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCroppedImageBlob,
  resolveCropOutputMime,
} from "../../src/components/crop/getCroppedImageBlob.js";

describe("resolveCropOutputMime", () => {
  it("keeps JPEG as JPEG (no alpha path)", () => {
    expect(resolveCropOutputMime("image/jpeg")).toBe("image/jpeg");
    expect(resolveCropOutputMime("image/jpg")).toBe("image/jpeg");
  });

  it("keeps WebP as WebP so alpha can survive", () => {
    expect(resolveCropOutputMime("image/webp")).toBe("image/webp");
  });

  it("defaults to PNG for PNG and unknown types", () => {
    expect(resolveCropOutputMime("image/png")).toBe("image/png");
    expect(resolveCropOutputMime("")).toBe("image/png");
  });
});

describe("getCroppedImageBlob", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("draws the crop without fillRect so PNG alpha is not painted white", async () => {
    const fillRect = vi.fn();
    const drawImage = vi.fn();
    const toBlob = vi.fn((cb: BlobCallback, mime?: string) => {
      cb(new Blob([new Uint8Array([1, 2, 3])], { type: mime ?? "image/png" }));
    });

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillRect,
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(toBlob);

    const image = {
      width: 100,
      height: 50,
      naturalWidth: 200,
      naturalHeight: 100,
    } as HTMLImageElement;

    const blob = await getCroppedImageBlob(
      image,
      { x: 10, y: 5, width: 80, height: 40 },
      "image/png",
    );

    expect(fillRect).not.toHaveBeenCalled();
    expect(drawImage).toHaveBeenCalledWith(
      image,
      20, // 10 * (200/100)
      10, // 5 * (100/50)
      160, // 80 * 2
      80, // 40 * 2
      0,
      0,
      160,
      80,
    );
    expect(blob.type).toBe("image/png");
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png", 1);
  });
});
