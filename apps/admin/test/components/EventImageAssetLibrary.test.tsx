// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  fetchEventImageAssets,
} from "../../src/api/client.js";

const mockFetch = vi.mocked(fetchEventImageAssets);
const mockCreate = vi.mocked(createEventImageAsset);
const mockDelete = vi.mocked(deleteEventImageAsset);

async function pickImageAndApply(file: File) {
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
    // 200ms grace window (avoids flashing it for a near-instant response) — fake timers
    // must be installed before render so the hook's setTimeout is one of ours, and the
    // synchronous advance+assert below runs before the resolved fetch's microtask can flip
    // `loading` back to false.
    vi.useFakeTimers();
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText("Loading assets…")).toBeTruthy();
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

    expect(await screen.findByText("Could not load image assets")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("sponsor.png")).toBeTruthy();
    expect(screen.queryByText("Could not load image assets")).toBeNull();
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

  it("shows an inline error when the token doesn't match the required format", async () => {
    mockFetch.mockResolvedValueOnce([]);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("No images yet");

    const tokenInput = screen.getByLabelText("Name");
    fireEvent.change(tokenInput, { target: { value: "1bad" } });
    fireEvent.blur(tokenInput);
    expect(
      await screen.findByText(/Must start with a letter/),
    ).toBeTruthy();
  });

  it("keeps Add asset disabled until both a file and a valid token are present", async () => {
    mockFetch.mockResolvedValueOnce([]);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("No images yet");

    const addButton = screen.getByRole("button", { name: "Add asset" });
    expect(addButton.hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "sponsor_logo" } });
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
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("No images yet");

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(["x"], "sponsor.png", { type: "image/png" })] },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Adjust image" })).toBeNull();
    expect(screen.queryByText("sponsor.png")).toBeNull();
    expect(screen.getByRole("button", { name: "Add asset" }).hasAttribute("disabled")).toBe(true);
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

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "sponsor_logo" } });
    await pickImageAndApply(new File(["x"], "sponsor.png", { type: "image/png" }));

    fireEvent.click(screen.getByRole("button", { name: "Add asset" }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith("evt-1", expect.any(File), "sponsor_logo");
    });
    expect(await screen.findByText("sponsor.png")).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
  });

  it("shows the mapped server error when adding an asset fails (e.g. reserved token)", async () => {
    mockFetch.mockResolvedValueOnce([]);
    mockCreate.mockRejectedValueOnce(new ApiError(409, "reserved_token", "reserved_token"));
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("No images yet");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "event_title" } });
    await pickImageAndApply(new File(["x"], "logo.png", { type: "image/png" }));
    fireEvent.click(screen.getByRole("button", { name: "Add asset" }));

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

    fireEvent.click(screen.getByRole("button", { name: "Delete sponsor.png" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        'Delete "sponsor.png"? If its {{sponsor_logo}} placeholder is still used in this event\'s email template, remove it from the template first.',
      ),
    ).toBeTruthy();
    expect(within(dialog).queryByText(/will stop working/)).toBeNull();
  });

  it("deletes an asset after confirming in the dialog", async () => {
    mockFetch.mockResolvedValueOnce([asset]);
    mockDelete.mockResolvedValueOnce(undefined);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("sponsor.png");

    fireEvent.click(screen.getByRole("button", { name: "Delete sponsor.png" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Delete "sponsor.png"/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

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

    fireEvent.click(screen.getByRole("button", { name: "Delete sponsor.png" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(await within(dialog).findByText("Something went wrong. Try again.")).toBeTruthy();
    expect(screen.getByText("sponsor.png")).toBeTruthy();
  });

  it("disables the add form and delete buttons when disabled", async () => {
    mockFetch.mockResolvedValueOnce([asset]);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" disabled />);
    await screen.findByText("sponsor.png");

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput.disabled).toBe(true);
    expect((screen.getByLabelText("Name") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Add asset" }).hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByRole("button", { name: "Delete sponsor.png" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByText(/This event is archived/)).toBeTruthy();
  });

  it("cancels the delete confirm dialog without calling the API", async () => {
    mockFetch.mockResolvedValueOnce([asset]);
    renderWithToast(<EventImageAssetLibrary eventId="evt-1" />);
    await screen.findByText("sponsor.png");

    fireEvent.click(screen.getByRole("button", { name: "Delete sponsor.png" }));
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
});
