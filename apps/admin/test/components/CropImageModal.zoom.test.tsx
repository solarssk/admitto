// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/components/crop/getCroppedImageBlob.js", () => ({
  getCroppedImageBlob: vi.fn(),
}));

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

async function renderReadyCrop() {
  render(
    <CropImageModal
      open
      title="Adjust event logo"
      imageSrc={TINY_PNG}
      sourceMime="image/png"
      onCancel={vi.fn()}
      onApply={vi.fn()}
    />,
  );
  const img = document.querySelector("img.crop-image-modal__img") as HTMLImageElement;
  expect(img).toBeTruthy();
  fireEvent.load(img);
  await waitFor(() => {
    expect(img.style.width).toBe("400px");
    expect(img.style.height).toBe("80px");
  });
  return img;
}

describe("CropImageModal zoom", () => {
  it("fits on load without leaving the image larger than the stage", async () => {
    const img = await renderReadyCrop();
    const stage = document.querySelector(".crop-image-modal__stage") as HTMLElement;
    expect(stage.style.width).toBe("400px");
    expect(stage.style.height).toBe("80px");
    expect(img.style.width).toBe(stage.style.width);
  });

  it("enlarges the displayed image when zoom moves", async () => {
    const img = await renderReadyCrop();
    fireEvent.change(screen.getByLabelText("Zoom"), { target: { value: "2" } });
    await waitFor(() => {
      expect(img.style.width).toBe("800px");
      expect(img.style.height).toBe("160px");
    });
    expect(document.querySelector(".crop-image-modal__stage--zoomed")).toBeTruthy();
  });

  it("zooms with the mouse wheel over the stage", async () => {
    const img = await renderReadyCrop();
    const stage = document.querySelector(".crop-image-modal__stage");
    stage!.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true }));
    await waitFor(() => {
      expect(Number.parseFloat(img.style.width)).toBeGreaterThan(400);
    });
  });

  it("keeps a percent-based crop so zoom scales the selection with the image", async () => {
    const img = await renderReadyCrop();
    await waitFor(() => {
      expect(document.querySelector(".ReactCrop__crop-selection")).toBeTruthy();
    });
    const before = document.querySelector(".ReactCrop__crop-selection") as HTMLElement;
    expect(before.style.width).toMatch(/%$/);

    fireEvent.change(screen.getByLabelText("Zoom"), { target: { value: "2" } });
    await waitFor(() => {
      expect(img.style.width).toBe("800px");
    });
    const after = document.querySelector(".ReactCrop__crop-selection") as HTMLElement;
    expect(after.style.width).toMatch(/%$/);
    expect(after.style.width).toBe(before.style.width);
  });

  it("restores initialCrop and initialZoom on open (Edit again)", async () => {
    render(
      <CropImageModal
        open
        title="Adjust event logo"
        imageSrc={TINY_PNG}
        sourceMime="image/png"
        initialCrop={{ unit: "%", x: 20, y: 10, width: 50, height: 40 }}
        initialZoom={2}
        onCancel={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    const img = document.querySelector("img.crop-image-modal__img") as HTMLImageElement;
    fireEvent.load(img);
    await waitFor(() => {
      expect(img.style.width).toBe("800px");
      expect(screen.getByLabelText("Zoom")).toHaveProperty("value", "2");
    });
    await waitFor(() => {
      const selection = document.querySelector(".ReactCrop__crop-selection") as HTMLElement;
      expect(selection?.style.width).toBe("50%");
      expect(selection?.style.height).toBe("40%");
    });
  });

  it("falls back to a centered crop when initialCrop is not restorable", async () => {
    render(
      <CropImageModal
        open
        imageSrc={TINY_PNG}
        sourceMime="image/png"
        initialCrop={{ unit: "%", x: 90, y: 0, width: 20, height: 10 }}
        initialZoom={Number.NaN}
        onCancel={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    const img = document.querySelector("img.crop-image-modal__img") as HTMLImageElement;
    fireEvent.load(img);
    await waitFor(() => {
      expect(screen.getByLabelText("Zoom")).toHaveProperty("value", "1");
    });
    await waitFor(() => {
      const selection = document.querySelector(".ReactCrop__crop-selection") as HTMLElement;
      expect(selection?.style.width).toBe("92%");
    });
  });

  it("zooms out with wheel and uses a larger step with Shift", async () => {
    const img = await renderReadyCrop();
    fireEvent.change(screen.getByLabelText("Zoom"), { target: { value: "2" } });
    await waitFor(() => {
      expect(img.style.width).toBe("800px");
    });
    const stage = document.querySelector(".crop-image-modal__stage")!;
    stage.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 100, shiftKey: true, bubbles: true, cancelable: true }),
    );
    await waitFor(() => {
      expect(Number.parseFloat(img.style.width)).toBeLessThan(800);
    });
  });

  it("ignores wheel zoom while Apply is in progress", async () => {
    mockGetCropped.mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves — keeps applying=true */
        }),
    );
    const img = await renderReadyCrop();
    await waitFor(() => {
      expect(document.querySelector(".ReactCrop__crop-selection")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() => {
      expect(mockGetCropped).toHaveBeenCalled();
      expect(screen.getByText("Working…")).toBeTruthy();
    });
    const widthBefore = Number.parseFloat(img.style.width);
    const stage = document.querySelector(".crop-image-modal__stage")!;
    stage.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true }));
    expect(Number.parseFloat(img.style.width)).toBe(widthBefore);
  });

  it("pans the stage when zoomed and ignores crop-handle targets", async () => {
    const img = await renderReadyCrop();
    fireEvent.change(screen.getByLabelText("Zoom"), { target: { value: "2" } });
    await waitFor(() => {
      expect(img.style.width).toBe("800px");
    });
    const stage = document.querySelector(".crop-image-modal__stage") as HTMLElement;
    Object.defineProperty(stage, "scrollLeft", { configurable: true, writable: true, value: 0 });
    Object.defineProperty(stage, "scrollTop", { configurable: true, writable: true, value: 0 });
    Object.defineProperty(stage, "clientWidth", { configurable: true, value: 400 });
    Object.defineProperty(stage, "clientHeight", { configurable: true, value: 80 });
    stage.setPointerCapture = vi.fn();
    stage.releasePointerCapture = vi.fn();
    stage.hasPointerCapture = vi.fn(() => true);

    fireEvent.pointerDown(stage, { button: 2, clientX: 10, clientY: 10 });
    expect(stage.scrollLeft).toBe(0);

    fireEvent.pointerDown(stage, { button: 0, clientX: 50, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(stage, { clientX: 20, clientY: 5, pointerId: 1 });
    expect(stage.scrollLeft).toBe(30);
    expect(stage.scrollTop).toBe(15);
    fireEvent.pointerUp(stage, { pointerId: 1 });
    expect(stage.releasePointerCapture).toHaveBeenCalled();

    const handle = document.createElement("div");
    handle.className = "ReactCrop__drag-handle";
    stage.appendChild(handle);
    fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10, bubbles: true });
    const leftAfterPan = stage.scrollLeft;
    fireEvent.pointerMove(stage, { clientX: 0, clientY: 0 });
    expect(stage.scrollLeft).toBe(leftAfterPan);
  });
});
