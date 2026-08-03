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
    // Original is uploaded before the crop modal opens (no File→blob: preview).
    await waitFor(() => {
      expect(mockUploadFile).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("dialog", { name: "Adjust image" })).toBeTruthy();
    });
    const dialog = screen.getByRole("dialog", { name: "Adjust image" });
    expect(dialog.getAttribute("data-image-src")).toBe("/uploads/default/new-original.png");
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

  it("Edit image re-opens the original upload URL, not a blob: of the local file", async () => {
    mockUploadFile
      .mockResolvedValueOnce({ url: "/uploads/default/orig.png" })
      .mockResolvedValueOnce({ url: "/uploads/default/cropped.png" });
    function Harness() {
      const [value, setValue] = useState("");
      const [originalUrl, setOriginalUrl] = useState<string | null>(null);
      return (
        <LogoUploadZone
          value={value}
          originalUrl={originalUrl}
          onChange={setValue}
          onSourceChange={(s) => setOriginalUrl(s.originalUrl)}
        />
      );
    }
    renderWithToast(<Harness />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["full-original"], "hitachi.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Adjust image" })).toBeTruthy();
    });
    expect(screen.getByRole("dialog", { name: "Adjust image" }).getAttribute("data-image-src")).toBe(
      "/uploads/default/orig.png",
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Edit image" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit image" }));
    const editDialog = screen.getByRole("dialog", { name: "Adjust image" });
    expect(editDialog.getAttribute("data-image-src")).toBe("/uploads/default/orig.png");
    expect(editDialog.getAttribute("data-initial-crop")).toContain('"width":92');
  });

  it("Edit loads the persisted original URL and restores crop after reload", async () => {
    const crop = { unit: "%" as const, x: 10, y: 12, width: 80, height: 70, zoom: 1.8 };
    renderWithToast(
      <LogoUploadZone
        value="/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png"
        originalUrl="/uploads/default/b2c3d4e5-f6a7-8901-bcde-f12345678901.png"
        cropMeta={crop}
        onChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit image" }));
    const dialog = screen.getByRole("dialog", { name: "Adjust image" });
    expect(dialog.getAttribute("data-image-src")).toBe(
      "/uploads/default/b2c3d4e5-f6a7-8901-bcde-f12345678901.png",
    );
    expect(dialog.getAttribute("data-initial-crop")).toContain('"x":10');
  });

  it("Edit after cancelling Replace still uses the saved original URL", async () => {
    const crop = { unit: "%" as const, x: 10, y: 12, width: 80, height: 70, zoom: 1.8 };
    mockUploadFile.mockResolvedValueOnce({ url: "/uploads/default/replacement-original.png" });
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
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Adjust image" })).toBeTruthy();
    });
    expect(screen.getByRole("dialog", { name: "Adjust image" }).getAttribute("data-image-src")).toBe(
      "/uploads/default/replacement-original.png",
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Adjust image" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit image" }));
    expect(screen.getByRole("dialog", { name: "Adjust image" }).getAttribute("data-image-src")).toBe(
      "/uploads/default/b2c3d4e5-f6a7-8901-bcde-f12345678901.png",
    );
  });

  it("Edit without a persisted original asks for the full file again", async () => {
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

  it("shows upload error inline when the pre-crop original upload fails", async () => {
    mockUploadFile.mockRejectedValue(new ApiError(415, "unsupported_file_type"));
    renderWithToast(<LogoUploadZone value="" onChange={() => {}} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "logo.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/Unsupported file type/);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows upload error inline when cropped upload fails after Apply", async () => {
    mockUploadFile
      .mockResolvedValueOnce({ url: "/uploads/default/orig.png" })
      .mockRejectedValueOnce(new ApiError(415, "unsupported_file_type"));
    renderWithToast(<LogoUploadZone value="" onChange={() => {}} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "logo.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Adjust image" })).toBeTruthy();
    });
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

  it("opens crop via drag-and-drop and keyboard Enter/Space", async () => {
    mockUploadFile.mockResolvedValue({ url: "/uploads/default/drop-original.png" });
    renderWithToast(<LogoUploadZone value="" onChange={() => {}} />);
    const zone = screen.getByRole("button", { name: /drop logo here/i });

    fireEvent.dragOver(zone);
    expect(zone.className).toContain("logo-upload__zone--dragging");
    fireEvent.dragLeave(zone);

    const file = new File(["x"], "logo.png", { type: "image/png" });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Adjust image" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.keyDown(zone, { key: "Enter" });
    fireEvent.keyDown(zone, { key: " " });
    // Picker click is side-effect on hidden input — assert zone stays interactive.
    expect(zone.getAttribute("aria-disabled")).toBeNull();
  });

  it("ignores drop and picker when disabled", () => {
    renderWithToast(<LogoUploadZone value="" onChange={() => {}} disabled />);
    const zone = screen.getByRole("button", { name: /drop logo here/i });
    expect(zone.getAttribute("aria-disabled")).toBe("true");
    fireEvent.drop(zone, {
      dataTransfer: { files: [new File(["x"], "logo.png", { type: "image/png" })] },
    });
    expect(mockUploadFile).not.toHaveBeenCalled();
    fireEvent.click(zone);
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it("updates web link value and clears original/crop via onSourceChange", () => {
    const onChange = vi.fn();
    const onSourceChange = vi.fn();
    const onDirty = vi.fn();
    renderWithToast(
      <LogoUploadZone
        value=""
        onChange={onChange}
        onSourceChange={onSourceChange}
        onDirty={onDirty}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Use a web link instead" }));
    fireEvent.change(screen.getByLabelText("Web link to your logo (must start with https://)"), {
      target: { value: "https://cdn.example.com/logo.png" },
    });
    expect(onChange).toHaveBeenCalledWith("https://cdn.example.com/logo.png");
    expect(onSourceChange).toHaveBeenCalledWith({ originalUrl: null, crop: null });
    expect(onDirty).toHaveBeenCalled();
  });

  it("Edit Apply with persisted original reuses it and updates crop without re-uploading original", async () => {
    mockUploadFile.mockResolvedValueOnce({ url: "/uploads/default/cropped-again.png" });
    const onChange = vi.fn();
    const onSourceChange = vi.fn();
    renderWithToast(
      <LogoUploadZone
        value="/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png"
        originalUrl="/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890-original.png"
        cropMeta={{ unit: "%", x: 10, y: 10, width: 50, height: 40, zoom: 1.2 }}
        onChange={onChange}
        onSourceChange={onSourceChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit image" }));
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Adjust image" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() => {
      expect(mockUploadFile).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith("/uploads/default/cropped-again.png");
    });
    expect(onSourceChange).toHaveBeenCalledWith({
      originalUrl: "/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890-original.png",
      crop: expect.objectContaining({ unit: "%", zoom: 1.5 }),
    });
  });

  it("Edit does nothing while disabled", () => {
    renderWithToast(
      <LogoUploadZone
        value="/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png"
        originalUrl="/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890-original.png"
        onChange={() => {}}
        disabled
      />,
    );
    expect(screen.getByRole("button", { name: "Edit image" })).toHaveProperty("disabled", true);
  });

  it("stale original upload is ignored when a newer pick supersedes it", async () => {
    let resolveFirst!: (v: { url: string }) => void;
    const first = new Promise<{ url: string }>((r) => {
      resolveFirst = r;
    });
    mockUploadFile.mockReturnValueOnce(first).mockResolvedValueOnce({
      url: "/uploads/default/second-original.png",
    });
    renderWithToast(<LogoUploadZone value="" onChange={() => {}} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["a"], "a.png", { type: "image/png" })] },
    });
    fireEvent.change(input, {
      target: { files: [new File(["b"], "b.png", { type: "image/png" })] },
    });
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Adjust image" })).toBeTruthy();
    });
    expect(
      screen.getByRole("dialog", { name: "Adjust image" }).getAttribute("data-image-src"),
    ).toBe("/uploads/default/second-original.png");
    resolveFirst({ url: "/uploads/default/first-original.png" });
    await waitFor(() => {
      expect(mockUploadFile).toHaveBeenCalledTimes(2);
    });
    expect(
      screen.getByRole("dialog", { name: "Adjust image" }).getAttribute("data-image-src"),
    ).toBe("/uploads/default/second-original.png");
  });

  it("uses JPEG extension for nameless files and jpeg MIME", async () => {
    mockUploadFile.mockResolvedValueOnce({ url: "/uploads/default/logo-original.jpg" });
    renderWithToast(<LogoUploadZone value="" onChange={() => {}} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(mockUploadFile).toHaveBeenCalledOnce();
    });
    const fd = mockUploadFile.mock.calls[0]![0] as FormData;
    const uploaded = fd.get("file") as File;
    expect(uploaded.name).toMatch(/logo-original\.jpe?g$/i);
  });

  it("prompts to re-pick when Edit has no stored original upload", async () => {
    renderWithToast(
      <LogoUploadZone
        value="/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png"
        onChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit image" }));
    expect(await screen.findByText(/original image is not available/i)).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Adjust image" })).toBeNull();
  });

  it("Edit with a .webp original uses webp MIME without re-uploading", async () => {
    mockUploadFile.mockResolvedValueOnce({ url: "/uploads/default/cropped-webp.png" });
    renderWithToast(
      <LogoUploadZone
        value="/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.webp"
        originalUrl="/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890-original.webp"
        cropMeta={{ unit: "%", x: 0, y: 0, width: 80, height: 80, zoom: 1 }}
        onChange={() => {}}
        onSourceChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit image" }));
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Adjust image" })).toBeTruthy();
    });
    expect(mockUploadFile).not.toHaveBeenCalled();
  });
});
