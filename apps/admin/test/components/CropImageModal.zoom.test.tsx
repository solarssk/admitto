// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CropImageModal } from "../../src/components/crop/CropImageModal.js";

afterEach(() => {
  cleanup();
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
});
