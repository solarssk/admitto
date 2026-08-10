// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { ApiError } from "../../src/api/client.js";
import { EventImageAssetLibrary } from "../../src/components/EventImageAssetLibrary.js";
import { renderWithToast } from "../test-utils.js";
import type { EventImageAssetDto } from "../../src/api/types.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchEventImageAssets: vi.fn(),
    createEventImageAsset: vi.fn(),
    deleteEventImageAsset: vi.fn(),
    uploadEventBrandingFile: vi.fn(),
    deleteUploadedFile: vi.fn(),
  };
});

vi.mock("../../src/components/crop/CropImageModal.js", () => ({
  CropImageModal: ({
    open,
    onApply,
    onCancel,
  }: {
    open: boolean;
    onApply: (
      blob: Blob,
      meta: { crop: { unit: "%"; x: number; y: number; width: number; height: number }; zoom: number },
    ) => void | Promise<void>;
    onCancel: () => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="Adjust image">
        <button
          type="button"
          onClick={() =>
            void onApply(new Blob(["x"], { type: "image/png" }), {
              crop: { unit: "%", x: 4, y: 4, width: 92, height: 92 },
              zoom: 1,
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

import {
  createEventImageAsset,
  deleteEventImageAsset,
  deleteUploadedFile,
  fetchEventImageAssets,
  uploadEventBrandingFile,
} from "../../src/api/client.js";

const mockFetch = vi.mocked(fetchEventImageAssets);
const mockCreate = vi.mocked(createEventImageAsset);
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
  it("shows a loading state, then an empty-state message when there are no assets", async () => {
    mockFetch.mockResolvedValueOnce([]);
    // useDelayedLoading only shows the text once the fetch has stayed pending past its
    // 200ms grace window (avoids flashing it for a near-instant response) - fake timers
    // must be installed before render so the hook's setTimeout is one of ours, and the
    // synchronous advance+assert below runs before the resolved fetch's microtask can flip
    // `loading` back to false.
    vi.useFakeTimers();
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText("Loading images…")).toBeTruthy();
    vi.useRealTimers();
    expect(await screen.findByText("No images yet")).toBeTruthy();
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
    expect(addButton.hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("Image name"), { target: { value: "sponsor_logo" } });
    expect(addButton.hasAttribute("disabled")).toBe(true);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "sponsor.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(addButton.hasAttribute("disabled")).toBe(true);
    fireEvent.click(await screen.findByRole("button", { name: "Apply changes" }));
    await waitFor(() => {
      expect(addButton.hasAttribute("disabled")).toBe(false);
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
    expect(screen.getByRole("button", { name: "Add image" }).hasAttribute("disabled")).toBe(true);
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
      expect(mockCreate).toHaveBeenCalledWith("evt-1", expect.any(File), "sponsor_logo");
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
    expect(screen.getByRole("button", { name: "Add image" }).hasAttribute("disabled")).toBe(true);
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
});
