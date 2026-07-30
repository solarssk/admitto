// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FontFamilyModal, styleLabel } from "../../src/settings/FontFamilyModal.js";
import { renderWithToast } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    uploadThemeFont: vi.fn(),
  };
});

import { ApiError, uploadThemeFont } from "../../src/api/client.js";

const mockUploadFont = vi.mocked(uploadThemeFont);

function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLButtonElement).disabled;
}

function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll(".fontfam-row"));
}

function fileInputOf(row: HTMLElement): HTMLInputElement {
  return row.querySelector(".fontfam-row__file input[type=file]") as HTMLInputElement;
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
    expect(within(first!).getByRole("combobox", { name: "Weight" })).toHaveProperty("value", "400");
    expect(within(first!).getByText("regular.woff2")).toBeTruthy();
    expect(within(second!).getByRole("combobox", { name: "Weight" })).toHaveProperty("value", "700");
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
    expect(within(row).getByRole("combobox", { name: "Weight" })).toHaveProperty("value", "700");
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
    expect(within(thinRow!).getByRole("combobox", { name: "Weight" })).toHaveProperty("value", "100");
    expect(within(blackRow!).getByRole("combobox", { name: "Weight" })).toHaveProperty("value", "900");
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
  });

  it("adds an empty row via 'Add a variant manually', picking the next unused weight/style combo", () => {
    renderWithToast(<FontFamilyModal open onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Add a variant manually/ }));
    expect(rows()).toHaveLength(1);
    expect(within(rows()[0]!).getByRole("combobox", { name: "Weight" })).toHaveProperty("value", "100");
    expect(within(rows()[0]!).getByRole("radio", { name: "Normal" }).getAttribute("aria-checked")).toBe("true");
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
    expect(within(first!).getByRole("combobox", { name: "Weight" })).toHaveProperty("value", "400");

    fireEvent.change(within(second!).getByRole("combobox", { name: "Weight" }), { target: { value: "400" } });

    // The change still applies - both rows now read 400/normal...
    expect(within(second!).getByRole("combobox", { name: "Weight" })).toHaveProperty("value", "400");
    // ...but a browser can only ever render one file per combo, so this now blocks Save instead
    // of just a transient, missable toast.
    expect(first!.className).toContain("fontfam-row--duplicate");
    expect(second!.className).toContain("fontfam-row--duplicate");
    expect(screen.getByRole("alert").textContent).toMatch(/only ever shows one file per weight and style/);
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
