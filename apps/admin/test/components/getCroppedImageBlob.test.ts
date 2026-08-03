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
    expect(resolveCropOutputMime("image/jpeg; charset=binary")).toBe("image/jpeg");
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

  it("rejects an empty crop selection", async () => {
    const image = {
      width: 100,
      height: 50,
      naturalWidth: 200,
      naturalHeight: 100,
    } as HTMLImageElement;
    await expect(
      getCroppedImageBlob(image, { x: 0, y: 0, width: 0, height: 10 }, "image/png"),
    ).rejects.toThrow(/crop area/i);
  });

  it("rejects a zero-sized displayed image before scaling", async () => {
    const image = {
      width: 0,
      height: 50,
      naturalWidth: 200,
      naturalHeight: 100,
    } as HTMLImageElement;
    await expect(
      getCroppedImageBlob(image, { x: 0, y: 0, width: 10, height: 10 }, "image/png"),
    ).rejects.toThrow(/Could not read this image/i);
  });

  it("rejects when the canvas context is unavailable", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const image = {
      width: 100,
      height: 50,
      naturalWidth: 200,
      naturalHeight: 100,
    } as HTMLImageElement;
    await expect(
      getCroppedImageBlob(image, { x: 0, y: 0, width: 10, height: 10 }, "image/png"),
    ).rejects.toThrow(/canvas/i);
  });

  it("rejects when toBlob returns null", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb: BlobCallback) => {
      cb(null);
    });
    const image = {
      width: 100,
      height: 50,
      naturalWidth: 200,
      naturalHeight: 100,
    } as HTMLImageElement;
    await expect(
      getCroppedImageBlob(image, { x: 0, y: 0, width: 10, height: 10 }, "image/png"),
    ).rejects.toThrow(/encode/i);
  });

  it("retries JPEG quality steps until the blob fits under 2 MB", async () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillRect: vi.fn(),
      drawImage,
    } as unknown as CanvasRenderingContext2D);

    const oversized = new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: "image/jpeg" });
    const ok = new Blob([new Uint8Array(10)], { type: "image/jpeg" });
    const toBlob = vi
      .fn()
      .mockImplementationOnce((cb: BlobCallback) => cb(oversized))
      .mockImplementationOnce((cb: BlobCallback) => cb(ok));
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(toBlob);

    const image = {
      width: 100,
      height: 50,
      naturalWidth: 200,
      naturalHeight: 100,
    } as HTMLImageElement;

    const blob = await getCroppedImageBlob(
      image,
      { x: 0, y: 0, width: 40, height: 20 },
      "image/jpeg",
    );
    expect(blob).toBe(ok);
    expect(toBlob).toHaveBeenCalledTimes(2);
    expect(toBlob.mock.calls[0]?.[2]).toBe(0.92);
    expect(toBlob.mock.calls[1]?.[2]).toBe(0.8);
  });

  it("rejects a PNG crop that stays larger than 2 MB", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb: BlobCallback) => {
      cb(new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: "image/png" }));
    });
    const image = {
      width: 100,
      height: 50,
      naturalWidth: 200,
      naturalHeight: 100,
    } as HTMLImageElement;
    await expect(
      getCroppedImageBlob(image, { x: 0, y: 0, width: 50, height: 25 }, "image/png"),
    ).rejects.toThrow(/2 MB/);
  });

  it("rejects JPEG/WebP when every quality step stays over 2 MB", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const oversized = new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: "image/jpeg" });
    const toBlob = vi.fn((cb: BlobCallback, _mime?: string, quality?: number) => {
      expect([0.92, 0.8, 0.65, 0.5]).toContain(quality);
      cb(oversized);
    });
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(toBlob);

    const image = {
      width: 100,
      height: 50,
      naturalWidth: 200,
      naturalHeight: 100,
    } as HTMLImageElement;
    await expect(
      getCroppedImageBlob(image, { x: 0, y: 0, width: 40, height: 20 }, "image/jpeg"),
    ).rejects.toThrow(/2 MB/);
    expect(toBlob).toHaveBeenCalledTimes(4);
    expect(toBlob.mock.calls.map((c) => c[2])).toEqual([0.92, 0.8, 0.65, 0.5]);
  });
});
