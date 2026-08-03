// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/components/crop/getCroppedImageBlob.js", () => ({
  getCroppedImageBlob: vi.fn().mockResolvedValue(new Blob(["ok"], { type: "image/png" })),
}));

vi.mock("react-image-crop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-image-crop")>();
  function MockReactCrop({
    onChange,
    onComplete,
    children,
  }: {
    onChange: (pixel: unknown, percent: unknown) => void;
    onComplete: (pixel: unknown, percent: unknown) => void;
    children: React.ReactNode;
  }) {
    return (
      <div data-testid="mock-react-crop">
        <button
          type="button"
          onClick={() => {
            onChange(
              { unit: "px", x: 1, y: 1, width: 20, height: 10 },
              { unit: "%", x: 5, y: 5, width: 40, height: 30 },
            );
            onComplete(
              { unit: "px", x: 1, y: 1, width: 20, height: 10 },
              { unit: "%", x: 5, y: 5, width: 40, height: 30 },
            );
          }}
        >
          set-percent-crop
        </button>
        <button
          type="button"
          onClick={() => {
            // Pixel-only crop state (no %) forces percentCropForApply conversion path.
            onChange({ unit: "px", x: 2, y: 2, width: 30, height: 15 }, undefined);
            onComplete({ unit: "px", x: 2, y: 2, width: 30, height: 15 }, undefined);
          }}
        >
          set-pixel-crop
        </button>
        <button
          type="button"
          onClick={() => {
            onComplete({ unit: "px", x: 0, y: 0, width: 0, height: 0 }, {
              unit: "%",
              x: 0,
              y: 0,
              width: 0,
              height: 0,
            });
          }}
        >
          set-zero-crop
        </button>
        {children}
      </div>
    );
  }
  return {
    ...actual,
    default: MockReactCrop,
    centerCrop: actual.centerCrop,
    convertToPercentCrop: actual.convertToPercentCrop,
    convertToPixelCrop: actual.convertToPixelCrop,
  };
});

import { CropImageModal } from "../../src/components/crop/CropImageModal.js";
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
      return w ? Number.parseFloat(w) : 400;
    },
  });
  Object.defineProperty(HTMLImageElement.prototype, "height", {
    configurable: true,
    get() {
      const h = (this as HTMLImageElement).style.height;
      return h ? Number.parseFloat(h) : 80;
    },
  });
});

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function openModal(onApply = vi.fn()) {
  render(
    <CropImageModal
      open
      imageSrc={TINY_PNG}
      sourceMime="image/png"
      onCancel={vi.fn()}
      onApply={onApply}
    />,
  );
  const img = document.querySelector("img.crop-image-modal__img") as HTMLImageElement;
  fireEvent.load(img);
  await waitFor(() => {
    expect(screen.getByTestId("mock-react-crop")).toBeTruthy();
  });
  return { onApply };
}

describe("CropImageModal ReactCrop callback edges", () => {
  it("invokes onChange/onComplete percent handlers from the crop UI", async () => {
    await openModal();
    fireEvent.click(screen.getByRole("button", { name: "set-percent-crop" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() => {
      expect(mockGetCropped).toHaveBeenCalled();
    });
  });

  it("converts a pixel crop to percent on Apply", async () => {
    const onApply = vi.fn();
    await openModal(onApply);
    fireEvent.click(screen.getByRole("button", { name: "set-pixel-crop" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() => {
      expect(onApply).toHaveBeenCalledOnce();
    });
    const meta = onApply.mock.calls[0]![1] as { crop: { unit: string } };
    expect(meta.crop.unit).toBe("%");
  });

  it("shows a hint when the completed crop has zero size", async () => {
    await openModal();
    fireEvent.click(screen.getByRole("button", { name: "set-zero-crop" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/Drag the edges/i);
    });
    expect(mockGetCropped).not.toHaveBeenCalled();
  });
});
