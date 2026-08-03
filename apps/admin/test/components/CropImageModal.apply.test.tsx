// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CropImageModal } from "../../src/components/crop/CropImageModal.js";

vi.mock("../../src/components/crop/getCroppedImageBlob.js", () => ({
  getCroppedImageBlob: vi.fn(),
}));

import { getCroppedImageBlob } from "../../src/components/crop/getCroppedImageBlob.js";

const mockGetCropped = vi.mocked(getCroppedImageBlob);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1400 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
  Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", {
    configurable: true,
    get() {
      return 400;
    },
  });
  Object.defineProperty(HTMLImageElement.prototype, "naturalHeight", {
    configurable: true,
    get() {
      return 80;
    },
  });
  Object.defineProperty(HTMLImageElement.prototype, "width", {
    configurable: true,
    get() {
      const w = (this as HTMLImageElement).style.width;
      return w ? Number.parseFloat(w) : 0;
    },
  });
  Object.defineProperty(HTMLImageElement.prototype, "height", {
    configurable: true,
    get() {
      const h = (this as HTMLImageElement).style.height;
      return h ? Number.parseFloat(h) : 0;
    },
  });
});

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function renderReadyCrop(props?: {
  onApply?: ReturnType<typeof vi.fn>;
  onCancel?: ReturnType<typeof vi.fn>;
  initialCrop?: { unit: "%"; x: number; y: number; width: number; height: number };
  initialZoom?: number;
}) {
  const onApply = props?.onApply ?? vi.fn();
  const onCancel = props?.onCancel ?? vi.fn();
  render(
    <CropImageModal
      open
      title="Adjust event logo"
      imageSrc={TINY_PNG}
      sourceMime="image/png"
      initialCrop={props?.initialCrop}
      initialZoom={props?.initialZoom}
      onCancel={onCancel}
      onApply={onApply}
    />,
  );
  const img = document.querySelector("img.crop-image-modal__img") as HTMLImageElement;
  expect(img).toBeTruthy();
  fireEvent.load(img);
  await waitFor(() => {
    expect(img.style.width).toBeTruthy();
  });
  await waitFor(() => {
    expect(document.querySelector(".ReactCrop__crop-selection")).toBeTruthy();
  });
  return { img, onApply, onCancel };
}

describe("CropImageModal apply / cancel", () => {
  it("does not render an img for untrusted preview schemes", () => {
    render(
      <CropImageModal
        open
        imageSrc="javascript:alert(1)"
        sourceMime="image/png"
        onCancel={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    expect(document.querySelector("img.crop-image-modal__img")).toBeNull();
  });

  it("calls onCancel from Cancel", async () => {
    const { onCancel } = await renderReadyCrop();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("Apply exports the crop blob and percent meta including zoom", async () => {
    mockGetCropped.mockResolvedValueOnce(new Blob(["cropped"], { type: "image/png" }));
    const { onApply } = await renderReadyCrop({
      initialCrop: { unit: "%", x: 10, y: 5, width: 60, height: 50 },
      initialZoom: 1.5,
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Zoom")).toHaveProperty("value", "1.5");
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() => {
      expect(mockGetCropped).toHaveBeenCalledOnce();
      expect(onApply).toHaveBeenCalledOnce();
    });
    const [, meta] = onApply.mock.calls[0]!;
    expect(meta).toEqual({
      crop: { unit: "%", x: 10, y: 5, width: 60, height: 50 },
      zoom: 1.5,
    });
  });

  it("shows an error when crop export fails", async () => {
    mockGetCropped.mockRejectedValueOnce(new Error("Could not encode cropped image."));
    await renderReadyCrop();
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/encode/i);
    });
  });
});
