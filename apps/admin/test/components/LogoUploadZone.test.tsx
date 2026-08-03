// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { ApiError } from "../../src/api/client.js";
import { LogoUploadZone } from "../../src/components/LogoUploadZone.js";
import { renderWithToast } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    uploadFile: vi.fn(),
  };
});

vi.mock("../../src/components/crop/CropImageModal.js", () => ({
  CropImageModal: ({
    open,
    imageSrc,
    initialCrop,
    onApply,
    onCancel,
  }: {
    open: boolean;
    imageSrc: string;
    initialCrop?: { unit: "%"; x: number; y: number; width: number; height: number };
    onApply: (
      blob: Blob,
      meta: { crop: { unit: "%"; x: number; y: number; width: number; height: number }; zoom: number },
    ) => void | Promise<void>;
    onCancel: () => void;
  }) =>
    open ? (
      <div
        role="dialog"
        aria-label="Adjust image"
        data-image-src={imageSrc}
        data-initial-crop={initialCrop ? JSON.stringify(initialCrop) : ""}
      >
        <button
          type="button"
          onClick={() =>
            void onApply(new Blob(["x"], { type: "image/png" }), {
              crop: initialCrop ?? { unit: "%", x: 4, y: 4, width: 92, height: 92 },
              zoom: 1.5,
            })
          }
        >
          Apply changes
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    ) : null,
}));

import { uploadFile } from "../../src/api/client.js";

const mockUploadFile = vi.mocked(uploadFile);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LogoUploadZone", () => {
  it("shows drop zone when value is empty", () => {
    renderWithToast(<LogoUploadZone value="" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /drop logo here/i })).toBeTruthy();
  });

  it("shows the label heading by default", () => {
    renderWithToast(<LogoUploadZone value="" onChange={() => {}} label="Event logo" />);
    expect(screen.getByText("Event logo")).toBeTruthy();
  });

  it("hides the label heading when hideLabel is set, but keeps it for alt text and aria-label", () => {
    renderWithToast(
      <LogoUploadZone
        value="/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png"
        onChange={() => {}}
        label="Event logo"
        hideLabel
      />,
    );
    expect(screen.queryByText("Event logo")).toBeNull();
    expect(screen.getByAltText("Event logo preview")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove event logo" })).toBeTruthy();
  });

  it("shows preview, clear, replace, and edit for uploaded path", () => {
    renderWithToast(
      <LogoUploadZone
        value="/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png"
        onChange={() => {}}
      />,
    );
    expect(screen.getByAltText("Organisation logo preview")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove organisation logo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replace image" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit image" })).toBeTruthy();
    expect(screen.queryByText(/drop logo here/i)).toBeNull();
  });

  it("does not show Edit for external HTTPS logos", () => {
    renderWithToast(
      <LogoUploadZone value="https://cdn.example.com/logo.png" onChange={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: "Edit image" })).toBeNull();
  });

  it("does not preview invalid upload paths or URLs", () => {
    renderWithToast(<LogoUploadZone value="/uploads/default/../evil.png" onChange={() => {}} />);
    expect(screen.queryByAltText("Organisation logo preview")).toBeNull();
  });

  it("calls onChange and onSourceChange when clear is clicked", () => {
    const onChange = vi.fn();
    const onSourceChange = vi.fn();
    renderWithToast(
      <LogoUploadZone
        value="/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png"
        originalUrl="/uploads/default/orig.png"
        cropMeta={{ unit: "%", x: 0, y: 0, width: 100, height: 100, zoom: 1 }}
        onChange={onChange}
        onSourceChange={onSourceChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove organisation logo" }));
    expect(onChange).toHaveBeenCalledWith("");
    expect(onSourceChange).toHaveBeenCalledWith({ originalUrl: null, crop: null });
  });

  it("opens crop modal on file pick and uploads original then cropped after Apply", async () => {
    mockUploadFile
      .mockResolvedValueOnce({ url: "/uploads/default/new-original.png" })
      .mockResolvedValueOnce({ url: "/uploads/default/new.png" });
    const onChange = vi.fn();
    const onSourceChange = vi.fn();
    renderWithToast(
      <LogoUploadZone value="" onChange={onChange} onSourceChange={onSourceChange} />,
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "logo.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(mockUploadFile).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Adjust image" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() => {
      expect(mockUploadFile).toHaveBeenCalledTimes(2);
      expect(onChange).toHaveBeenCalledWith("/uploads/default/new.png");
      expect(onSourceChange).toHaveBeenCalledWith({
        originalUrl: "/uploads/default/new-original.png",
        crop: { unit: "%", x: 4, y: 4, width: 92, height: 92, zoom: 1.5 },
      });
    });
  });

  it("Edit image re-opens the original file, not the trimmed upload", async () => {
    mockUploadFile
      .mockResolvedValueOnce({ url: "/uploads/default/orig.png" })
      .mockResolvedValueOnce({ url: "/uploads/default/cropped.png" });
    function Harness() {
      const [value, setValue] = useState("");
      return <LogoUploadZone value={value} onChange={setValue} />;
    }
    renderWithToast(<Harness />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["full-original"], "hitachi.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    const firstSrc = screen.getByRole("dialog", { name: "Adjust image" }).getAttribute("data-image-src");
    expect(firstSrc?.startsWith("blob:")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Edit image" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit image" }));
    const editDialog = screen.getByRole("dialog", { name: "Adjust image" });
    const editSrc = editDialog.getAttribute("data-image-src");
    expect(editSrc?.startsWith("blob:")).toBe(true);
    expect(editSrc).not.toContain("/uploads/");
    // Last Apply framing is restored (mock stores the crop it applied).
    expect(editDialog.getAttribute("data-initial-crop")).toContain('"width":92');
  });

  it("Edit loads the persisted original URL and restores crop after reload", async () => {
    const crop = { unit: "%" as const, x: 10, y: 12, width: 80, height: 70, zoom: 1.8 };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(["full"], { type: "image/png" }),
      }),
    );
    renderWithToast(
      <LogoUploadZone
        value="/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png"
        originalUrl="/uploads/default/b2c3d4e5-f6a7-8901-bcde-f12345678901.png"
        cropMeta={crop}
        onChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit image" }));
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Adjust image" })).toBeTruthy();
    });
    const dialog = screen.getByRole("dialog", { name: "Adjust image" });
    expect(dialog.getAttribute("data-image-src")?.startsWith("blob:")).toBe(true);
    expect(dialog.getAttribute("data-initial-crop")).toContain('"x":10');
    expect(fetch).toHaveBeenCalledWith(
      "/uploads/default/b2c3d4e5-f6a7-8901-bcde-f12345678901.png",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    vi.unstubAllGlobals();
  });

  it("Edit after cancelling Replace still uses the saved original, not the cancelled file", async () => {
    const crop = { unit: "%" as const, x: 10, y: 12, width: 80, height: 70, zoom: 1.8 };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["saved-original"], { type: "image/png" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithToast(
      <LogoUploadZone
        value="/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png"
        originalUrl="/uploads/default/b2c3d4e5-f6a7-8901-bcde-f12345678901.png"
        cropMeta={crop}
        onChange={() => {}}
      />,
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["replacement"], "new.png", { type: "image/png" })] },
    });
    expect(screen.getByRole("dialog", { name: "Adjust image" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Adjust image" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit image" }));
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Adjust image" })).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/uploads/default/b2c3d4e5-f6a7-8901-bcde-f12345678901.png",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    vi.unstubAllGlobals();
  });

  it("Edit falls back to file picker when the persisted original cannot be fetched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        blob: async () => new Blob(),
      }),
    );
    renderWithToast(
      <LogoUploadZone
        value="/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png"
        originalUrl="/uploads/default/b2c3d4e5-f6a7-8901-bcde-f12345678901.png"
        cropMeta={{ unit: "%", x: 0, y: 0, width: 100, height: 100, zoom: 1 }}
        onChange={() => {}}
      />,
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: "Edit image" }));
    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalled();
      expect(screen.getByText(/Could not load the original image/i)).toBeTruthy();
    });
    expect(screen.queryByRole("dialog", { name: "Adjust image" })).toBeNull();
    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("Replace Apply uploads a new original and cropped pair and reports crop meta", async () => {
    mockUploadFile
      .mockResolvedValueOnce({ url: "/uploads/default/replaced-original.png" })
      .mockResolvedValueOnce({ url: "/uploads/default/replaced.png" });
    const onChange = vi.fn();
    const onSourceChange = vi.fn();
    renderWithToast(
      <LogoUploadZone
        value="/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png"
        originalUrl="/uploads/default/b2c3d4e5-f6a7-8901-bcde-f12345678901.png"
        cropMeta={{ unit: "%", x: 1, y: 1, width: 90, height: 90, zoom: 1 }}
        onChange={onChange}
        onSourceChange={onSourceChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Replace image" }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["new"], "new.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith("/uploads/default/replaced.png");
      expect(onSourceChange).toHaveBeenCalledWith({
        originalUrl: "/uploads/default/replaced-original.png",
        crop: { unit: "%", x: 4, y: 4, width: 92, height: 92, zoom: 1.5 },
      });
    });
  });

  it("Edit without an in-memory original asks for the full file again", async () => {
    renderWithToast(
      <LogoUploadZone
        value="/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png"
        onChange={() => {}}
      />,
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: "Edit image" }));
    expect(clickSpy).toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Adjust image" })).toBeNull();
    await waitFor(() => {
      expect(screen.getByText(/original image is not available/i)).toBeTruthy();
    });
    clickSpy.mockRestore();
  });

  it("shows upload error inline when uploadFile fails after Apply", async () => {
    mockUploadFile.mockRejectedValue(new ApiError(415, "unsupported_file_type"));
    renderWithToast(<LogoUploadZone value="" onChange={() => {}} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "logo.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/Unsupported file type/);
    });
  });

  it("rejects non-image MIME before opening crop", async () => {
    renderWithToast(<LogoUploadZone value="" onChange={() => {}} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "bad.exe", { type: "application/octet-stream" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/PNG, JPG, or WebP/i);
    });
    expect(mockUploadFile).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("clears corrupt uploaded logo and shows drop zone on preview load failure", () => {
    const onDirty = vi.fn();
    function Harness() {
      const [value, setValue] = useState(
        "/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png",
      );
      return <LogoUploadZone value={value} onChange={setValue} onDirty={onDirty} />;
    }
    renderWithToast(<Harness />);
    fireEvent.error(screen.getByAltText("Organisation logo preview"));
    expect(onDirty).toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("corrupt");
    expect(screen.getByRole("button", { name: /drop logo here/i })).toBeTruthy();
    expect(screen.queryByAltText("Organisation logo preview")).toBeNull();
  });

  it("shows external URL toggle as a button", () => {
    renderWithToast(<LogoUploadZone value="" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Use a web link instead" }));
    expect(screen.getByLabelText("Web link to your logo (must start with https://)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide web link" })).toBeTruthy();
  });

  it("hides broken external URL preview after load failure", () => {
    const onChange = vi.fn();
    renderWithToast(
      <LogoUploadZone value="https://cdn.example.com/logo.png" onChange={onChange} />,
    );
    const img = screen.getByAltText("Organisation logo preview");
    fireEvent.error(img);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Could not load logo preview");
    expect(screen.queryByAltText("Organisation logo preview")).toBeNull();
    expect(screen.getByRole("button", { name: /drop logo here/i })).toBeTruthy();
  });

  it("rejects files over 2 MB before upload", async () => {
    renderWithToast(<LogoUploadZone value="" onChange={() => {}} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.png", {
      type: "image/png",
    });
    fireEvent.change(input, { target: { files: [big] } });
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("2 MB");
    });
    expect(mockUploadFile).not.toHaveBeenCalled();
  });
});
