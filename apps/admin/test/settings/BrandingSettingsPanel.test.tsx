// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrandingSettingsPanel } from "../../src/settings/BrandingSettingsPanel.js";
import { renderWithToast } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchOrgBranding: vi.fn(),
    patchOrgBranding: vi.fn(),
    fetchStaffTheme: vi.fn(),
    saveStaffTheme: vi.fn(),
    uploadFile: vi.fn(),
  };
});

// The modal owns its own dropzone/upload/FontFace-preview behavior, covered by its own
// dedicated FontFamilyModal.test.tsx - stubbed here so this file only exercises how the panel
// wires the modal's result into the theme draft, not the modal's own internals.
vi.mock("../../src/settings/FontFamilyModal.js", () => ({
  styleLabel: (weight: number, style: string) => `${weight}${style === "italic" ? " italic" : ""}`,
  FontFamilyModal: ({
    open,
    onSaved,
    initialFamily,
  }: {
    open: boolean;
    onSaved: (result: { familyName: string; variants: Array<{ weight: number; style: string; url: string }> }) => void;
    initialFamily?: { name: string; variants: Array<{ weight: number; style: string; url: string }> } | null;
  }) =>
    open ? (
      <div>
        mock-font-family-modal
        {initialFamily && <div>editing: {initialFamily.name}</div>}
        <button
          type="button"
          onClick={() =>
            onSaved({
              familyName: initialFamily?.name ?? "Acme Sans",
              variants: initialFamily?.variants ?? [
                { weight: 400, style: "normal", url: "/uploads/default/theme/abc123.woff2" },
              ],
            })
          }
        >
          mock-save-family
        </button>
        {initialFamily && (
          <button
            type="button"
            onClick={() => onSaved({ familyName: `${initialFamily.name} Renamed`, variants: initialFamily.variants })}
          >
            mock-save-family-renamed
          </button>
        )}
      </div>
    ) : null,
}));

import {
  ApiError,
  fetchOrgBranding,
  fetchStaffTheme,
  patchOrgBranding,
  saveStaffTheme,
  uploadFile,
} from "../../src/api/client.js";

const mockFetchOrg = vi.mocked(fetchOrgBranding);
const mockPatchOrg = vi.mocked(patchOrgBranding);
const mockFetchTheme = vi.mocked(fetchStaffTheme);
const mockSaveTheme = vi.mocked(saveStaffTheme);
const mockUploadFile = vi.mocked(uploadFile);

function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLInputElement | HTMLButtonElement).disabled;
}

const defaultOrg = { org_name: "Acme Corp", logo_url: "" };
const defaultTheme = { theme: {} };

beforeEach(() => {
  // jsdom implements neither the FontFace constructor nor document.fonts (the CSS Font Loading
  // API) - both are stubbed here for the panel's own "preview every saved custom family" effect
  // (independent of FontFamilyModal, which is mocked out above and would otherwise be the only
  // thing needing this in this file).
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "fonts");
});

describe("BrandingSettingsPanel — loading and errors", () => {
  it("shows the loading placeholder once the fetch has genuinely taken a moment", () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    renderWithToast(<BrandingSettingsPanel />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText("Loading branding settings…")).toBeTruthy();
  });

  it("shows an operator-safe inline message with Retry when loading fails, without a toast", async () => {
    mockFetchOrg.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/Failed to load branding settings/);
    expect(screen.queryByText("secret_internal")).toBeNull();
    expect(screen.queryByTestId("at-toast")).toBeNull();
  });

  it("recovers on Retry", async () => {
    mockFetchOrg.mockRejectedValueOnce(new Error("network"));
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());

    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Organisation name")).toBeTruthy();
    });
  });
});

describe("BrandingSettingsPanel — organisation fields", () => {
  it("loads and displays the saved organisation name and logo preview", async () => {
    mockFetchOrg.mockResolvedValueOnce({ org_name: "Acme Corp", logo_url: "https://cdn.example.com/logo.png" });
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("Organisation name")).toHaveProperty("value", "Acme Corp");
    });
    expect(screen.getByAltText(/organisation logo preview/i)).toBeTruthy();
  });

  it("blocks save with an empty organisation name, without calling either API", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => expect(screen.getByLabelText("Organisation name")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Organisation name"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText("Organisation name is required.")).toBeTruthy();
    });
    expect(mockPatchOrg).not.toHaveBeenCalled();
    expect(mockSaveTheme).not.toHaveBeenCalled();
  });

  it("blocks save with a non-HTTPS logo URL, without calling either API", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => expect(screen.getByLabelText("Organisation name")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Use a web link instead" }));
    fireEvent.change(screen.getByLabelText("Web link to your logo (must start with https://)"), {
      target: { value: "http://insecure.example.com/logo.png" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Logo must be a valid HTTPS URL/);
    });
    expect(mockPatchOrg).not.toHaveBeenCalled();
    expect(mockSaveTheme).not.toHaveBeenCalled();
  });

  it("disables Save and Reset while a logo upload is in flight", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    let resolveUpload!: (result: { url: string }) => void;
    mockUploadFile.mockReturnValueOnce(new Promise((resolve) => (resolveUpload = resolve)));
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => expect(screen.getByLabelText("Organisation name")).toBeTruthy());

    const [logoInput] = document.querySelectorAll(".logo-upload__file-input");
    fireEvent.change(logoInput!, {
      target: { files: [new File(["x"], "logo.png", { type: "image/png" })] },
    });

    await waitFor(() => {
      expect(isDisabled(screen.getByRole("button", { name: "Save" }))).toBe(true);
    });
    expect(isDisabled(screen.getByRole("button", { name: "Reset to saved" }))).toBe(true);

    resolveUpload({ url: "/uploads/default/logo.png" });
    await waitFor(() => {
      expect(isDisabled(screen.getByRole("button", { name: "Save" }))).toBe(false);
    });
  });
});

describe("BrandingSettingsPanel — colour palette", () => {
  it("shows the Admitto blue palette swatch active by default", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => expect(screen.getByLabelText("Organisation name")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Admitto blue" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("selects a different palette colour on click", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => expect(screen.getByLabelText("Organisation name")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Violet" }));
    expect(screen.getByRole("button", { name: "Violet" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Admitto blue" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText(/Unsaved changes/)).toBeTruthy();
  });

  it("shows the custom swatch active and its hex when the saved primary isn't in the palette", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce({ theme: { primary: "#123456" } });
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => expect(screen.getByLabelText("Organisation name")).toBeTruthy());
    expect(document.querySelector("code")?.textContent).toBe("#123456");
  });

  it("switches to custom mode via the native colour picker", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => expect(screen.getByLabelText("Organisation name")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Custom colour picker"), { target: { value: "#abcdef" } });
    expect(document.querySelector("code")?.textContent).toBe("#abcdef");
  });

  it("Restore defaults reverts colour and font to Admitto's own defaults without touching organisation name/logo", async () => {
    mockFetchOrg.mockResolvedValueOnce({ org_name: "Acme Corp", logo_url: "https://cdn.example.com/logo.png" });
    mockFetchTheme.mockResolvedValueOnce({
      theme: {
        primary: "#123456",
        font_family_name: "Old Font",
        custom_font_families: [
          { name: "Old Font", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/old.woff2" }] },
        ],
      },
    });
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => expect(screen.getByLabelText("Organisation name")).toBeTruthy());
    expect(document.querySelector("code")?.textContent).toBe("#123456");

    fireEvent.click(screen.getByRole("button", { name: "Restore defaults" }));

    expect(screen.getByRole("button", { name: "Admitto blue" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Admitto Sans/ }).closest(".font-option-card")!.className).toContain("font-option-card--active");
    expect(document.querySelector("code")).toBeNull();
    expect(screen.getByLabelText("Organisation name")).toHaveProperty("value", "Acme Corp");
    expect(screen.getByAltText(/organisation logo preview/i)).toBeTruthy();
  });
});

describe("BrandingSettingsPanel — font picker", () => {
  it("shows Admitto Sans active by default", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => expect(screen.getByLabelText("Organisation name")).toBeTruthy());
    expect(screen.getByRole("button", { name: /Admitto Sans/ }).closest(".font-option-card")!.className).toContain("font-option-card--active");
  });

  it("selects a built-in font as active without deleting a previously-saved custom family from the library", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce({
      theme: {
        font_family_name: "Old Font",
        custom_font_families: [
          { name: "Old Font", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/old.woff2" }] },
        ],
      },
    });
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => expect(screen.getByLabelText("Organisation name")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /IBM Plex Sans/ }));
    expect(screen.getByRole("button", { name: /IBM Plex Sans/ }).closest(".font-option-card")!.className).toContain("font-option-card--active");
    expect(screen.getByText(/Unsaved changes/)).toBeTruthy();
    // Still shown in the picker (not deleted) even though it's no longer the active pick.
    expect(screen.getByText("Old Font")).toBeTruthy();
  });

  it("shows the real uploaded style list on the custom tile for an already-saved family", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce({
      theme: {
        font_family_name: "Acme Sans",
        custom_font_families: [
          {
            name: "Acme Sans",
            variants: [
              { weight: 400, style: "normal", url: "/uploads/default/theme/a.woff2" },
              { weight: 700, style: "normal", url: "/uploads/default/theme/b.woff2" },
            ],
          },
        ],
      },
    });
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => expect(screen.getByLabelText("Organisation name")).toBeTruthy());

    const customTile = screen.getByText("Acme Sans").closest(".font-option-card");
    expect(customTile).not.toBeNull();
    expect(customTile!.className).toContain("font-option-card--active");
    expect(within(customTile as HTMLElement).getByText("2 styles")).toBeTruthy();
  });

  it("opens the font family modal when the Custom font tile is clicked", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => expect(screen.getByLabelText("Organisation name")).toBeTruthy());

    expect(screen.queryByText("mock-font-family-modal")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Custom font/ }));
    expect(screen.getByText("mock-font-family-modal")).toBeTruthy();
  });

  it("replaces the Custom font upload tile with a locked state once 8 families are already saved", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce({
      theme: {
        font_family_name: "Family 1",
        custom_font_families: Array.from({ length: 8 }, (_, i) => ({
          name: `Family ${i + 1}`,
          variants: [{ weight: 400, style: "normal", url: `/uploads/default/theme/${i}.woff2` }],
        })),
      },
    });
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => expect(screen.getByLabelText("Organisation name")).toBeTruthy());

    expect(screen.queryByRole("button", { name: /^Custom font/ })).toBeNull();
    expect(screen.getByText("Limit reached")).toBeTruthy();
  });

  it("wires the modal's saved family into the theme draft, active tile, and eventual Save", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    mockPatchOrg.mockResolvedValueOnce(defaultOrg);
    mockSaveTheme.mockResolvedValueOnce({
      theme: {
        font_family_name: "Acme Sans",
        custom_font_families: [
          { name: "Acme Sans", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/abc123.woff2" }] },
        ],
      },
    });
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => expect(screen.getByLabelText("Organisation name")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /^Custom font/ }));
    fireEvent.click(screen.getByText("mock-save-family"));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Saved.*Acme Sans/);
    });
    const customTile = screen.getByText("Acme Sans").closest(".font-option-card");
    expect(customTile).not.toBeNull();
    expect(customTile!.className).toContain("font-option-card--active");
    expect(screen.queryByText("mock-font-family-modal")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(mockSaveTheme).toHaveBeenCalledWith(
        expect.objectContaining({
          font_family_name: "Acme Sans",
          custom_font_families: [
            { name: "Acme Sans", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/abc123.woff2" }] },
          ],
        }),
      );
    });
  });

  it("switches the active pick between two saved custom families without losing either", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce({
      theme: {
        font_family_name: "First Family",
        custom_font_families: [
          { name: "First Family", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/a.woff2" }] },
          { name: "Second Family", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/b.woff2" }] },
        ],
      },
    });
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => expect(screen.getByLabelText("Organisation name")).toBeTruthy());

    const firstTile = screen.getByText("First Family").closest(".font-option-card")!;
    const secondTile = screen.getByText("Second Family").closest(".font-option-card")!;
    expect(firstTile.className).toContain("font-option-card--active");
    expect(secondTile.className).not.toContain("font-option-card--active");

    fireEvent.click(secondTile.querySelector(".font-option-card__select")!);

    expect(screen.getByText("First Family").closest(".font-option-card")!.className).not.toContain("font-option-card--active");
    expect(screen.getByText("Second Family").closest(".font-option-card")!.className).toContain("font-option-card--active");
  });

  it("clicking Edit on a saved custom family opens the modal pre-filled with that family", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce({
      theme: {
        font_family_name: "Acme Sans",
        custom_font_families: [
          { name: "Acme Sans", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/a.woff2" }] },
        ],
      },
    });
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => expect(screen.getByLabelText("Organisation name")).toBeTruthy());

    expect(screen.queryByText("mock-font-family-modal")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit Acme Sans" }));

    expect(screen.getByText("mock-font-family-modal")).toBeTruthy();
    expect(screen.getByText("editing: Acme Sans")).toBeTruthy();
  });

  it("saving an edited family under the same name replaces it in place instead of duplicating it, keeping active status", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce({
      theme: {
        font_family_name: "Acme Sans",
        custom_font_families: [
          { name: "Acme Sans", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/a.woff2" }] },
        ],
      },
    });
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => expect(screen.getByLabelText("Organisation name")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Edit Acme Sans" }));
    fireEvent.click(screen.getByText("mock-save-family"));

    expect(screen.getAllByText("Acme Sans")).toHaveLength(1);
    expect(screen.getByText("Acme Sans").closest(".font-option-card")!.className).toContain(
      "font-option-card--active",
    );
    expect(screen.queryByText("mock-font-family-modal")).toBeNull();
  });

  it("renaming a family while editing it drops the old name and keeps the new one active, since the old one was active", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce({
      theme: {
        font_family_name: "Acme Sans",
        custom_font_families: [
          { name: "Acme Sans", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/a.woff2" }] },
        ],
      },
    });
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => expect(screen.getByLabelText("Organisation name")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Edit Acme Sans" }));
    fireEvent.click(screen.getByText("mock-save-family-renamed"));

    expect(screen.queryByText("Acme Sans")).toBeNull();
    expect(screen.getByText("Acme Sans Renamed").closest(".font-option-card")!.className).toContain(
      "font-option-card--active",
    );
  });

  it("editing a saved-but-inactive family does not make it active after saving", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce({
      theme: {
        font_family_name: "Manrope",
        custom_font_families: [
          { name: "Acme Sans", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/a.woff2" }] },
        ],
      },
    });
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => expect(screen.getByLabelText("Organisation name")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Edit Acme Sans" }));
    fireEvent.click(screen.getByText("mock-save-family"));

    expect(screen.getByText("Acme Sans").closest(".font-option-card")!.className).not.toContain(
      "font-option-card--active",
    );
    expect(screen.getByRole("button", { name: /Manrope/ }).closest(".font-option-card")!.className).toContain(
      "font-option-card--active",
    );
  });

  it("deleting the active custom family falls back to the default built-in font", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce({
      theme: {
        font_family_name: "Acme Sans",
        custom_font_families: [
          { name: "Acme Sans", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/a.woff2" }] },
        ],
      },
    });
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => expect(screen.getByLabelText("Organisation name")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Remove Acme Sans" }));

    expect(screen.queryByText("Acme Sans")).toBeNull();
    expect(screen.getByRole("button", { name: /Admitto Sans/ }).closest(".font-option-card")!.className).toContain("font-option-card--active");
    expect(screen.getByText(/Unsaved changes/)).toBeTruthy();
  });

  it("deleting a saved-but-inactive custom family leaves the active pick untouched", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce({
      theme: {
        font_family_name: "Manrope",
        custom_font_families: [
          { name: "Acme Sans", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/a.woff2" }] },
        ],
      },
    });
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => expect(screen.getByLabelText("Organisation name")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Remove Acme Sans" }));

    expect(screen.queryByText("Acme Sans")).toBeNull();
    expect(screen.getByRole("button", { name: /Manrope/ }).closest(".font-option-card")!.className).toContain("font-option-card--active");
  });

  it("shows a faked-style hint in the live preview when the custom family has no bold/italic variant", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce({
      theme: {
        font_family_name: "Acme Sans",
        custom_font_families: [
          { name: "Acme Sans", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/a.woff2" }] },
        ],
      },
    });
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => expect(screen.getByLabelText("Organisation name")).toBeTruthy());

    expect(screen.getByTitle("No bold file uploaded. The browser is faking it.")).toBeTruthy();
    expect(screen.getByTitle("No italic file uploaded. The browser is faking it.")).toBeTruthy();
  });

  it("shows no faked-style hint for a web-safe font (a real OS family always has all 4 styles)", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => expect(screen.getByLabelText("Organisation name")).toBeTruthy());

    expect(screen.queryByTitle(/browser is faking it/)).toBeNull();
  });
});

describe("BrandingSettingsPanel — save and reset", () => {
  it("saves both organisation branding and theme together", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    mockPatchOrg.mockResolvedValueOnce({ org_name: "New Name Inc", logo_url: "" });
    mockSaveTheme.mockResolvedValueOnce({ theme: { primary: "#7c3aed" } });
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => expect(screen.getByLabelText("Organisation name")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Organisation name"), { target: { value: "New Name Inc" } });
    fireEvent.click(screen.getByRole("button", { name: "Violet" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPatchOrg).toHaveBeenCalledWith({ org_name: "New Name Inc", logo_url: null });
    });
    expect(mockSaveTheme).toHaveBeenCalledWith(expect.objectContaining({ primary: "#7c3aed" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Branding saved/);
    });
  });

  it("restores last saved values via Reset to saved, including the colour palette selection", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => expect(screen.getByLabelText("Organisation name")).toHaveProperty("value", "Acme Corp"));

    fireEvent.change(screen.getByLabelText("Organisation name"), { target: { value: "Unsaved Draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Violet" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset to saved" }));

    expect(screen.getByLabelText("Organisation name")).toHaveProperty("value", "Acme Corp");
    expect(screen.getByRole("button", { name: "Admitto blue" }).getAttribute("aria-pressed")).toBe("true");
    expect(mockPatchOrg).not.toHaveBeenCalled();
    expect(mockSaveTheme).not.toHaveBeenCalled();
  });
});
