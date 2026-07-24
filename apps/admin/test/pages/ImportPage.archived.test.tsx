// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { ImportPage } from "../../src/pages/ImportPage.js";
import { ARCHIVED_ACTION_TOOLTIP } from "../../src/components/ArchivedGuard.js";
import { getTooltipText, renderWithToast } from "../test-utils.js";

const fetchEventCustomFields = vi.fn();

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ reportApiError: vi.fn() }),
}));

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: [{ role: "admin", scope_type: "organization", scope_id: "org-1" }] }),
}));

vi.mock("../../src/api/client.js", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    constructor(status: number, message: string, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  fetchEventCustomFields: (...args: unknown[]) => fetchEventCustomFields(...args),
  previewImport: vi.fn(),
  fetchImportHistory: vi.fn().mockResolvedValue([]),
  commitImport: vi.fn(),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useOutletContext: () => ({
      event: { id: "evt-1", title: "Demo", archived_at: "2026-01-01T00:00:00.000Z" },
    }),
  };
});

function renderPage() {
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/attendees/import"]}>
      <Routes>
        <Route path="/admin/events/:eventId/attendees/import" element={<ImportPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ImportPage archived lockdown", () => {
  it("disables the upload and options fieldsets and Validate file, blocking the import flow at its entry point", async () => {
    fetchEventCustomFields.mockResolvedValue([]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Validate file" })).toBeTruthy();
    });

    const validateButton = screen.getByRole("button", { name: "Validate file" }) as HTMLButtonElement;
    expect(validateButton.disabled).toBe(true);
    const describedBy = validateButton.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe(ARCHIVED_ACTION_TOOLTIP);
    expect(getTooltipText(validateButton)).toBe(ARCHIVED_ACTION_TOOLTIP);

    const fileInput = screen.getByLabelText("File (.csv or .xlsx)");
    const uploadFieldset = fileInput.closest("fieldset");
    expect(uploadFieldset?.disabled).toBe(true);
    expect(getTooltipText(uploadFieldset as HTMLElement)).toBe(ARCHIVED_ACTION_TOOLTIP);

    // The dropzone is keyboard-unfocusable and inert inside the disabled fieldset.
    const dropzone = screen.getByRole("button", { name: "Upload a CSV or XLSX file" });
    expect(dropzone.getAttribute("tabindex")).toBe("-1");

    // The overwrite checkbox and dry-run switch live in the Options card's own disabled
    // fieldset (two-column mockup layout splits them from the upload card).
    const overwriteCheckbox = screen.getByLabelText(/Overwrite existing attendees/);
    const optionsFieldset = overwriteCheckbox.closest("fieldset");
    expect(optionsFieldset).not.toBe(uploadFieldset);
    expect(optionsFieldset?.disabled).toBe(true);
    expect(getTooltipText(optionsFieldset as HTMLElement)).toBe(ARCHIVED_ACTION_TOOLTIP);
    expect(screen.getByLabelText(/Dry run/).closest("fieldset")).toBe(optionsFieldset);

    // Read-only navigation stays usable.
    expect(screen.getByRole("link", { name: "Back to attendees" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Download CSV template" })).toBeTruthy();
  });
});
