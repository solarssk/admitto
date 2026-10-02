// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { ApiError } from "../../src/api/client.js";
import { EventImageAssetLibrary } from "../../src/components/EventImageAssetLibrary.js";
import { advanceTimers, deferred, hangUntilAborted, isOff, renderWithToast } from "../test-utils.js";
import type { EventImageAssetDto } from "../../src/api/types.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchEventImageAssets: vi.fn(),
    createEventImageAsset: vi.fn(),
    updateEventImageAsset: vi.fn(),
    deleteEventImageAsset: vi.fn(),
    uploadEventBrandingFile: vi.fn(),
    deleteUploadedFile: vi.fn(),
  };
});

vi.mock("../../src/components/crop/CropImageModal.js", async () => {
  const { createCropImageModalMock } = await import("./cropImageModalMock.js");
  return {
    CropImageModal: createCropImageModalMock(() => ({
      crop: { unit: "%", x: 4, y: 4, width: 92, height: 92 },
      zoom: 1,
    })),
  };
});

import {
  createEventImageAsset,
  deleteEventImageAsset,
  deleteUploadedFile,
  fetchEventImageAssets,
  updateEventImageAsset,
  uploadEventBrandingFile,
} from "../../src/api/client.js";

const mockFetch = vi.mocked(fetchEventImageAssets);
const mockCreate = vi.mocked(createEventImageAsset);
const mockUpdate = vi.mocked(updateEventImageAsset);
const mockDelete = vi.mocked(deleteEventImageAsset);
const mockUploadPreview = vi.mocked(uploadEventBrandingFile);
const mockDeleteUploadedFile = vi.mocked(deleteUploadedFile);

async function pickImageAndApply(file: File) {
  mockUploadPreview.mockResolvedValueOnce({
    url: "/uploads/default/events/evt-1/preview.png",
  });
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(fileInput, { target: { files: [file] } });
  fireEvent.click(await screen.findByRole("button", { name: "Apply changes" }));
}

const asset: EventImageAssetDto = {
  id: "asset-1",
  token: "sponsor_logo",
  filename: "sponsor.png",
  url: "/uploads/default/events/evt-1/sponsor.png",
  original_url: null,
  crop: null,
  size_bytes: 2048,
  mime_type: "image/png",
  created_at: "2026-01-15T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("EventImageAssetLibrary", () => {
  it("shows its placeholder only once the fetch has taken a moment, then an empty-state message when there are no assets", async () => {
    const answer = deferred<EventImageAssetDto[]>();
    mockFetch.mockReturnValueOnce(answer.promise);
    vi.useFakeTimers();
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    expect(screen.getByLabelText("Loading images").className).toContain("at-loading-hold");
    await advanceTimers(200);
    expect(screen.getByLabelText("Loading images").className).not.toContain("at-loading-hold");

    await act(async () => answer.resolve([]));
    await advanceTimers(400);
    vi.useRealTimers();
    expect(await screen.findByText("No images yet")).toBeTruthy();
    expect(screen.queryByLabelText("Loading images")).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith("evt-1", expect.any(AbortSignal));
  });

  it("shows a load error when the initial fetch fails", async () => {
    mockFetch.mockRejectedValueOnce(new ApiError(500, "server error"));
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    expect(await screen.findByText("Something went wrong. Try again.")).toBeTruthy();
  });

  it("re-fetches and renders the assets when Retry is clicked after a load failure", async () => {
    mockFetch.mockRejectedValueOnce(new ApiError(500, "server error"));
    mockFetch.mockResolvedValueOnce([asset]);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);

    expect(await screen.findByText("Could not load images")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("sponsor.png")).toBeTruthy();
    expect(screen.queryByText("Could not load images")).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("renders an existing asset with filename, size, and a copyable token chip", async () => {
    mockFetch.mockResolvedValueOnce([asset]);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    expect(await screen.findByText("sponsor.png")).toBeTruthy();
    expect(screen.getByText("2.0 KB")).toBeTruthy();
    expect(screen.getByText("{{sponsor_logo}}")).toBeTruthy();
  });

  it("copies the {{token}} placeholder to the clipboard when the chip is clicked", async () => {
    mockFetch.mockResolvedValueOnce([asset]);
    const writeText = vi.fn().mockResolvedValue(undefined);
    const originalClipboard = navigator.clipboard;
    Object.assign(navigator, { clipboard: { writeText } });
    try {
      renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
      fireEvent.click(await screen.findByTitle("Copy placeholder"));
      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith("{{sponsor_logo}}");
      });
      expect(await screen.findByText("Copied to clipboard")).toBeTruthy();
    } finally {
      Object.assign(navigator, { clipboard: originalClipboard });
    }
  });

  it("shows an inline error when the name cannot form a template variable", async () => {
    mockFetch.mockResolvedValueOnce([]);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("No images yet");

    const tokenInput = screen.getByLabelText("Image name");
    fireEvent.change(tokenInput, { target: { value: "!!!" } });
    fireEvent.blur(tokenInput);
    expect(
      await screen.findByText("Enter a display name with at least one letter."),
    ).toBeTruthy();
  });

  it("keeps Add image disabled until both a file and a valid name are present", async () => {
    mockFetch.mockResolvedValueOnce([]);
    mockUploadPreview.mockResolvedValueOnce({
      url: "/uploads/default/events/evt-1/preview.png",
    });
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("No images yet");

    const addButton = screen.getByRole("button", { name: "Add image" });
    expect(isOff(addButton)).toBe(true);

    fireEvent.change(screen.getByLabelText("Image name"), { target: { value: "sponsor_logo" } });
    expect(isOff(addButton)).toBe(true);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "sponsor.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(isOff(addButton)).toBe(true);
    fireEvent.click(await screen.findByRole("button", { name: "Apply changes" }));
    await waitFor(() => {
      expect(isOff(addButton)).toBe(false);
    });
  });

  it("accepts a file dropped onto the dropzone", async () => {
    mockFetch.mockResolvedValueOnce([]);
    mockUploadPreview.mockResolvedValueOnce({
      url: "/uploads/default/events/evt-1/dropped.png",
    });
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("No images yet");

    const dropzone = screen.getByRole("button", { name: /Drop image here or click to browse/ });
    const file = new File(["x"], "dropped.png", { type: "image/png" });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
    fireEvent.click(await screen.findByRole("button", { name: "Apply changes" }));

    expect(await screen.findByText("dropped.png")).toBeTruthy();
  });

  it("cancelling the crop modal leaves no pending file selected", async () => {
    mockFetch.mockResolvedValueOnce([]);
    mockUploadPreview.mockResolvedValueOnce({
      url: "/uploads/default/events/evt-1/preview.png",
    });
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("No images yet");

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(["x"], "sponsor.png", { type: "image/png" })] },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Adjust image" })).toBeNull();
    expect(screen.queryByText("sponsor.png")).toBeNull();
    expect(isOff(screen.getByRole("button", { name: "Add image" }))).toBe(true);
    expect(mockDeleteUploadedFile).toHaveBeenCalledWith("/uploads/default/events/evt-1/preview.png");
  });

  it("rejects a file over 2 MB client-side without calling the API", async () => {
    mockFetch.mockResolvedValueOnce([]);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("No images yet");

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [big] } });

    expect(await screen.findByText("File must be 2 MB or smaller.")).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("adds a new asset, appends it to the list, and resets the form", async () => {
    mockFetch.mockResolvedValueOnce([]);
    mockCreate.mockResolvedValueOnce(asset);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("No images yet");

    fireEvent.change(screen.getByLabelText("Image name"), { target: { value: "sponsor_logo" } });
    await pickImageAndApply(new File(["x"], "sponsor.png", { type: "image/png" }));

    fireEvent.click(screen.getByRole("button", { name: "Add image" }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith("evt-1", expect.any(File), "sponsor_logo", {
        url: "/uploads/default/events/evt-1/preview.png",
        crop: { unit: "%", x: 4, y: 4, width: 92, height: 92, zoom: 1 },
      });
    });
    expect(await screen.findByText("sponsor.png")).toBeTruthy();
    expect((screen.getByLabelText("Image name") as HTMLInputElement).value).toBe("");
  });

  it("previews a suffixed template variable when the base token is already taken", async () => {
    mockFetch.mockResolvedValueOnce([asset]);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("sponsor.png");

    fireEvent.change(screen.getByLabelText("Image name"), { target: { value: "Sponsor logo" } });
    expect(screen.getByText(/\{\{sponsor_logo_2\}\}/)).toBeTruthy();
  });

  it("caps the image name field at the server display-name limit", async () => {
    mockFetch.mockResolvedValueOnce([]);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("No images yet");
    expect(screen.getByLabelText("Image name").getAttribute("maxLength")).toBe("80");
  });

  it("shows the mapped server error when adding an asset fails (e.g. reserved token)", async () => {
    mockFetch.mockResolvedValueOnce([]);
    mockCreate.mockRejectedValueOnce(new ApiError(409, "reserved_token", "reserved_token"));
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("No images yet");

    fireEvent.change(screen.getByLabelText("Image name"), { target: { value: "weird_name" } });
    await pickImageAndApply(new File(["x"], "logo.png", { type: "image/png" }));
    fireEvent.click(screen.getByRole("button", { name: "Add image" }));

    expect(
      await screen.findByText(
        "This name is already used as a built-in placeholder. Choose a different name.",
      ),
    ).toBeTruthy();
  });

  // Regression coverage: the confirm dialog used to describe the *old* delete behavior (deletion
  // always proceeds, the placeholder silently breaks in email templates afterwards). The DELETE
  // route now rejects deletion with 409 asset_in_use while the token is still referenced by one
  // of the event's saved templates (see event-image-assets-routes.ts), so the copy must describe
  // that the delete is *blocked*, not that the placeholder quietly stops working.
  it("describes the delete as blocked while the token is still in use, not as silently breaking", async () => {
    mockFetch.mockResolvedValueOnce([asset]);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("sponsor.png");

    fireEvent.click(screen.getByRole("button", { name: "Remove sponsor.png" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        /Remove "sponsor\.png"\?/,
      ),
    ).toBeTruthy();
    expect(within(dialog).queryByText(/will stop working/)).toBeNull();
  });

  it("shows a blocked-template notice when delete returns asset_in_use", async () => {
    mockFetch.mockResolvedValueOnce([asset]);
    mockDelete.mockRejectedValueOnce(new ApiError(409, "asset_in_use", "asset_in_use"));
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("sponsor.png");

    fireEvent.click(screen.getByRole("button", { name: "Remove sponsor.png" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect(
      await within(dialog).findByText(/still used in this event's email template/),
    ).toBeTruthy();
    expect(screen.getByText("sponsor.png")).toBeTruthy();
  });

  it("rejects SVG uploads client-side even when File.type claims PNG", async () => {
    mockFetch.mockResolvedValueOnce([]);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("No images yet");

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(["x"], "logo.svg", { type: "image/png" })] },
    });
    expect(await screen.findByText(/SVG is not supported/)).toBeTruthy();
    expect(mockUploadPreview).not.toHaveBeenCalled();
  });

  it("autofills a clamped image name from a long filename", async () => {
    mockFetch.mockResolvedValueOnce([]);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("No images yet");

    const longBase = "n".repeat(90);
    await pickImageAndApply(new File(["x"], `${longBase}.png`, { type: "image/png" }));
    const nameInput = screen.getByLabelText("Image name") as HTMLInputElement;
    expect(nameInput.value).toHaveLength(80);
    fireEvent.blur(nameInput);
    expect(screen.queryByText(/80 characters/)).toBeNull();
  });

  it("deletes an asset after confirming in the dialog", async () => {
    mockFetch.mockResolvedValueOnce([asset]);
    mockDelete.mockResolvedValueOnce(undefined);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("sponsor.png");

    fireEvent.click(screen.getByRole("button", { name: "Remove sponsor.png" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Remove" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith("evt-1", "asset-1");
    });
    await waitFor(() => {
      expect(screen.queryByText("sponsor.png")).toBeNull();
    });
  });

  it("shows an error in the confirm dialog when delete fails and keeps the asset listed", async () => {
    mockFetch.mockResolvedValueOnce([asset]);
    mockDelete.mockRejectedValueOnce(new ApiError(500, "server error"));
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("sponsor.png");

    fireEvent.click(screen.getByRole("button", { name: "Remove sponsor.png" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect(await within(dialog).findByText("Something went wrong. Try again.")).toBeTruthy();
    expect(screen.getByText("sponsor.png")).toBeTruthy();
  });

  it("disables the add form and delete buttons when disabled", async () => {
    mockFetch.mockResolvedValueOnce([asset]);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" disabled />);
    await screen.findByText("sponsor.png");

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput.disabled).toBe(true);
    expect((screen.getByLabelText("Image name") as HTMLInputElement).disabled).toBe(true);
    expect(isOff(screen.getByRole("button", { name: "Add image" }))).toBe(true);
    expect(screen.getByRole("button", { name: "Edit" }).hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByRole("button", { name: "Remove sponsor.png" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByText(/This event is archived/)).toBeTruthy();
  });

  it("cancels the delete confirm dialog without calling the API", async () => {
    mockFetch.mockResolvedValueOnce([asset]);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("sponsor.png");

    fireEvent.click(screen.getByRole("button", { name: "Remove sponsor.png" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(mockDelete).not.toHaveBeenCalled();
    expect(screen.getByText("sponsor.png")).toBeTruthy();
  });

  it("toggles the dropzone dragging class on drag over and leave", async () => {
    mockFetch.mockResolvedValueOnce([]);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("No images yet");

    const dropzone = screen.getByRole("button", { name: /Drop image here or click to browse/ });
    fireEvent.dragOver(dropzone);
    expect(dropzone.className).toContain("image-asset-library__dropzone--dragging");
    fireEvent.dragLeave(dropzone);
    expect(dropzone.className).not.toContain("image-asset-library__dropzone--dragging");
  });

  it("opens the file picker from the dropzone via Enter and Space", async () => {
    mockFetch.mockResolvedValueOnce([]);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("No images yet");

    const dropzone = screen.getByRole("button", { name: /Drop image here or click to browse/ });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, "click").mockImplementation(() => undefined);

    fireEvent.keyDown(dropzone, { key: "Enter" });
    fireEvent.keyDown(dropzone, { key: " " });
    expect(clickSpy).toHaveBeenCalledTimes(2);
    clickSpy.mockRestore();
  });

  it("ignores drops while disabled", async () => {
    mockFetch.mockResolvedValueOnce([asset]);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" disabled />);
    await screen.findByText("sponsor.png");

    const dropzone = screen.getByRole("button", { name: /Drop image here or click to browse/ });
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [new File(["x"], "nope.png", { type: "image/png" })] },
    });
    expect(screen.queryByText("nope.png")).toBeNull();
  });

  it("does nothing when something is dropped that holds no file", async () => {
    mockFetch.mockResolvedValueOnce([asset]);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("sponsor.png");

    const dropzone = screen.getByRole("button", { name: /Drop image here or click to browse/ });
    fireEvent.drop(dropzone, { dataTransfer: { files: [] } });

    expect(mockUploadPreview).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(dropzone.className).not.toContain("image-asset-library__dropzone--dragging");
  });

  it("pluralizes the asset count intro for more than one image", async () => {
    mockFetch.mockResolvedValueOnce([
      asset,
      { ...asset, id: "asset-2", token: "banner", filename: "banner.png" },
    ]);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    expect(await screen.findByText(/2 images\./)).toBeTruthy();
  });

  it("falls back to a photo icon when the asset URL is not a safe img src", async () => {
    mockFetch.mockResolvedValueOnce([{ ...asset, url: "javascript:alert(1)" }]);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("sponsor.png");
    expect(document.querySelector(".image-asset-library__card-thumb img")).toBeNull();
    expect(document.querySelector(".image-asset-library__card-thumb .ti-photo")).toBeTruthy();
  });

  it("rejects non-image MIME and empty file picks without opening crop", async () => {
    mockFetch.mockResolvedValueOnce([]);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("No images yet");

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(["x"], "doc.pdf", { type: "application/pdf" })] },
    });
    expect(await screen.findByText(/PNG, JPG, or WebP/i)).toBeTruthy();
    expect(mockUploadPreview).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.change(fileInput, { target: { files: [] } });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows an inline error when preview upload fails before crop", async () => {
    mockFetch.mockResolvedValueOnce([]);
    mockUploadPreview.mockRejectedValueOnce(new ApiError(500, "upload_failed", "upload_failed"));
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("No images yet");

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(["x"], "logo.png", { type: "image/png" })] },
    });
    expect(await screen.findByText(/Could not prepare image for cropping/i)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("toasts when clipboard copy fails", async () => {
    mockFetch.mockResolvedValueOnce([asset]);
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    const originalClipboard = navigator.clipboard;
    Object.assign(navigator, { clipboard: { writeText } });
    try {
      renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
      await screen.findByText("sponsor.png");
      fireEvent.click(await screen.findByTitle("Copy placeholder"));
      expect(await screen.findByText("Could not copy")).toBeTruthy();
    } finally {
      Object.assign(navigator, { clipboard: originalClipboard });
    }
  });

  it("ignores a stale asset list response after eventId changes", async () => {
    let resolveFirst!: (v: EventImageAssetDto[]) => void;
    const first = new Promise<EventImageAssetDto[]>((r) => {
      resolveFirst = r;
    });
    mockFetch.mockReturnValueOnce(first).mockResolvedValueOnce([]);

    function Harness() {
      const [eventId, setEventId] = useState("evt-1");
      return (
        <>
          <button type="button" onClick={() => setEventId("evt-2")}>
            switch event
          </button>
          <EventImageAssetLibrary eventId={eventId} />
        </>
      );
    }

    renderWithToast(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "switch event" }));
    await screen.findByText("No images yet");
    resolveFirst([asset]);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText("sponsor.png")).toBeNull();
  });

  it("ignores drops while uploading", async () => {
    mockFetch.mockResolvedValueOnce([]);
    let resolveUpload!: (v: { url: string }) => void;
    mockUploadPreview.mockReturnValueOnce(
      new Promise((r) => {
        resolveUpload = r;
      }),
    );
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("No images yet");

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(["a"], "a.png", { type: "image/png" })] },
    });
    const dropzone = screen.getByRole("button", { name: /Drop image here or click to browse/ });
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [new File(["b"], "b.png", { type: "image/png" })] },
    });
    expect(mockUploadPreview).toHaveBeenCalledTimes(1);
    resolveUpload({ url: "/uploads/default/events/evt-1/preview.png" });
    await screen.findByRole("dialog", { name: "Adjust image" });
  });

  it("deletes the preview upload when unmounted before the upload resolves", async () => {
    mockFetch.mockResolvedValueOnce([]);
    let resolveUpload!: (v: { url: string }) => void;
    mockUploadPreview.mockReturnValueOnce(
      new Promise((r) => {
        resolveUpload = r;
      }),
    );
    const { unmount } = renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("No images yet");

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(["x"], "sponsor.png", { type: "image/png" })] },
    });
    expect(mockUploadPreview).toHaveBeenCalledTimes(1);
    unmount();
    resolveUpload({ url: "/uploads/default/events/evt-1/orphan-preview.png" });
    await waitFor(() => {
      expect(mockDeleteUploadedFile).toHaveBeenCalledWith(
        "/uploads/default/events/evt-1/orphan-preview.png",
      );
    });
  });

  describe("Edit (re-crop an existing asset)", () => {
    const assetWithOriginal: EventImageAssetDto = {
      ...asset,
      original_url: "/uploads/default/events/evt-1/sponsor-original.png",
      crop: { unit: "%", x: 10, y: 10, width: 60, height: 60, zoom: 1.5 },
    };

    it("opens the crop modal on the persisted original with the previous crop restored", async () => {
      mockFetch.mockResolvedValueOnce([assetWithOriginal]);
      renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
      await screen.findByText("sponsor.png");

      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      const dialog = await screen.findByRole("dialog", { name: "Adjust image" });
      expect(dialog.getAttribute("data-image-src")).toBe(
        "/uploads/default/events/evt-1/sponsor-original.png",
      );
      expect(JSON.parse(dialog.getAttribute("data-initial-crop") || "null")).toEqual({
        unit: "%",
        x: 10,
        y: 10,
        width: 60,
        height: 60,
      });
      expect(dialog.getAttribute("data-initial-zoom")).toBe("1.5");
    });

    it("falls back to the current cropped image with an info toast when no original is stored", async () => {
      mockFetch.mockResolvedValueOnce([asset]);
      renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
      await screen.findByText("sponsor.png");

      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      expect(await screen.findByText(/original image isn't available/i)).toBeTruthy();
      const dialog = await screen.findByRole("dialog", { name: "Adjust image" });
      expect(dialog.getAttribute("data-image-src")).toBe(asset.url);
      expect(dialog.getAttribute("data-initial-crop")).toBe("");
    });

    it("opens the crop modal on the original with no crop framing when the asset has no stored crop metadata", async () => {
      const originalWithoutCrop: EventImageAssetDto = {
        ...asset,
        original_url: "/uploads/default/events/evt-1/sponsor-original.png",
        crop: null,
      };
      mockFetch.mockResolvedValueOnce([originalWithoutCrop]);
      renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
      await screen.findByText("sponsor.png");

      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      const dialog = await screen.findByRole("dialog", { name: "Adjust image" });
      expect(dialog.getAttribute("data-image-src")).toBe(
        "/uploads/default/events/evt-1/sponsor-original.png",
      );
      expect(dialog.getAttribute("data-initial-crop")).toBe("");
      expect(dialog.getAttribute("data-initial-zoom")).toBe("");
      expect(screen.queryByText(/original image isn't available/i)).toBeNull();
    });

    it("calls updateEventImageAsset with the re-cropped file and updates the asset in place", async () => {
      mockFetch.mockResolvedValueOnce([assetWithOriginal]);
      const updated: EventImageAssetDto = {
        ...assetWithOriginal,
        url: "/uploads/default/events/evt-1/sponsor-v2.png",
        crop: { unit: "%", x: 4, y: 4, width: 92, height: 92, zoom: 1 },
      };
      mockUpdate.mockResolvedValueOnce(updated);
      renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
      await screen.findByText("sponsor.png");

      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      fireEvent.click(await screen.findByRole("button", { name: "Apply changes" }));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith("evt-1", "asset-1", expect.any(File), {
          unit: "%",
          x: 4,
          y: 4,
          width: 92,
          height: 92,
          zoom: 1,
        });
      });
      expect(await screen.findByText('Updated "sponsor.png"')).toBeTruthy();
      expect(screen.queryByRole("dialog", { name: "Adjust image" })).toBeNull();
    });

    it("shows an inline error and keeps the dialog open when the update fails", async () => {
      mockFetch.mockResolvedValueOnce([assetWithOriginal]);
      mockUpdate.mockRejectedValueOnce(new ApiError(500, "server error"));
      renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
      await screen.findByText("sponsor.png");

      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      fireEvent.click(await screen.findByRole("button", { name: "Apply changes" }));

      expect(await screen.findByText("Something went wrong. Try again.")).toBeTruthy();
      expect(screen.getByRole("dialog", { name: "Adjust image" })).toBeTruthy();
    });

    it("updates only the edited asset, leaving other assets in the list untouched", async () => {
      const banner: EventImageAssetDto = {
        ...asset,
        id: "asset-2",
        token: "banner",
        filename: "banner.png",
        url: "/uploads/default/events/evt-1/banner.png",
      };
      mockFetch.mockResolvedValueOnce([assetWithOriginal, banner]);
      const updated: EventImageAssetDto = {
        ...assetWithOriginal,
        url: "/uploads/default/events/evt-1/sponsor-v2.png",
        crop: { unit: "%", x: 4, y: 4, width: 92, height: 92, zoom: 1 },
      };
      mockUpdate.mockResolvedValueOnce(updated);
      renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
      await screen.findByText("sponsor.png");
      await screen.findByText("banner.png");

      const sponsorCard = screen
        .getByText("sponsor.png")
        .closest(".image-asset-library__card") as HTMLElement;
      fireEvent.click(within(sponsorCard).getByRole("button", { name: "Edit" }));
      fireEvent.click(await screen.findByRole("button", { name: "Apply changes" }));

      await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
      expect(await screen.findByText('Updated "sponsor.png"')).toBeTruthy();

      const bannerCard = screen
        .getByText("banner.png")
        .closest(".image-asset-library__card") as HTMLElement;
      expect(
        bannerCard.querySelector(".image-asset-library__card-thumb img")?.getAttribute("src"),
      ).toBe("/uploads/default/events/evt-1/banner.png");
    });

    it("cancelling the edit crop modal does not call updateEventImageAsset", async () => {
      mockFetch.mockResolvedValueOnce([assetWithOriginal]);
      renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
      await screen.findByText("sponsor.png");

      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("dialog", { name: "Adjust image" })).toBeNull();
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});

describe("EventImageAssetLibrary on the loading standard", () => {
  it("keeps the upload card from the first frame, draws tiles of placeholders after 200ms, says it is taking longer after 8 seconds and ends in an error with a Retry after 30", async () => {
    mockFetch.mockImplementationOnce(hangUntilAborted as never);
    vi.useFakeTimers();
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);

    expect(screen.getByText("Upload images")).toBeTruthy();
    expect(screen.getByLabelText("Loading images").className).toContain("at-loading-hold");
    await advanceTimers(200);
    expect(screen.getByLabelText("Loading images").className).not.toContain("at-loading-hold");
    expect(document.querySelectorAll(".image-asset-library__skeleton .image-asset-library__grid .at-skeleton")).toHaveLength(3);
    await advanceTimers(7_800);
    expect(screen.getByLabelText("Loading images").textContent).toContain("Taking longer than usual");

    await advanceTimers(22_000);
    await advanceTimers(0);
    expect(screen.queryByLabelText("Loading images")).toBeNull();
    expect(screen.getByText("Could not load images")).toBeTruthy();
    expect(screen.getByText(/The server did not answer in time/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("keeps the error on screen with a busy Retry until the answer is in", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"));
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    const retry = await screen.findByRole("button", { name: "Retry" });
    retry.focus();
    const answer = deferred<EventImageAssetDto[]>();
    mockFetch.mockReturnValueOnce(answer.promise);

    fireEvent.click(retry);
    await waitFor(() => expect(retry.getAttribute("aria-busy")).toBe("true"));
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(retry.hasAttribute("disabled")).toBe(false);
    expect(screen.queryByLabelText("Loading images")).toBeNull();

    await act(async () => answer.resolve([asset]));
    expect(await screen.findByText("sponsor.png")).toBeTruthy();
    // The card that holds the list stays, so the focus goes there and not to the top of the tab.
    await waitFor(() => expect(document.activeElement?.classList.contains("at-card")).toBe(true));
    expect(document.activeElement?.textContent).toContain("sponsor.png");
  });

  it("keeps Add image off, with its reason, until the list has loaded, since the names already taken come from it", async () => {
    const list = deferred<EventImageAssetDto[]>();
    mockFetch.mockReturnValueOnce(list.promise);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    fireEvent.change(screen.getByLabelText("Image name"), { target: { value: "sponsor_logo" } });
    await pickImageAndApply(new File(["x"], "sponsor.png", { type: "image/png" }));
    const add = screen.getByRole("button", { name: "Add image" });

    expect(isOff(add)).toBe(true);
    expect(document.getElementById(add.getAttribute("aria-describedby")!)?.textContent).toBe("The images are still loading.");
    fireEvent.click(add);
    expect(mockCreate).not.toHaveBeenCalled();

    await act(async () => list.resolve([]));
    await waitFor(() => expect(isOff(screen.getByRole("button", { name: "Add image" }))).toBe(false));
  });

  it("says why Add image is off while no image has been chosen", async () => {
    mockFetch.mockResolvedValueOnce([]);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("No images yet");
    const add = screen.getByRole("button", { name: "Add image" });
    expect(document.getElementById(add.getAttribute("aria-describedby")!)?.textContent).toBe("Choose an image and give it a name first.");
  });

  it("blocks the drop zone, the file picker and the drops while Add image runs, so the original it is sending cannot be deleted", async () => {
    mockFetch.mockResolvedValueOnce([]);
    const created = deferred<EventImageAssetDto>();
    mockCreate.mockReturnValueOnce(created.promise);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("No images yet");
    fireEvent.change(screen.getByLabelText("Image name"), { target: { value: "sponsor_logo" } });
    await pickImageAndApply(new File(["x"], "sponsor.png", { type: "image/png" }));
    fireEvent.click(screen.getByRole("button", { name: "Add image" }));
    await screen.findByRole("button", { name: "Adding…" });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput.disabled).toBe(true);
    expect(document.querySelector(".image-asset-library__dropzone--busy")).not.toBeNull();
    mockUploadPreview.mockClear();
    fireEvent.drop(document.querySelector(".image-asset-library__dropzone")!, {
      dataTransfer: { files: [new File(["y"], "other.png", { type: "image/png" })] },
    });
    expect(mockUploadPreview).not.toHaveBeenCalled();
    expect(mockDeleteUploadedFile).not.toHaveBeenCalled();

    await act(async () => created.resolve(asset));
  });

  it("shows Add image busy as 'Adding…' while the image is added, keeps its focus, ignores a second click, and only then clears the form", async () => {
    mockFetch.mockResolvedValueOnce([]);
    const created = deferred<EventImageAssetDto>();
    mockCreate.mockReturnValueOnce(created.promise);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("No images yet");
    fireEvent.change(screen.getByLabelText("Image name"), { target: { value: "sponsor_logo" } });
    await pickImageAndApply(new File(["x"], "sponsor.png", { type: "image/png" }));
    const add = screen.getByRole("button", { name: "Add image" });
    add.focus();

    fireEvent.click(add);
    const busy = await screen.findByRole("button", { name: "Adding…" });
    expect(busy).toBe(add);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(busy);
    fireEvent.click(busy);
    expect(mockCreate).toHaveBeenCalledTimes(1);

    await act(async () => created.resolve(asset));
    expect(await screen.findByText("sponsor.png")).toBeTruthy();
    // The button that did its job is off with aria-disabled, so it keeps the focus.
    const idle = screen.getByRole("button", { name: "Add image" });
    expect(idle).toBe(add);
    expect(isOff(idle)).toBe(true);
    expect(idle.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(idle);
  });

  it("does not call a file that is being prepared for cropping 'Adding…'", async () => {
    mockFetch.mockResolvedValueOnce([]);
    const prepared = deferred<{ url: string }>();
    mockUploadPreview.mockReturnValueOnce(prepared.promise);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("No images yet");
    fireEvent.change(screen.getByLabelText("Image name"), { target: { value: "sponsor_logo" } });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(["x"], "sponsor.png", { type: "image/png" })] } });

    const add = screen.getByRole("button", { name: "Add image" });
    expect(add.getAttribute("aria-busy")).toBeNull();
    expect(screen.queryByRole("button", { name: "Adding…" })).toBeNull();
    await act(async () => prepared.resolve({ url: "/uploads/default/events/evt-1/preview.png" }));
  });
});
