// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { FontFamilyModal, styleLabel } from "../../src/settings/FontFamilyModal.js";
import { renderWithToast } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    uploadThemeFont: vi.fn(),
    deleteUploadedFile: vi.fn(),
  };
});

import { ApiError, deleteUploadedFile, uploadThemeFont } from "../../src/api/client.js";

const mockUploadFont = vi.mocked(uploadThemeFont);
const mockDeleteUploadedFile = vi.mocked(deleteUploadedFile);

function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLButtonElement).disabled;
}

function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll(".fontfam-row"));
}

function fileInputOf(row: HTMLElement): HTMLInputElement {
  return row.querySelector(".fontfam-row__file input[type=file]") as HTMLInputElement;
}

/** WEIGHT_OPTIONS labels all end in the numeric weight (e.g. "Regular 400"), so the trigger's
 * own accessible name - "Weight, Regular 400" - carries the value a native combobox would have
 * exposed via .value. */
function weightOf(row: HTMLElement): string {
  const trigger = within(row).getByRole("button", { name: /^Weight,/ });
  return trigger.textContent?.match(/(\d+)$/)?.[1] ?? "";
}

function selectWeight(row: HTMLElement, optionLabel: string): void {
  fireEvent.click(within(row).getByRole("button", { name: /^Weight,/ }));
  fireEvent.click(within(row).getByRole("button", { name: optionLabel }));
}

beforeEach(() => {
  // jsdom implements neither the FontFace constructor nor document.fonts (the CSS Font
  // Loading API) - both are stubbed here for the instant local upload preview.
  class FakeFontFace {
    constructor(
      public family: string,
      public source: unknown,
      public descriptors?: { weight?: string; style?: string },
    ) {}
    async load() {
      return this;
    }
  }
  vi.stubGlobal("FontFace", FakeFontFace);
  Object.defineProperty(document, "fonts", {
    value: { add: vi.fn(), delete: vi.fn() },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "fonts");
});

describe("styleLabel", () => {
  it("formats weight + style into a human label", () => {
    expect(styleLabel(400, "normal")).toBe("Regular");
    expect(styleLabel(700, "normal")).toBe("Bold");
    expect(styleLabel(400, "italic")).toBe("Regular italic");
  });

  it("falls back to the raw numeric weight for a value outside the nine preset options", () => {
    expect(styleLabel(450, "normal")).toBe("450");
    expect(styleLabel(450, "italic")).toBe("450 italic");
  });
});

describe("FontFamilyModal", () => {
  it("renders nothing when closed", () => {
    renderWithToast(<FontFamilyModal open={false} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.queryByText("Create font family")).toBeNull();
  });

  it("pre-fills the family name and rows from initialFamily, each already marked loaded", () => {
    renderWithToast(
      <FontFamilyModal
        open
        onClose={vi.fn()}
        onSaved={vi.fn()}
        initialFamily={{
          name: "Acme Sans",
          variants: [
            { weight: 400, style: "normal", url: "/uploads/default/theme/regular.woff2" },
            { weight: 700, style: "italic", url: "/uploads/default/theme/bold-italic.woff2" },
          ],
        }}
      />,
    );

    expect(screen.getByText('Edit "Acme Sans"')).toBeTruthy();
    expect(screen.getByLabelText("Family name")).toHaveProperty("value", "Acme Sans");
    expect(rows()).toHaveLength(2);
    const [first, second] = rows();
    expect(weightOf(first!)).toBe("400");
    expect(within(first!).getByText("regular.woff2")).toBeTruthy();
    expect(weightOf(second!)).toBe("700");
    expect(within(second!).getByRole("radio", { name: "Italic" }).getAttribute("aria-checked")).toBe("true");
    // Already-saved variants need no re-upload - Save is enabled immediately.
    expect(isDisabled(screen.getByRole("button", { name: "Save font family" }))).toBe(false);
  });

  it("shows the plain create title and starts blank when initialFamily is absent", () => {
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getByText("Create font family")).toBeTruthy();
    expect(screen.getByLabelText("Family name")).toHaveProperty("value", "");
    expect(rows()).toHaveLength(0);
  });

  it("disables Save until a family name and at least one loaded variant are present", async () => {
    mockUploadFont.mockResolvedValueOnce({ url: "/uploads/default/theme/a.woff2" });
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(isDisabled(screen.getByRole("button", { name: "Save font family" }))).toBe(true);

    fireEvent.change(screen.getByLabelText("Family name"), { target: { value: "Acme Sans" } });
    expect(isDisabled(screen.getByRole("button", { name: "Save font family" }))).toBe(true);

    fireEvent.change(screen.getByLabelText(/Drop font files here/), {
      target: { files: [new File(["x"], "Acme-Sans-Regular.woff2")] },
    });
    await waitFor(() => {
      expect(isDisabled(screen.getByRole("button", { name: "Save font family" }))).toBe(false);
    });
  });

  it("guesses weight, style, and family name from the dropped file's filename", async () => {
    mockUploadFont.mockResolvedValueOnce({ url: "/uploads/default/theme/a.woff2" });
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Drop font files here/), {
      target: { files: [new File(["x"], "Acme-Sans-Bold-Italic.woff2")] },
    });

    await waitFor(() => expect(rows()).toHaveLength(1));
    const row = rows()[0]!;
    expect(weightOf(row)).toBe("700");
    expect(within(row).getByRole("radio", { name: "Italic" }).getAttribute("aria-checked")).toBe("true");
    await waitFor(() => expect(screen.getByLabelText("Family name")).toHaveProperty("value", "Acme Sans"));
  });

  it("guesses the out-of-range weights (Thin/Black) too, each with its own matching Select option", async () => {
    mockUploadFont
      .mockResolvedValueOnce({ url: "/uploads/default/theme/a.woff2" })
      .mockResolvedValueOnce({ url: "/uploads/default/theme/b.woff2" });
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Drop font files here/), {
      target: {
        files: [new File(["x"], "Acme-Sans-Thin.woff2"), new File(["x"], "Acme-Sans-Black.woff2")],
      },
    });

    await waitFor(() => expect(rows()).toHaveLength(2));
    const [thinRow, blackRow] = rows();
    expect(weightOf(thinRow!)).toBe("100");
    expect(weightOf(blackRow!)).toBe("900");
  });

  it("uploads the dropped file to the server and shows it as loaded", async () => {
    mockUploadFont.mockResolvedValueOnce({ url: "/uploads/default/theme/abc123.woff2" });
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Drop font files here/), {
      target: { files: [new File(["x"], "Acme-Sans-Regular.woff2")] },
    });

    await waitFor(() => {
      expect(rows()[0]!.className).toContain("fontfam-row");
      expect(fileInputOf(rows()[0]!).closest(".fontfam-row__file")?.className).toContain("fontfam-row__file--loaded");
    });
    expect(mockUploadFont).toHaveBeenCalledTimes(1);
  });

  it("rejects an unsupported file extension client-side, without calling the upload API", async () => {
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Drop font files here/), {
      target: { files: [new File(["x"], "not-a-font.exe")] },
    });

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/\.woff, \.woff2, \.ttf, or \.otf/);
    });
    expect(mockUploadFont).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(0);
  });

  it("rolls back the row and toasts an operator-safe error when the server upload fails", async () => {
    mockUploadFont.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Drop font files here/), {
      target: { files: [new File(["x"], "Acme-Sans-Regular.woff2")] },
    });

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Couldn't upload "Acme-Sans-Regular\.woff2"/);
    });
    expect(screen.queryByText("secret_internal")).toBeNull();
    expect(rows()).toHaveLength(0);
  });

  it("rolls back without a registered preview face when FontFace.load fails before upload", async () => {
    class FailFontFace {
      constructor(
        public family: string,
        public source: unknown,
        public descriptors?: { weight?: string; style?: string },
      ) {}
      async load(): Promise<this> {
        throw new Error("decode failed");
      }
    }
    vi.stubGlobal("FontFace", FailFontFace);
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Drop font files here/), {
      target: { files: [new File(["x"], "Acme-Sans-Regular.woff2")] },
    });

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Couldn't upload "Acme-Sans-Regular\.woff2"/);
    });
    expect(mockUploadFont).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(0);
  });

  it("reverts (not removes) an existing row when replacing its file fails to upload", async () => {
    mockUploadFont
      .mockResolvedValueOnce({ url: "/uploads/default/theme/first.woff2" })
      .mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Drop font files here/), {
      target: { files: [new File(["x"], "Acme-Sans-Regular.woff2")] },
    });
    await waitFor(() => expect(rows()).toHaveLength(1));
    const row = rows()[0]!;

    fireEvent.change(fileInputOf(row), { target: { files: [new File(["y"], "Acme-Sans-Regular-v2.woff2")] } });

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Couldn't upload "Acme-Sans-Regular-v2\.woff2"/);
    });
    expect(rows()).toHaveLength(1);
    expect(within(rows()[0]!).getByText("Choose file")).toBeTruthy();
  });

  it("rejects an unsupported file extension when replacing an existing row's file, leaving it unchanged", async () => {
    mockUploadFont.mockResolvedValueOnce({ url: "/uploads/default/theme/first.woff2" });
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Drop font files here/), {
      target: { files: [new File(["x"], "Acme-Sans-Regular.woff2")] },
    });
    await waitFor(() => expect(rows()).toHaveLength(1));
    const row = rows()[0]!;

    fireEvent.change(fileInputOf(row), { target: { files: [new File(["y"], "not-a-font.exe")] } });

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/\.woff, \.woff2, \.ttf, or \.otf/);
    });
    expect(mockUploadFont).toHaveBeenCalledTimes(1);
    expect(within(rows()[0]!).getByText("Acme-Sans-Regular.woff2")).toBeTruthy();
  });

  it("discards a still-loading upload immediately when a newer file pick for the same row arrives first", async () => {
    let resolveFirstBuffer!: (v: ArrayBuffer) => void;
    const firstFile = new File(["x"], "Acme-Sans-Regular.woff2");
    firstFile.arrayBuffer = () => new Promise((resolve) => (resolveFirstBuffer = resolve));

    mockUploadFont.mockResolvedValueOnce({ url: "/uploads/default/theme/second.woff2" });
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Drop font files here/), { target: { files: [firstFile] } });
    await waitFor(() => expect(rows()).toHaveLength(1));
    const row = rows()[0]!;

    fireEvent.change(fileInputOf(row), { target: { files: [new File(["y"], "Acme-Sans-Regular-v2.woff2")] } });
    await waitFor(() => expect(mockUploadFont).toHaveBeenCalledTimes(1));

    resolveFirstBuffer(new ArrayBuffer(1));
    await new Promise((r) => setTimeout(r, 0));

    // The stale first load never reached the upload step - only the newer pick's file was sent.
    expect(mockUploadFont).toHaveBeenCalledTimes(1);
  });

  it("drops multiple files at once into separate rows, one per weight/style combo", async () => {
    mockUploadFont
      .mockResolvedValueOnce({ url: "/uploads/default/theme/regular.woff2" })
      .mockResolvedValueOnce({ url: "/uploads/default/theme/bold.woff2" });
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Drop font files here/), {
      target: {
        files: [new File(["x"], "Acme-Sans-Regular.woff2"), new File(["x"], "Acme-Sans-Bold.woff2")],
      },
    });

    await waitFor(() => expect(rows()).toHaveLength(2));
    await waitFor(() => expect(mockUploadFont).toHaveBeenCalledTimes(2));
  });

  it("replacing a dropped file with the same weight/style combo overwrites that row instead of duplicating", async () => {
    mockUploadFont
      .mockResolvedValueOnce({ url: "/uploads/default/theme/first.woff2" })
      .mockResolvedValueOnce({ url: "/uploads/default/theme/second.woff2" });
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Drop font files here/), {
      target: { files: [new File(["x"], "Acme-Sans-Regular.woff2")] },
    });
    await waitFor(() => expect(rows()).toHaveLength(1));

    fireEvent.change(screen.getByLabelText(/Drop font files here/), {
      target: { files: [new File(["x"], "Acme-Sans-Regular-v2.woff2")] },
    });

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Replaced 1 existing variant/);
    });
    expect(rows()).toHaveLength(1);
    await waitFor(() => {
      expect(mockDeleteUploadedFile).toHaveBeenCalledWith("/uploads/default/theme/first.woff2");
    });
  });

  it("keeps the newest file's result for a row even if an earlier, still-in-flight upload for it resolves later", async () => {
    let resolveFirst!: (v: { url: string }) => void;
    let resolveSecond!: (v: { url: string }) => void;
    mockUploadFont
      .mockReturnValueOnce(new Promise((res) => (resolveFirst = res)))
      .mockReturnValueOnce(new Promise((res) => (resolveSecond = res)));
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Drop font files here/), {
      target: { files: [new File(["x"], "Acme-Sans-Regular.woff2")] },
    });
    await waitFor(() => expect(rows()).toHaveLength(1));
    const row = rows()[0]!;

    // Pick a different file for the same row before the first upload has resolved.
    fireEvent.change(fileInputOf(row), { target: { files: [new File(["y"], "Acme-Sans-Bold.woff2")] } });
    await waitFor(() => expect(mockUploadFont).toHaveBeenCalledTimes(2));

    // Resolve the newer (second) upload, then the stale first one afterwards.
    resolveSecond({ url: "/uploads/default/theme/second.woff2" });
    await waitFor(() => expect(within(row).getByText("Acme-Sans-Bold.woff2")).toBeTruthy());
    resolveFirst({ url: "/uploads/default/theme/first.woff2" });
    await new Promise((r) => setTimeout(r, 0));

    expect(within(row).getByText("Acme-Sans-Bold.woff2")).toBeTruthy();
    expect(rows()).toHaveLength(1);
    expect(mockDeleteUploadedFile).toHaveBeenCalledWith("/uploads/default/theme/first.woff2");
  });

  it("silently ignores a stale upload's own rejection once a newer pick has already replaced it", async () => {
    let rejectFirst!: (err: Error) => void;
    mockUploadFont
      .mockReturnValueOnce(new Promise((_, rej) => (rejectFirst = rej)))
      .mockResolvedValueOnce({ url: "/uploads/default/theme/second.woff2" });
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Drop font files here/), {
      target: { files: [new File(["x"], "Acme-Sans-Regular.woff2")] },
    });
    await waitFor(() => expect(rows()).toHaveLength(1));
    const row = rows()[0]!;

    fireEvent.change(fileInputOf(row), { target: { files: [new File(["y"], "Acme-Sans-Bold.woff2")] } });
    await waitFor(() => expect(within(row).getByText("Acme-Sans-Bold.woff2")).toBeTruthy());

    rejectFirst(new Error("stale network failure"));
    await new Promise((r) => setTimeout(r, 0));

    // The stale (superseded) request's own rejection is ignored - no toast, and the row still
    // shows the newer file rather than being rolled back by the older, abandoned attempt.
    expect(screen.queryByTestId("at-toast")).toBeNull();
    expect(within(row).getByText("Acme-Sans-Bold.woff2")).toBeTruthy();
  });

  it("adds an empty row via 'Add a variant manually', picking the next unused weight/style combo", () => {
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Add a variant manually/ }));
    expect(rows()).toHaveLength(1);
    expect(weightOf(rows()[0]!)).toBe("100");
    expect(within(rows()[0]!).getByRole("radio", { name: "Normal" }).getAttribute("aria-checked")).toBe("true");
  });

  it("shows an info toast instead of a 19th row once every weight/style combination is already used", () => {
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);
    const addButton = screen.getByRole("button", { name: /Add a variant manually/ });

    for (let i = 0; i < 18; i++) {
      fireEvent.click(addButton);
    }
    expect(rows()).toHaveLength(18);

    fireEvent.click(addButton);
    expect(rows()).toHaveLength(18);
    expect(screen.getByTestId("at-toast").textContent).toMatch(/All weight and style combinations are already added/);
  });

  it("changes a row's style via the Normal/Italic toggle", async () => {
    mockUploadFont.mockResolvedValueOnce({ url: "/uploads/default/theme/a.woff2" });
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Drop font files here/), {
      target: { files: [new File(["x"], "Acme-Sans-Regular.woff2")] },
    });
    await waitFor(() => expect(rows()).toHaveLength(1));
    const row = rows()[0]!;
    expect(within(row).getByRole("radio", { name: "Normal" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(within(row).getByRole("radio", { name: "Italic" }));
    expect(within(row).getByRole("radio", { name: "Italic" }).getAttribute("aria-checked")).toBe("true");
  });

  it("shows the drag-over state on drag over and clears it on drag leave", () => {
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);
    const dropzone = document.querySelector(".fontfam-dropzone") as HTMLElement;

    fireEvent.dragOver(dropzone);
    expect(dropzone.className).toContain("fontfam-dropzone--over");

    fireEvent.dragLeave(dropzone);
    expect(dropzone.className).not.toContain("fontfam-dropzone--over");
  });

  it("accepts a file dropped directly onto the dropzone, same as picking one via the hidden input", async () => {
    mockUploadFont.mockResolvedValueOnce({ url: "/uploads/default/theme/a.woff2" });
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);
    const dropzone = document.querySelector(".fontfam-dropzone") as HTMLElement;

    fireEvent.dragOver(dropzone);
    fireEvent.drop(dropzone, { dataTransfer: { files: [new File(["x"], "Acme-Sans-Regular.woff2")] } });

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(dropzone.className).not.toContain("fontfam-dropzone--over");
  });

  it("removes a row via its own remove button", async () => {
    mockUploadFont.mockResolvedValueOnce({ url: "/uploads/default/theme/a.woff2" });
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Drop font files here/), {
      target: { files: [new File(["x"], "Acme-Sans-Regular.woff2")] },
    });
    await waitFor(() => expect(rows()).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Remove variant" }));
    expect(rows()).toHaveLength(0);
    // Disk cleanup is deferred to Cancel/Save so save() can drop abandoned session URLs.
    expect(mockDeleteUploadedFile).not.toHaveBeenCalled();
  });

  it("Save deletes session uploads for variants removed before saving", async () => {
    mockUploadFont
      .mockResolvedValueOnce({ url: "/uploads/default/theme/keep.woff2" })
      .mockResolvedValueOnce({ url: "/uploads/default/theme/drop.woff2" });
    const onSaved = vi.fn();
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText(/Drop font files here/), {
      target: {
        files: [
          new File(["x"], "Acme-Sans-Regular.woff2"),
          new File(["y"], "Acme-Sans-Bold.woff2"),
        ],
      },
    });
    await waitFor(() => expect(rows()).toHaveLength(2));
    await waitFor(() => expect(mockUploadFont).toHaveBeenCalledTimes(2));

    fireEvent.change(screen.getByLabelText("Family name"), { target: { value: "Acme Sans" } });
    // Remove the second variant; its upload stays in the session set until Save.
    fireEvent.click(screen.getAllByRole("button", { name: "Remove variant" })[1]!);
    expect(rows()).toHaveLength(1);
    mockDeleteUploadedFile.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Save font family" }));
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(mockDeleteUploadedFile).toHaveBeenCalledWith("/uploads/default/theme/drop.woff2");
    expect(mockDeleteUploadedFile).not.toHaveBeenCalledWith("/uploads/default/theme/keep.woff2");
  });

  it("removes an empty (never-uploaded) row cleanly", () => {
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Add a variant manually/ }));
    expect(rows()).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Remove variant" }));
    expect(rows()).toHaveLength(0);
  });

  it("stops registering preview faces for a pre-filled family once the modal unmounts mid-load", async () => {
    let resolveLoad!: () => void;
    class ControllableFontFace {
      constructor(
        public family: string,
        public source: unknown,
        public descriptors?: { weight?: string; style?: string },
      ) {}
      async load() {
        await new Promise<void>((resolve) => (resolveLoad = resolve));
        return this;
      }
    }
    vi.stubGlobal("FontFace", ControllableFontFace);
    const { unmount } = renderWithToast(
      <FontFamilyModal
        open
        onClose={vi.fn()}
        onSaved={vi.fn()}
        initialFamily={{
          name: "Acme Sans",
          variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/a.woff2" }],
        }}
      />,
    );

    unmount();
    resolveLoad();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.fonts.add).not.toHaveBeenCalled();
  });

  it("shows plural wording when multiple unsupported files are skipped at once", async () => {
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Drop font files here/), {
      target: { files: [new File(["x"], "a.exe"), new File(["y"], "b.exe")] },
    });

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Skipped 2 files/);
    });
  });

  it("leaves the family name blank when nothing but a weight/style keyword can be guessed from the filename", async () => {
    mockUploadFont.mockResolvedValueOnce({ url: "/uploads/default/theme/a.woff2" });
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Drop font files here/), {
      target: { files: [new File(["x"], "Bold.woff2")] },
    });

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByLabelText("Family name")).toHaveProperty("value", "");
  });

  it("shows plural wording when multiple dropped files replace existing rows at once", async () => {
    mockUploadFont
      .mockResolvedValueOnce({ url: "/uploads/default/theme/first.woff2" })
      .mockResolvedValueOnce({ url: "/uploads/default/theme/second.woff2" })
      .mockResolvedValueOnce({ url: "/uploads/default/theme/third.woff2" })
      .mockResolvedValueOnce({ url: "/uploads/default/theme/fourth.woff2" });
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Drop font files here/), {
      target: {
        files: [new File(["x"], "Acme-Sans-Regular.woff2"), new File(["y"], "Acme-Sans-Bold.woff2")],
      },
    });
    await waitFor(() => expect(rows()).toHaveLength(2));

    fireEvent.change(screen.getByLabelText(/Drop font files here/), {
      target: {
        files: [new File(["x2"], "Acme-Sans-Regular-v2.woff2"), new File(["y2"], "Acme-Sans-Bold-v2.woff2")],
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Replaced 2 existing variants with the new files/);
    });
  });

  it("blocks Save and flags both rows when manually changing one to a combo already used by a loaded row", async () => {
    mockUploadFont
      .mockResolvedValueOnce({ url: "/uploads/default/theme/regular.woff2" })
      .mockResolvedValueOnce({ url: "/uploads/default/theme/bold.woff2" });
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Drop font files here/), {
      target: {
        files: [new File(["x"], "Acme-Sans-Regular.woff2"), new File(["x"], "Acme-Sans-Bold.woff2")],
      },
    });
    await waitFor(() => {
      expect(isDisabled(screen.getByRole("button", { name: "Save font family" }))).toBe(false);
    });
    const [first, second] = rows();
    expect(weightOf(first!)).toBe("400");

    selectWeight(second!, "Regular 400");

    // The change still applies - both rows now read 400/normal...
    expect(weightOf(second!)).toBe("400");
    // ...but a browser can only ever render one file per combo, so this now blocks Save instead
    // of just a transient, missable toast.
    expect(first!.className).toContain("fontfam-row--duplicate");
    expect(second!.className).toContain("fontfam-row--duplicate");
    expect(screen.getByRole("alert").textContent).toMatch(/already loaded in another row/);
    expect(isDisabled(screen.getByRole("button", { name: "Save font family" }))).toBe(true);
  });

  it("blocks Save and shows an inline error when the family name matches a built-in font, case-insensitively", async () => {
    mockUploadFont.mockResolvedValueOnce({ url: "/uploads/default/theme/regular.woff2" });
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Drop font files here/), {
      target: { files: [new File(["x"], "Acme-Sans-Regular.woff2")] },
    });
    await waitFor(() => {
      expect(isDisabled(screen.getByRole("button", { name: "Save font family" }))).toBe(false);
    });

    fireEvent.change(screen.getByLabelText("Family name"), { target: { value: "space grotesk" } });

    expect(screen.getByText(/is a built-in font name/)).toBeTruthy();
    expect(isDisabled(screen.getByRole("button", { name: "Save font family" }))).toBe(true);
  });

  it("calls onSaved with the family name and every loaded variant's weight/style/url, and closes", async () => {
    mockUploadFont
      .mockResolvedValueOnce({ url: "/uploads/default/theme/regular.woff2" })
      .mockResolvedValueOnce({ url: "/uploads/default/theme/bold.woff2" });
    const onSaved = vi.fn();
    const onClose = vi.fn();
    renderWithToast(<FontFamilyModal open onClose={onClose} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText(/Drop font files here/), {
      target: {
        files: [new File(["x"], "Acme-Sans-Regular.woff2"), new File(["x"], "Acme-Sans-Bold.woff2")],
      },
    });
    await waitFor(() => expect(mockUploadFont).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(isDisabled(screen.getByRole("button", { name: "Save font family" }))).toBe(false);
    });

    fireEvent.click(screen.getByRole("button", { name: "Save font family" }));

    expect(onSaved).toHaveBeenCalledWith({
      familyName: "Acme Sans",
      variants: expect.arrayContaining([
        { weight: 400, style: "normal", url: "/uploads/default/theme/regular.woff2" },
        { weight: 700, style: "normal", url: "/uploads/default/theme/bold.woff2" },
      ]),
    });
    expect(onSaved.mock.calls[0]![0].variants).toHaveLength(2);
  });

  it("Cancel closes without calling onSaved", () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    renderWithToast(<FontFamilyModal open onClose={onClose} onSaved={onSaved} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("Cancel after upload best-effort deletes session font files", async () => {
    mockUploadFont.mockResolvedValueOnce({ url: "/uploads/default/theme/regular.woff2" });
    const onClose = vi.fn();
    renderWithToast(<FontFamilyModal open onClose={onClose} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Drop font files here/), {
      target: { files: [new File(["x"], "Acme-Sans-Regular.woff2")] },
    });
    await waitFor(() => expect(mockUploadFont).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockDeleteUploadedFile).toHaveBeenCalledWith("/uploads/default/theme/regular.woff2");
  });

  it("closing the modal after a row upload bumps row generations so late results are ignored", async () => {
    mockUploadFont.mockResolvedValueOnce({ url: "/uploads/default/theme/regular.woff2" });
    function Harness() {
      const [open, setOpen] = useState(true);
      return <FontFamilyModal open={open} onClose={() => setOpen(false)} onSaved={vi.fn()} />;
    }
    renderWithToast(<Harness />);

    fireEvent.change(screen.getByLabelText(/Drop font files here/), {
      target: { files: [new File(["x"], "Acme-Sans-Regular.woff2")] },
    });
    await waitFor(() => expect(mockUploadFont).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Acme-Sans-Regular\.woff2/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByText("Create font family")).toBeNull();
    });
    // Session uploads were discarded on close; a second open starts clean.
    expect(mockDeleteUploadedFile).toHaveBeenCalledWith("/uploads/default/theme/regular.woff2");
  });

  it("unmount while open discards session font uploads the parent never received", async () => {
    mockUploadFont.mockResolvedValueOnce({ url: "/uploads/default/theme/orphan.woff2" });
    const { unmount } = renderWithToast(
      <FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText(/Drop font files here/), {
      target: { files: [new File(["x"], "Acme-Sans-Regular.woff2")] },
    });
    await waitFor(() => expect(mockUploadFont).toHaveBeenCalledTimes(1));

    unmount();
    expect(mockDeleteUploadedFile).toHaveBeenCalledWith("/uploads/default/theme/orphan.woff2");
  });

  it("disables Save while any row upload is still in flight, even with a name and no other blockers", () => {
    mockUploadFont.mockReturnValueOnce(new Promise(() => {}));
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Family name"), { target: { value: "Acme Sans" } });
    fireEvent.change(screen.getByLabelText(/Drop font files here/), {
      target: { files: [new File(["x"], "Acme-Sans-Regular.woff2")] },
    });

    expect(isDisabled(screen.getByRole("button", { name: "Save font family" }))).toBe(true);
  });
});
