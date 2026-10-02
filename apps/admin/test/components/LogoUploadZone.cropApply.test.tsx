// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import { LogoUploadZone } from "../../src/components/LogoUploadZone.js";
import { renderWithToast } from "../test-utils.js";

// The real CropImageModal (the zone's own tests stub it): a failed Apply must be said by the dialog
// itself, and the dialog must be usable again afterwards.
vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  deleteUploadedFile: vi.fn(),
}));

vi.mock("../../src/components/crop/getCroppedImageBlob.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/components/crop/getCroppedImageBlob.js")>()),
  getCroppedImageBlob: vi.fn(),
}));

import { getCroppedImageBlob } from "../../src/components/crop/getCroppedImageBlob.js";

const LOGO = "/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png";
const ORIGINAL = "/uploads/default/b2c3d4e5-f6a7-8901-bcde-f12345678901.png";
const RETRIED = "/uploads/default/c3d4e5f6-a7b8-9012-cdef-123456789012.png";

// Busy, the button is named "Applying…" and is `aria-disabled`, never `disabled`: so "usable" means it
// is found under its resting name and is neither busy nor `aria-disabled`.
const applyButton = (dialog: HTMLElement) =>
  within(dialog).getByRole("button", { name: "Apply changes" }) as HTMLButtonElement;
const isUsable = (button: HTMLButtonElement) =>
  !button.disabled &&
  button.getAttribute("aria-disabled") === null &&
  button.getAttribute("aria-busy") === null;

beforeEach(() => {
  // jsdom never loads the image, so give it a size for the modal to fit and seed a crop from.
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(400);
  vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(80);
  vi.mocked(getCroppedImageBlob).mockResolvedValue(new Blob(["cropped"], { type: "image/png" }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LogoUploadZone with the real crop dialog", () => {
  it("says a failed cropped upload inside the dialog, re-enables Apply, and a retry closes it", async () => {
    const upload = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(415, "unsupported_file_type"))
      .mockResolvedValueOnce({ url: RETRIED });
    const onChange = vi.fn();
    renderWithToast(
      <LogoUploadZone value={LOGO} originalUrl={ORIGINAL} onChange={onChange} uploadFn={upload} />,
    );

    // Edit (a click, so the modal mounts and its effects flush inside act) rather than a file pick:
    // the pick mounts it from an async continuation, where a `load` that beats the modal's mount
    // effect gets reset and the dialog stays on its loading state.
    fireEvent.click(screen.getByRole("button", { name: "Edit image" }));
    const dialog = screen.getByRole("dialog", { name: "Adjust organisation logo" });
    fireEvent.load(document.querySelector("img.crop-image-modal__img") as HTMLImageElement);
    await waitFor(() => {
      expect(isUsable(applyButton(dialog))).toBe(true);
    });

    fireEvent.click(applyButton(dialog));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toMatch(/Unsupported file type/);
    // Nothing is said on the zone behind the dialog's backdrop.
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    await waitFor(() => {
      expect(isUsable(applyButton(dialog))).toBe(true);
    });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(applyButton(dialog));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(onChange).toHaveBeenCalledWith(RETRIED);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
