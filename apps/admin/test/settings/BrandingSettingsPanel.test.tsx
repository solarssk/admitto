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

/** The shared font library tile-grid (Admin panel's font, and the only upload/edit/remove entry
 * point) - scoped so its tiles' own text ("Acme Sans", button names, etc.) doesn't collide with
 * unrelated page text. */
function adminFontPicker(): HTMLElement {
  return document.querySelector('[aria-labelledby="branding-font-label"]') as HTMLElement;
}

/** The "Font by surface" row selects are plain <select>s, not tile-grids. Admin panel's select is
 * a second control over the same font_family_name field the tile-grid above already drives (so
 * the two always agree); Ticket page's current value is unset ("", "Same as Admin panel") whenever
 * ticket_font_family_name hasn't been explicitly overridden, even while the resolved font it falls
 * back to changes live with the Admin panel's own pick. */
function adminFontSelect(): HTMLSelectElement {
  return screen.getByLabelText("Admin panel font") as HTMLSelectElement;
}
function ticketFontSelect(): HTMLSelectElement {
  return screen.getByLabelText("Ticket page font") as HTMLSelectElement;
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
  // resetAllMocks, not clearAllMocks - the latter doesn't clear queued mockResolvedValueOnce/
  // mockRejectedValueOnce chains, so a test whose own queued value goes unconsumed silently leaks
  // it into the next test that calls the same mock (see reference_vitest4_node24_gotchas).
  vi.resetAllMocks();
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
    await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByRole("alert").textContent).toMatch(/Failed to load branding settings/);
    expect(screen.queryByText("secret_internal")).toBeNull();
    expect(screen.queryByTestId("at-toast")).toBeNull();
  });

  it("recovers on Retry", async () => {
    mockFetchOrg.mockRejectedValueOnce(new Error("network"));
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    renderWithToast(<BrandingSettingsPanel />);
    await screen.findByRole("button", { name: "Retry" });

    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByLabelText("Organisation name")).toHaveProperty("value", "Acme Corp");
  });

  it("ignores a load that resolves after the component has already unmounted", async () => {
    let resolveOrg!: (v: typeof defaultOrg) => void;
    mockFetchOrg.mockImplementationOnce(() => new Promise((resolve) => (resolveOrg = resolve)));
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = renderWithToast(<BrandingSettingsPanel />);

    unmount();
    // Resolving after unmount races the abort guard - a broken one would surface as React's
    // "state update on an unmounted component" console.error.
    resolveOrg(defaultOrg);
    await new Promise((r) => setTimeout(r, 0));

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("ignores a load that rejects after the component has already unmounted", async () => {
    let rejectOrg!: (err: Error) => void;
    mockFetchOrg.mockImplementationOnce(() => new Promise((_, reject) => (rejectOrg = reject)));
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = renderWithToast(<BrandingSettingsPanel />);

    unmount();
    rejectOrg(new Error("network"));
    await new Promise((r) => setTimeout(r, 0));

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
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

  it("treats a missing organisation name from the server as empty instead of crashing", async () => {
    mockFetchOrg.mockResolvedValueOnce({ org_name: undefined, logo_url: "" } as unknown as typeof defaultOrg);
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    renderWithToast(<BrandingSettingsPanel />);
    expect(await screen.findByLabelText("Organisation name")).toHaveProperty("value", "");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText("Organisation name is required.")).toBeTruthy();
    });
  });

  it("blocks save with an empty organisation name, without calling either API", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    renderWithToast(<BrandingSettingsPanel />);
    await screen.findByLabelText("Organisation name");
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
    await screen.findByLabelText("Organisation name");
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
    await screen.findByLabelText("Organisation name");

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
    await screen.findByLabelText("Organisation name");
    expect(screen.getByRole("button", { name: "Admitto blue" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("selects a different palette colour on click", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    renderWithToast(<BrandingSettingsPanel />);
    await screen.findByLabelText("Organisation name");

    fireEvent.click(screen.getByRole("button", { name: "Violet" }));
    expect(screen.getByRole("button", { name: "Violet" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Admitto blue" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText(/Unsaved changes/)).toBeTruthy();
  });

  it("shows the custom swatch active and its hex when the saved primary isn't in the palette", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce({ theme: { primary: "#123456" } });
    renderWithToast(<BrandingSettingsPanel />);
    await screen.findByLabelText("Organisation name");
    expect(document.querySelector("code")?.textContent).toBe("#123456");
  });

  it("switches to custom mode via the native colour picker", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    renderWithToast(<BrandingSettingsPanel />);
    await screen.findByLabelText("Organisation name");

    fireEvent.change(screen.getByLabelText("Custom colour picker"), { target: { value: "#abcdef" } });
    expect(document.querySelector("code")?.textContent).toBe("#abcdef");
  });

  it("Restore defaults reverts colour and font (both surfaces) to Admitto's own defaults without touching organisation name/logo", async () => {
    mockFetchOrg.mockResolvedValueOnce({ org_name: "Acme Corp", logo_url: "https://cdn.example.com/logo.png" });
    mockFetchTheme.mockResolvedValueOnce({
      theme: {
        primary: "#123456",
        font_family_name: "Old Font",
        ticket_font_family_name: "Manrope",
        custom_font_families: [
          { name: "Old Font", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/old.woff2" }] },
        ],
      },
    });
    renderWithToast(<BrandingSettingsPanel />);
    await screen.findByLabelText("Organisation name");
    expect(document.querySelector("code")?.textContent).toBe("#123456");

    fireEvent.click(screen.getByRole("button", { name: "Restore defaults" }));

    expect(screen.getByRole("button", { name: "Admitto blue" }).getAttribute("aria-pressed")).toBe("true");
    expect(adminFontSelect().value).toBe("");
    expect(ticketFontSelect().value).toBe("");
    expect(document.querySelector("code")).toBeNull();
    expect(screen.getByLabelText("Organisation name")).toHaveProperty("value", "Acme Corp");
    expect(screen.getByAltText(/organisation logo preview/i)).toBeTruthy();
  });
});

describe("BrandingSettingsPanel — font picker", () => {
  it("shows Admitto Sans as the default in both the tile-grid's library and the Font-by-surface selects", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    renderWithToast(<BrandingSettingsPanel />);
    await screen.findByLabelText("Organisation name");
    expect(within(adminFontPicker()).getByText("Admitto Sans")).toBeTruthy();
    expect(adminFontSelect().value).toBe("");
    expect(ticketFontSelect().value).toBe("");
  });

  it("clicking a built-in tile in the library does nothing - it's a preview, not a picker", async () => {
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
    await screen.findByLabelText("Organisation name");

    // The tile is a plain, non-interactive <div> now - querying by its label text (not role
    // "button") confirms there's nothing clickable to fire on in the first place.
    const ibmPlexTile = within(adminFontPicker()).getByText("IBM Plex Sans").closest(".font-option-card__select")!;
    fireEvent.click(ibmPlexTile);

    expect(screen.queryByText(/Unsaved changes/)).toBeNull();
    expect(adminFontSelect().value).toBe("Old Font");
    expect(ticketFontSelect().value).toBe("");
  });

  it("picking a font from the Admin panel's own Font-by-surface select is the only way to change it", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    renderWithToast(<BrandingSettingsPanel />);
    await screen.findByLabelText("Organisation name");

    fireEvent.change(adminFontSelect(), { target: { value: "Manrope" } });

    expect(adminFontSelect().value).toBe("Manrope");
    expect(screen.getByText(/Unsaved changes/)).toBeTruthy();
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
    await screen.findByLabelText("Organisation name");

    const customTile = within(adminFontPicker()).getByText("Acme Sans").closest(".font-option-card");
    expect(customTile).not.toBeNull();
    expect(within(customTile as HTMLElement).getByText("2 styles")).toBeTruthy();
  });

  it("opens the styles popover on click, listing each style label", async () => {
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
    await screen.findByLabelText("Organisation name");

    const customTile = within(adminFontPicker()).getByText("Acme Sans").closest(".font-option-card") as HTMLElement;
    fireEvent.click(within(customTile).getByRole("button", { name: /2 styles/ }));
    expect(within(customTile).getByText("400")).toBeTruthy();
    expect(within(customTile).getByText("700")).toBeTruthy();
  });

  it("closes the styles popover when clicking outside it", async () => {
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
    await screen.findByLabelText("Organisation name");

    fireEvent.click(within(adminFontPicker()).getByRole("button", { name: /1 style/ }));
    expect(within(adminFontPicker()).getByText("400")).toBeTruthy();

    fireEvent.mouseDown(document.body);
    expect(within(adminFontPicker()).queryByText("400")).toBeNull();
  });

  it("does not close the styles popover when clicking one of its own listed styles", async () => {
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
    await screen.findByLabelText("Organisation name");

    fireEvent.click(within(adminFontPicker()).getByRole("button", { name: /1 style/ }));
    const item = within(adminFontPicker()).getByText("400");

    fireEvent.mouseDown(item);
    expect(within(adminFontPicker()).getByText("400")).toBeTruthy();
  });

  it("reflects each surface's own saved font in its own Font-by-surface select", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce({
      theme: {
        font_family_name: "Acme Sans",
        ticket_font_family_name: "Manrope",
        custom_font_families: [
          { name: "Acme Sans", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/a.woff2" }] },
        ],
      },
    });
    renderWithToast(<BrandingSettingsPanel />);
    await screen.findByLabelText("Organisation name");

    expect(adminFontSelect().value).toBe("Acme Sans");
    expect(ticketFontSelect().value).toBe("Manrope");
  });

  it("assumes a real bold/italic file when the active pick matches neither a built-in nor a saved custom family", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce({
      theme: { font_family_name: "Deleted Family", custom_font_families: [] },
    });
    renderWithToast(<BrandingSettingsPanel />);
    await screen.findByLabelText("Organisation name");

    expect(screen.queryByTitle(/browser is faking it/)).toBeNull();
  });

  it("opens the font family modal when the Custom font tile is clicked", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    renderWithToast(<BrandingSettingsPanel />);
    await screen.findByLabelText("Organisation name");

    expect(screen.queryByText("mock-font-family-modal")).toBeNull();
    fireEvent.click(within(adminFontPicker()).getByRole("button", { name: /^Custom font/ }));
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
    await screen.findByLabelText("Organisation name");

    expect(within(adminFontPicker()).queryByRole("button", { name: /^Custom font/ })).toBeNull();
    expect(within(adminFontPicker()).getByText("Limit reached")).toBeTruthy();
  });

  it("wires the modal's saved family into the theme draft, active on Admin panel (Ticket page still following it), and eventual Save", async () => {
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
    await screen.findByLabelText("Organisation name");

    fireEvent.click(within(adminFontPicker()).getByRole("button", { name: /^Custom font/ }));
    fireEvent.click(screen.getByText("mock-save-family"));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Saved.*Acme Sans/);
    });
    expect(adminFontSelect().value).toBe("Acme Sans");
    // A brand-new family only ever activates for Admin panel (the sole upload entry point) -
    // Ticket page's own field stays unset, still following whatever Admin panel is.
    expect(ticketFontSelect().value).toBe("");
    // But it's now available to explicitly pick for Ticket page too, from the shared library.
    expect(within(ticketFontSelect()).getByRole("option", { name: "Acme Sans" })).toBeTruthy();
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

  it("picking a saved custom family from the Ticket page dropdown overrides it independently of Admin panel", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce({
      theme: {
        custom_font_families: [
          { name: "Acme Sans", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/a.woff2" }] },
        ],
      },
    });
    renderWithToast(<BrandingSettingsPanel />);
    await screen.findByLabelText("Organisation name");

    fireEvent.change(ticketFontSelect(), { target: { value: "Acme Sans" } });

    expect(ticketFontSelect().value).toBe("Acme Sans");
    // Admin panel's own pick is untouched - still the default.
    expect(adminFontSelect().value).toBe("");
  });

  it("clicking a saved custom family's preview tile does nothing - switching between two saved families only happens via the Font-by-surface select, without losing either", async () => {
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
    await screen.findByLabelText("Organisation name");

    expect(adminFontSelect().value).toBe("First Family");
    const secondTile = within(adminFontPicker()).getByText("Second Family").closest(".font-option-card__select")!;

    fireEvent.click(secondTile);
    expect(adminFontSelect().value).toBe("First Family");

    fireEvent.change(adminFontSelect(), { target: { value: "Second Family" } });

    expect(adminFontSelect().value).toBe("Second Family");
    // Neither saved family was deleted by switching between them.
    expect(within(adminFontPicker()).getByText("First Family")).toBeTruthy();
    expect(within(adminFontPicker()).getByText("Second Family")).toBeTruthy();
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
    await screen.findByLabelText("Organisation name");

    expect(screen.queryByText("mock-font-family-modal")).toBeNull();
    fireEvent.click(within(adminFontPicker()).getByRole("button", { name: "Edit Acme Sans" }));

    expect(screen.getByText("mock-font-family-modal")).toBeTruthy();
    expect(screen.getByText("editing: Acme Sans")).toBeTruthy();
  });

  it("saving an edited family under the same name replaces it in place instead of duplicating it, keeping Admin panel's active status", async () => {
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
    await screen.findByLabelText("Organisation name");

    fireEvent.click(within(adminFontPicker()).getByRole("button", { name: "Edit Acme Sans" }));
    fireEvent.click(screen.getByText("mock-save-family"));

    expect(within(adminFontPicker()).getAllByText("Acme Sans")).toHaveLength(1);
    expect(adminFontSelect().value).toBe("Acme Sans");
    // Ticket page's field was never set - stays unset (still following Admin panel).
    expect(ticketFontSelect().value).toBe("");
    expect(screen.queryByText("mock-font-family-modal")).toBeNull();
  });

  it("renaming a family while editing it drops the old name and keeps the new one active for Admin panel", async () => {
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
    await screen.findByLabelText("Organisation name");

    fireEvent.click(within(adminFontPicker()).getByRole("button", { name: "Edit Acme Sans" }));
    fireEvent.click(screen.getByText("mock-save-family-renamed"));

    expect(screen.queryByText("Acme Sans")).toBeNull();
    expect(within(adminFontPicker()).getByText("Acme Sans Renamed")).toBeTruthy();
    expect(adminFontSelect().value).toBe("Acme Sans Renamed");
    expect(ticketFontSelect().value).toBe("");
  });

  it("renaming a family that was active only for Ticket page updates its override, keeping Admin panel's own pick untouched", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce({
      theme: {
        font_family_name: "Manrope",
        ticket_font_family_name: "Acme Sans",
        custom_font_families: [
          { name: "Acme Sans", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/a.woff2" }] },
        ],
      },
    });
    renderWithToast(<BrandingSettingsPanel />);
    await screen.findByLabelText("Organisation name");

    // "Acme Sans" is still a saved family, so it's still listed (with its own Edit button) in the
    // shared library grid even though Admin panel's own active pick is "Manrope".
    fireEvent.click(within(adminFontPicker()).getByRole("button", { name: "Edit Acme Sans" }));
    fireEvent.click(screen.getByText("mock-save-family-renamed"));

    expect(ticketFontSelect().value).toBe("Acme Sans Renamed");
    // Admin panel was never active for this family - a rename must not touch it.
    expect(adminFontSelect().value).toBe("Manrope");
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
    await screen.findByLabelText("Organisation name");

    fireEvent.click(within(adminFontPicker()).getByRole("button", { name: "Edit Acme Sans" }));
    fireEvent.click(screen.getByText("mock-save-family"));

    expect(adminFontSelect().value).toBe("Manrope");
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
    await screen.findByLabelText("Organisation name");

    fireEvent.click(within(adminFontPicker()).getByRole("button", { name: "Remove Acme Sans" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove", exact: true }));

    expect(screen.queryByText("Acme Sans")).toBeNull();
    expect(adminFontSelect().value).toBe("");
    expect(ticketFontSelect().value).toBe("");
    expect(screen.getByText(/Unsaved changes/)).toBeTruthy();
  });

  it("deleting a family active only for Ticket page clears its override, leaving Admin panel's own pick untouched", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce({
      theme: {
        font_family_name: "Manrope",
        ticket_font_family_name: "Acme Sans",
        custom_font_families: [
          { name: "Acme Sans", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/a.woff2" }] },
        ],
      },
    });
    renderWithToast(<BrandingSettingsPanel />);
    await screen.findByLabelText("Organisation name");

    // "Acme Sans" is still listed (with its own Remove button) in the shared library grid, even
    // though it's Ticket page's override, not Admin panel's active pick.
    fireEvent.click(within(adminFontPicker()).getByRole("button", { name: "Remove Acme Sans" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove", exact: true }));

    // ticket_font_family_name clears back to undefined ("Same as Admin panel"), not some
    // hardcoded default.
    expect(ticketFontSelect().value).toBe("");
    expect(adminFontSelect().value).toBe("Manrope");
  });

  it("removing a saved-but-inactive family leaves the active pick untouched", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce({
      theme: {
        font_family_name: "Active Family",
        custom_font_families: [
          { name: "Active Family", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/a.woff2" }] },
          { name: "Other Family", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/b.woff2" }] },
        ],
      },
    });
    renderWithToast(<BrandingSettingsPanel />);
    await screen.findByLabelText("Organisation name");

    fireEvent.click(within(adminFontPicker()).getByRole("button", { name: "Remove Other Family" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove", exact: true }));

    expect(screen.queryByText("Other Family")).toBeNull();
    expect(adminFontSelect().value).toBe("Active Family");
  });

  it("saves the plural 'variants' toast wording for a family with more than one variant", async () => {
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
    await screen.findByLabelText("Organisation name");

    fireEvent.click(within(adminFontPicker()).getByRole("button", { name: "Edit Acme Sans" }));
    fireEvent.click(screen.getByText("mock-save-family"));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/2 variants\./);
    });
  });

  it("clicking Remove asks for confirmation first - Cancel keeps the family", async () => {
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
    await screen.findByLabelText("Organisation name");

    fireEvent.click(within(adminFontPicker()).getByRole("button", { name: "Remove Acme Sans" }));
    expect(screen.getByText('Remove "Acme Sans"?')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText('Remove "Acme Sans"?')).toBeNull();
    expect(within(adminFontPicker()).getByText("Acme Sans")).toBeTruthy();
  });

  it("deleting a saved-but-inactive custom family leaves an active built-in pick untouched", async () => {
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
    await screen.findByLabelText("Organisation name");

    fireEvent.click(within(adminFontPicker()).getByRole("button", { name: "Remove Acme Sans" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove", exact: true }));

    expect(screen.queryByText("Acme Sans")).toBeNull();
    expect(adminFontSelect().value).toBe("Manrope");
  });

  it("saving a family under a name that already exists in the library updates that entry in place", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce({
      theme: {
        font_family_name: "Acme Sans",
        custom_font_families: [
          { name: "Acme Sans", variants: [{ weight: 400, style: "normal", url: "/uploads/default/theme/old.woff2" }] },
        ],
      },
    });
    renderWithToast(<BrandingSettingsPanel />);
    await screen.findByLabelText("Organisation name");

    fireEvent.click(within(adminFontPicker()).getByRole("button", { name: /^Custom font/ }));
    fireEvent.click(screen.getByText("mock-save-family"));

    // Exactly one "Acme Sans" entry remains - the upload replaced the existing library entry in
    // place rather than creating a second one, and it's still the active pick.
    await waitFor(() => {
      expect(within(adminFontPicker()).getAllByText("Acme Sans")).toHaveLength(1);
    });
    expect(adminFontSelect().value).toBe("Acme Sans");
  });

  it("shows a faked-style hint in the live preview when the active custom family has no bold/italic variant", async () => {
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
    await screen.findByLabelText("Organisation name");

    expect(screen.getAllByTitle("No bold file uploaded. The browser is faking it.")).toHaveLength(1);
    expect(screen.getAllByTitle("No italic file uploaded. The browser is faking it.")).toHaveLength(1);
  });

  it("shows no faked-style hint for a web-safe font (a real OS family always has all 4 styles)", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    renderWithToast(<BrandingSettingsPanel />);
    await screen.findByLabelText("Organisation name");

    expect(screen.queryByTitle(/browser is faking it/)).toBeNull();
  });

  it("shows a disabled Registration form dropdown placeholder, not a functional picker", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    renderWithToast(<BrandingSettingsPanel />);
    await screen.findByLabelText("Organisation name");

    const registrationSelect = screen.getByLabelText("Registration form font") as HTMLSelectElement;
    expect(registrationSelect.disabled).toBe(true);
    expect(within(registrationSelect).getByText("Not available yet")).toBeTruthy();
  });
});

describe("BrandingSettingsPanel — save and reset", () => {
  it("saves both organisation branding and theme together", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    mockPatchOrg.mockResolvedValueOnce({ org_name: "New Name Inc", logo_url: "" });
    mockSaveTheme.mockResolvedValueOnce({ theme: { primary: "#7c3aed" } });
    renderWithToast(<BrandingSettingsPanel />);
    await screen.findByLabelText("Organisation name");

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

  it("blocks save when the loaded theme already has an invalid saved custom font family, without calling either API", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce({
      theme: {
        font_family_name: "Bad Family",
        custom_font_families: [{ name: "Bad Family", variants: [] }],
      },
    });
    renderWithToast(<BrandingSettingsPanel />);
    await screen.findByLabelText("Organisation name");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText(/saved custom fonts are invalid/i)).toBeTruthy();
    });
    expect(mockPatchOrg).not.toHaveBeenCalled();
    expect(mockSaveTheme).not.toHaveBeenCalled();
  });

  it("reports a partial failure when the organisation save rejects but the theme save succeeds", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    mockPatchOrg.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    mockSaveTheme.mockResolvedValueOnce({ theme: { primary: "#7c3aed" } });
    renderWithToast(<BrandingSettingsPanel />);
    await screen.findByLabelText("Organisation name");

    fireEvent.click(screen.getByRole("button", { name: "Violet" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Part of your branding failed to save/);
    });
    expect(screen.queryByText("secret_internal")).toBeNull();
  });

  it("reports a partial failure when the theme save rejects but the organisation save succeeds", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    mockPatchOrg.mockResolvedValueOnce({ org_name: "Acme Corp", logo_url: "" });
    mockSaveTheme.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<BrandingSettingsPanel />);
    await screen.findByLabelText("Organisation name");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Part of your branding failed to save/);
    });
    expect(screen.queryByText("secret_internal")).toBeNull();
  });

  it("blocks save when the loaded theme already has an invalid primary colour, without calling either API", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce({ theme: { primary: "not-a-hex" } });
    renderWithToast(<BrandingSettingsPanel />);
    await screen.findByLabelText("Organisation name");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText(/valid 6-digit hex colour/i)).toBeTruthy();
    });
    expect(mockPatchOrg).not.toHaveBeenCalled();
    expect(mockSaveTheme).not.toHaveBeenCalled();
  });

  it("blocks save when the loaded theme's active font_family_name itself has invalid characters", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce({ theme: { font_family_name: "bad</name>" } });
    renderWithToast(<BrandingSettingsPanel />);
    await screen.findByLabelText("Organisation name");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText(/letters, numbers, spaces, hyphens/i)).toBeTruthy();
    });
    expect(mockPatchOrg).not.toHaveBeenCalled();
    expect(mockSaveTheme).not.toHaveBeenCalled();
  });

  it("reports a generic failure toast when both the organisation and theme saves reject", async () => {
    mockFetchOrg.mockResolvedValueOnce(defaultOrg);
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    mockPatchOrg.mockRejectedValueOnce(new ApiError(500, "secret_internal_1"));
    mockSaveTheme.mockRejectedValueOnce(new ApiError(500, "secret_internal_2"));
    renderWithToast(<BrandingSettingsPanel />);
    await screen.findByLabelText("Organisation name");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Failed to save branding\./);
    });
  });

  it("treats a missing logo URL from the server as empty instead of crashing", async () => {
    mockFetchOrg.mockResolvedValueOnce({ org_name: "Acme Corp", logo_url: undefined } as unknown as typeof defaultOrg);
    mockFetchTheme.mockResolvedValueOnce(defaultTheme);
    mockPatchOrg.mockResolvedValueOnce(defaultOrg);
    mockSaveTheme.mockResolvedValueOnce(defaultTheme);
    renderWithToast(<BrandingSettingsPanel />);
    await screen.findByLabelText("Organisation name");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(mockPatchOrg).toHaveBeenCalledWith({ org_name: "Acme Corp", logo_url: null });
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
