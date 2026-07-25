// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider } from "react-router/dom";
import { createMemoryRouter, MemoryRouter, Route, Routes } from "react-router";
import { ImportPage } from "../../src/pages/ImportPage.js";
import { renderWithToast } from "../test-utils.js";

const fetchEventCustomFields = vi.fn();
const previewImport = vi.fn();
const commitImport = vi.fn();
const fetchImportHistory = vi.fn();

let mockAssignments: Array<{ role: string; scope_type: string; scope_id: string | null }> = [
  { role: "admin", scope_type: "organization", scope_id: "org-1" },
];

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ reportApiError: vi.fn() }),
}));

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: mockAssignments }),
}));

vi.mock("../../src/api/client.js", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    eventFull?: unknown;
    constructor(status: number, message: string, code?: string, eventFull?: unknown) {
      super(message);
      this.status = status;
      this.code = code;
      this.eventFull = eventFull;
    }
  },
  fetchEventCustomFields: (...args: unknown[]) => fetchEventCustomFields(...args),
  previewImport: (...args: unknown[]) => previewImport(...args),
  fetchImportHistory: (...args: unknown[]) => fetchImportHistory(...args),
  commitImport: (...args: unknown[]) => commitImport(...args),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useOutletContext: () => ({
      event: { id: "evt-1", title: "Demo", archived_at: null },
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

function samplePreview(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    importId: "imp-1",
    parse: { validCount: 1, invalidRows: [], invalidCount: 0, warnings: [] },
    summary: { toCreate: 1, toUpdate: 0, toSkip: 0, skipped: [] },
    sampleRows: [
      {
        rowIndex: 1,
        name: "Jane",
        email: "jane@example.com",
        ticket_type: "vip",
        company: "",
        department: "",
        external_uuid: "",
        custom_data: {},
      },
    ],
    attributeFieldLabels: [],
    ...overrides,
  };
}

function selectFile() {
  const fileInput = screen.getByLabelText("File (.csv or .xlsx)") as HTMLInputElement;
  const file = new File(["a,b\n1,2"], "attendees.csv", { type: "text/csv" });
  fireEvent.change(fileInput, { target: { files: [file] } });
}

beforeEach(() => {
  fetchImportHistory.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  mockAssignments = [{ role: "admin", scope_type: "organization", scope_id: "org-1" }];
});

describe("ImportPage upload → preview → commit flow", () => {
  it("selects a file, toggles overwrite, previews, and commits", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    previewImport.mockResolvedValueOnce(samplePreview());
    commitImport.mockResolvedValueOnce({
      importId: "imp-1",
      toCreate: 1,
      toUpdate: 0,
      toSkip: 0,
      created: 1,
      updated: 0,
      skipped: [],
      invalidRows: [],
      invalidCount: 0,
    });
    renderPage();
    expect(await screen.findByRole("button", { name: "Validate file" })).toBeTruthy();

    selectFile();
    fireEvent.click(screen.getByLabelText(/Overwrite existing attendees/));

    fireEvent.click(screen.getByRole("button", { name: "Validate file" }));
    await waitFor(() => {
      expect(previewImport).toHaveBeenCalledWith("evt-1", expect.any(File), true);
    });

    expect(await screen.findByText("To create")).toBeTruthy();

    // Commit stays disabled while Dry run is on - turn it off first (mockup Options card).
    const commitBtn = screen.getByRole("button", { name: /^Commit import \(1 attendee\)$/ }) as HTMLButtonElement;
    expect(commitBtn.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Dry run/));
    fireEvent.click(screen.getByRole("button", { name: /^Commit import \(1 attendee\)$/ }));
    await waitFor(() => {
      expect(commitImport).toHaveBeenCalledWith("evt-1", expect.any(File), true, { force: false });
    });
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Attendees imported: 1 created/);
    });
  });

  it("keeps Dry run locked on until a validation summary is showing, so it can't be turned off on reflex before ever validating (Codex review)", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    previewImport.mockResolvedValueOnce(samplePreview());
    renderPage();
    expect(await screen.findByRole("button", { name: "Validate file" })).toBeTruthy();

    selectFile();
    const dryRunSwitch = screen.getByLabelText(/Dry run/) as HTMLInputElement;
    expect(dryRunSwitch.disabled).toBe(true);
    expect(dryRunSwitch.checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Validate file" }));
    expect(await screen.findByText("To create")).toBeTruthy();

    // Only now, with the summary on screen, can it be toggled.
    expect(dryRunSwitch.disabled).toBe(false);
    const commitBtn = screen.getByRole("button", { name: /^Commit import \(1 attendee\)$/ }) as HTMLButtonElement;
    expect(commitBtn.disabled).toBe(true);
    fireEvent.click(dryRunSwitch);
    expect(commitBtn.disabled).toBe(false);
  });

  it("re-arms Dry run when a different file is picked, so a summary already unlocked for the first file can't unlock committing the new one on arrival", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    previewImport.mockResolvedValueOnce(samplePreview());
    renderPage();
    expect(await screen.findByRole("button", { name: "Validate file" })).toBeTruthy();

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: "Validate file" }));
    expect(await screen.findByText("To create")).toBeTruthy();
    const dryRunSwitch = screen.getByLabelText(/Dry run/) as HTMLInputElement;
    fireEvent.click(dryRunSwitch);
    expect(dryRunSwitch.checked).toBe(false);

    // Picking a different file drops back to the upload step and back to Dry run.
    selectFile();
    expect(dryRunSwitch.checked).toBe(true);
    expect(dryRunSwitch.disabled).toBe(true);
  });

  it("re-validates the same file on Re-validate, keeping the summary card open", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    previewImport.mockResolvedValue(samplePreview());
    renderPage();
    expect(await screen.findByRole("button", { name: "Validate file" })).toBeTruthy();

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: "Validate file" }));
    expect(await screen.findByText("To create")).toBeTruthy();
    expect(previewImport).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Re-validate" }));
    await waitFor(() => expect(previewImport).toHaveBeenCalledTimes(2));
    expect(screen.getByText("To create")).toBeTruthy();
  });

  it("re-arms Dry run on Re-validate, so turning it off before re-validating can't unlock committing the refreshed summary (CodeRabbit review)", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    previewImport.mockResolvedValue(samplePreview());
    renderPage();
    expect(await screen.findByRole("button", { name: "Validate file" })).toBeTruthy();

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: "Validate file" }));
    expect(await screen.findByText("To create")).toBeTruthy();

    const dryRunSwitch = screen.getByLabelText(/Dry run/) as HTMLInputElement;
    fireEvent.click(dryRunSwitch);
    expect(dryRunSwitch.checked).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Re-validate" }));
    await waitFor(() => expect(previewImport).toHaveBeenCalledTimes(2));
    expect(dryRunSwitch.checked).toBe(true);
  });

  it("lists configured custom attribute fields as extra rows in the Required CSV columns reference, showing the field's own description", async () => {
    fetchEventCustomFields.mockResolvedValue([
      {
        id: "1",
        source_field: "shirt_size",
        label: "Shirt size",
        description: "Attendee's t-shirt size for the swag bag",
        type: "text",
        required: false,
        options: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    renderPage();
    expect(await screen.findByRole("button", { name: "Validate file" })).toBeTruthy();

    expect(await screen.findByText("shirt_size")).toBeTruthy();
    expect(screen.getByText("Attendee's t-shirt size for the swag bag")).toBeTruthy();
    expect(screen.queryByText("Shirt size")).toBeNull();
  });

  it("falls back to a plain 'No description provided' note for a custom field with no description set", async () => {
    fetchEventCustomFields.mockResolvedValue([
      {
        id: "1",
        source_field: "shirt_size",
        label: "Shirt size",
        description: null,
        type: "text",
        required: false,
        options: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    renderPage();
    expect(await screen.findByRole("button", { name: "Validate file" })).toBeTruthy();

    expect(await screen.findByText("shirt_size")).toBeTruthy();
    expect(screen.getByText("No description provided")).toBeTruthy();
  });

  it("shows required, select, and boolean custom-field import hints", async () => {
    fetchEventCustomFields.mockResolvedValue([
      {
        id: "select-1",
        source_field: "meal",
        label: "Meal",
        description: "Meal preference",
        type: "select",
        required: true,
        options: ["Vegetarian", "Standard"],
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "boolean-1",
        source_field: "newsletter",
        label: "Newsletter",
        description: "Newsletter consent",
        type: "boolean",
        required: false,
        options: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    renderPage();
    expect(await screen.findByRole("button", { name: "Validate file" })).toBeTruthy();

    const mealRow = screen.getByText("meal").closest("tr");
    const newsletterRow = screen.getByText("newsletter").closest("tr");
    expect(mealRow?.textContent).toContain("Yes");
    expect(mealRow?.textContent).toContain("Meal preference — select: Vegetarian, Standard");
    expect(newsletterRow?.textContent).toContain("Newsletter consent — Yes/No or true/false");
  });

  it("lists parse warnings on the validation summary", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    previewImport.mockResolvedValueOnce(
      samplePreview({
        parse: { validCount: 1, invalidRows: [], invalidCount: 0, warnings: ['Row 3: "email" looks malformed'] },
      }),
    );
    renderPage();
    expect(await screen.findByRole("button", { name: "Validate file" })).toBeTruthy();

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: "Validate file" }));

    expect(await screen.findByText("Warnings")).toBeTruthy();
    expect(screen.getByText('Row 3: "email" looks malformed')).toBeTruthy();
  });

  it("explains why each row was skipped, so 'To skip' isn't a bare unexplained count (PO feedback)", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    previewImport.mockResolvedValueOnce(
      samplePreview({
        summary: {
          toCreate: 0,
          toUpdate: 0,
          toSkip: 1,
          skipped: [
            {
              email: "existing@example.com",
              reason: 'Attendee already exists — turn on "Overwrite existing attendees" to update it instead of skipping',
            },
          ],
        },
      }),
    );
    renderPage();
    expect(await screen.findByRole("button", { name: "Validate file" })).toBeTruthy();

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: "Validate file" }));

    expect(await screen.findByText("Skipped rows")).toBeTruthy();
    expect(screen.getByText("existing@example.com")).toBeTruthy();
    expect(
      screen.getByText(
        'Attendee already exists — turn on "Overwrite existing attendees" to update it instead of skipping',
      ),
    ).toBeTruthy();
  });

  it("notes the true total when the server capped the skipped/invalid row detail (CodeRabbit review)", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    previewImport.mockResolvedValueOnce(
      samplePreview({
        parse: {
          validCount: 1,
          invalidRows: [{ rowIndex: 1, reason: "Missing email" }],
          invalidCount: 5,
          warnings: [],
        },
        summary: {
          toCreate: 0,
          toUpdate: 0,
          toSkip: 5,
          skipped: [{ email: "existing@example.com", reason: "Attendee already exists" }],
        },
      }),
    );
    renderPage();
    expect(await screen.findByRole("button", { name: "Validate file" })).toBeTruthy();

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: "Validate file" }));

    expect(await screen.findByText("Invalid rows — showing first 1 of 5")).toBeTruthy();
    expect(screen.getByText("Skipped rows — showing first 1 of 5")).toBeTruthy();
  });

  it("shows a plain heading with no count note when every skipped/invalid row detail is returned", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    previewImport.mockResolvedValueOnce(
      samplePreview({
        parse: {
          validCount: 1,
          invalidRows: [{ rowIndex: 1, reason: "Missing email" }],
          invalidCount: 1,
          warnings: [],
        },
        summary: {
          toCreate: 0,
          toUpdate: 0,
          toSkip: 1,
          skipped: [{ email: "existing@example.com", reason: "Attendee already exists" }],
        },
      }),
    );
    renderPage();
    expect(await screen.findByRole("button", { name: "Validate file" })).toBeTruthy();

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: "Validate file" }));

    expect(await screen.findByText("Invalid rows")).toBeTruthy();
    expect(screen.queryByText(/showing first/)).toBeNull();
  });

  it("notes the true total on Row preview too when the sample is fewer than all valid rows", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    previewImport.mockResolvedValueOnce(
      samplePreview({ parse: { validCount: 5, invalidRows: [], invalidCount: 0, warnings: [] } }),
    );
    renderPage();
    expect(await screen.findByRole("button", { name: "Validate file" })).toBeTruthy();

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: "Validate file" }));

    expect(await screen.findByText("Row preview — showing first 1 of 5 valid rows")).toBeTruthy();
  });

  it("shows rows the commit-time re-parse invalidated (e.g. a ticket type deleted between preview and commit)", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    previewImport.mockResolvedValueOnce(samplePreview());
    commitImport.mockResolvedValueOnce({
      importId: "imp-1",
      toCreate: 0,
      toUpdate: 0,
      toSkip: 0,
      created: 0,
      updated: 0,
      skipped: [],
      invalidRows: [{ rowIndex: 1, reason: 'Unknown ticket type: "vip"' }],
      invalidCount: 1,
    });
    renderPage();
    expect(await screen.findByRole("button", { name: "Validate file" })).toBeTruthy();

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: "Validate file" }));
    expect(await screen.findByText("To create")).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/Dry run/));
    fireEvent.click(screen.getByRole("button", { name: /^Commit import \(1 attendee\)$/ }));
    await waitFor(() => expect(commitImport).toHaveBeenCalled());

    expect(await screen.findByText("Invalid rows")).toBeTruthy();
    expect(screen.getByText('Unknown ticket type: "vip"')).toBeTruthy();
  });

  it("lets a superadmin override a capacity block and re-commit with force (plural count)", async () => {
    mockAssignments = [{ role: "superadmin", scope_type: "instance", scope_id: null }];
    fetchEventCustomFields.mockResolvedValue([]);
    previewImport.mockResolvedValueOnce(
      samplePreview({ summary: { toCreate: 2, toUpdate: 0, toSkip: 0, skipped: [] } }),
    );
    const { ApiError } = await import("../../src/api/client.js");
    commitImport
      .mockRejectedValueOnce(
        new ApiError(409, "event full", "event_full", { capacity: 10, current: 10, incoming: 2 }),
      )
      .mockResolvedValueOnce({
        importId: "imp-1",
        toCreate: 2,
        toUpdate: 0,
        toSkip: 0,
        created: 2,
        updated: 0,
        skipped: [],
        invalidRows: [],
        invalidCount: 0,
      });
    renderPage();
    expect(await screen.findByRole("button", { name: "Validate file" })).toBeTruthy();

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: "Validate file" }));
    expect(await screen.findByText("To create")).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/Dry run/));
    fireEvent.click(screen.getByRole("button", { name: /^Commit import \(2 attendees\)$/ }));
    await waitFor(() => {
      expect(screen.getByText(/Event is at capacity/)).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText(/Override capacity limit/));
    fireEvent.click(screen.getByRole("button", { name: /^Commit import \(2 attendees\)$/ }));

    await waitFor(() => {
      expect(commitImport).toHaveBeenLastCalledWith("evt-1", expect.any(File), false, { force: true });
    });
  });

  it("ignores a cancelled file picker and resets to the upload step when a new file is chosen after preview", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    previewImport.mockResolvedValueOnce(samplePreview());
    renderPage();
    expect(await screen.findByRole("button", { name: "Validate file" })).toBeTruthy();

    // Cancelling the native file picker fires a change event with an empty FileList.
    fireEvent.change(screen.getByLabelText("File (.csv or .xlsx)"), { target: { files: [] } });
    expect((screen.getByRole("button", { name: "Validate file" }) as HTMLButtonElement).disabled).toBe(true);

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: "Validate file" }));
    expect(await screen.findByText("To create")).toBeTruthy();

    // Choosing a different file after previewing sends the flow back to "upload".
    selectFile();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Validate file" })).toBeTruthy();
      expect(screen.queryByText("To create")).toBeNull();
    });
  });
});

describe("ImportPage dropzone (#358 Phase A)", () => {
  it("accepts a dropped .csv exactly like the file picker and shows the file chip", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByRole("button", { name: "Validate file" })).toBeTruthy();

    const dropzone = screen.getByRole("button", { name: "Upload a CSV or XLSX file" });
    const file = new File(["a,b\n1,2"], "dropped.csv", { type: "text/csv" });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    expect(screen.getByText("dropped.csv")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove file" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Validate file" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps the proxied file input out of the tab order — the dropzone button is the keyboard path (Codex review)", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByRole("button", { name: "Validate file" })).toBeTruthy();

    const fileInput = screen.getByLabelText("File (.csv or .xlsx)") as HTMLInputElement;
    expect(fileInput.tabIndex).toBe(-1);
  });

  it("opens the file picker with Enter or Space on the focused dropzone, but not other keys", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByRole("button", { name: "Validate file" })).toBeTruthy();

    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    try {
      const dropzone = screen.getByRole("button", { name: "Upload a CSV or XLSX file" });

      fireEvent.keyDown(dropzone, { key: "a" });
      expect(clickSpy).not.toHaveBeenCalled();

      fireEvent.keyDown(dropzone, { key: "Enter" });
      expect(clickSpy).toHaveBeenCalledTimes(1);

      fireEvent.keyDown(dropzone, { key: " " });
      expect(clickSpy).toHaveBeenCalledTimes(2);
    } finally {
      clickSpy.mockRestore();
    }
  });

  it("highlights the dropzone while a file is dragged over it, and clears on drag leave", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByRole("button", { name: "Validate file" })).toBeTruthy();

    const dropzone = screen.getByRole("button", { name: "Upload a CSV or XLSX file" });
    expect(dropzone.className).not.toContain("import-dropzone--over");

    fireEvent.dragOver(dropzone);
    expect(dropzone.className).toContain("import-dropzone--over");

    fireEvent.dragLeave(dropzone);
    expect(dropzone.className).not.toContain("import-dropzone--over");
  });

  it("rejects a dropped file with an unsupported extension via a toast", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByRole("button", { name: "Validate file" })).toBeTruthy();

    const dropzone = screen.getByRole("button", { name: "Upload a CSV or XLSX file" });
    const file = new File(["%PDF"], "attendees.pdf", { type: "application/pdf" });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    expect(screen.getByTestId("at-toast").textContent).toContain("Only .csv or .xlsx files");
    expect(screen.queryByRole("button", { name: "Remove file" })).toBeNull();
    expect((screen.getByRole("button", { name: "Validate file" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("removing the picked file via the chip brings the dropzone back and clears any preview", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    previewImport.mockResolvedValueOnce(samplePreview());
    renderPage();
    expect(await screen.findByRole("button", { name: "Validate file" })).toBeTruthy();

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: "Validate file" }));
    expect(await screen.findByText("To create")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove file" }));

    expect(screen.getByRole("button", { name: "Upload a CSV or XLSX file" })).toBeTruthy();
    expect(screen.queryByText("To create")).toBeNull();
    expect((screen.getByRole("button", { name: "Validate file" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("clears the native file input when the file is removed, so Browse-ing the same file again re-fires the picker (CodeRabbit review)", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByRole("button", { name: "Validate file" })).toBeTruthy();

    selectFile();
    const fileInput = screen.getByLabelText("File (.csv or .xlsx)") as HTMLInputElement;
    // jsdom doesn't emulate the browser's fake-path auto-value on a real file pick, so assert
    // the underlying reset the fix relies on: the native input's value setter is invoked with
    // "" when the file is removed (real browsers require this to re-fire onChange for the same
    // file next time).
    const valueSetter = vi.spyOn(fileInput, "value", "set");

    fireEvent.click(screen.getByRole("button", { name: "Remove file" }));

    expect(valueSetter).toHaveBeenCalledWith("");
  });
});

describe("ImportPage history + done screen (#358 Phase C)", () => {
  it("renders the import history card with recent commits", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    fetchImportHistory.mockResolvedValue([
      {
        id: "log-1",
        created_at: "2026-06-07T10:00:00.000Z",
        filename: "attendees_final.csv",
        created: 312,
        updated: 171,
        skipped: 4,
      },
    ]);
    renderPage();

    expect(await screen.findByText("Import history")).toBeTruthy();
    expect(await screen.findByText("attendees_final.csv")).toBeTruthy();
    expect(screen.getByText("312")).toBeTruthy();
    expect(screen.getByText("171")).toBeTruthy();
  });

  it("shows an empty state when there are no imports yet", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("No imports yet for this event.")).toBeTruthy();
  });

  it("shows an inline error with Retry when history fails to load, and retries", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    fetchImportHistory.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce([]);
    renderPage();

    expect(await screen.findByText("Couldn't load import history.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No imports yet for this event.")).toBeTruthy();
  });

  it("starts a fresh no-flash delay on Retry after a load failure, instead of showing Loading immediately (bot review)", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    fetchImportHistory.mockRejectedValueOnce(new Error("boom"));
    renderPage();

    expect(await screen.findByText("Couldn't load import history.")).toBeTruthy();

    let resolveRetry!: (items: unknown) => void;
    fetchImportHistory.mockImplementationOnce(
      () => new Promise((resolve) => { resolveRetry = resolve; }),
    );

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));

      expect(screen.queryByText("Couldn't load import history.")).toBeNull();
      expect(screen.queryByText("Loading…")).toBeNull();

      act(() => {
        vi.advanceTimersByTime(199);
      });
      expect(screen.queryByText("Loading…")).toBeNull();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.getByText("Loading…")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }

    await act(async () => {
      resolveRetry([]);
    });
    expect(await screen.findByText("No imports yet for this event.")).toBeTruthy();
  });

  it("shows the mockup done screen after commit and 'Import another file' resets the flow", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    previewImport.mockResolvedValueOnce(samplePreview());
    commitImport.mockResolvedValueOnce({
      importId: "imp-1",
      toCreate: 1,
      toUpdate: 0,
      toSkip: 0,
      created: 1,
      updated: 0,
      skipped: [],
      invalidRows: [],
      invalidCount: 0,
    });
    renderPage();
    expect(await screen.findByRole("button", { name: "Validate file" })).toBeTruthy();

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: "Validate file" }));
    expect(await screen.findByText("To create")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Dry run/));
    fireEvent.click(screen.getByRole("button", { name: /^Commit import \(1 attendee\)$/ }));

    expect(await screen.findByText("Import complete")).toBeTruthy();
    expect(screen.getByText(/1 attendee created · 0 updated · 0 skipped/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "View attendees" })).toBeTruthy();
    // History refreshes after a successful commit (initial load + post-commit) — the
    // historyToken-keyed effect that triggers the second fetch runs in the same commit as the
    // "Import complete" text, but isn't guaranteed to have flushed by the time findByText's own
    // MutationObserver-driven resolution hands control back here, so this needs its own wait
    // rather than asserting synchronously right after (flaky under CI's parallel test load).
    await waitFor(() => {
      expect(fetchImportHistory).toHaveBeenCalledTimes(2);
    });

    fireEvent.click(screen.getByRole("button", { name: "Import another file" }));
    expect(await screen.findByRole("button", { name: "Upload a CSV or XLSX file" })).toBeTruthy();
    expect((screen.getByLabelText(/Dry run/) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText("Import complete")).toBeNull();
  });

  it("notes the true total on the done screen when the server capped commit's skipped/invalid row detail (CodeRabbit review)", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    previewImport.mockResolvedValueOnce(samplePreview());
    commitImport.mockResolvedValueOnce({
      importId: "imp-1",
      toCreate: 0,
      toUpdate: 0,
      toSkip: 5,
      created: 0,
      updated: 0,
      skipped: [{ email: "existing@example.com", reason: "Attendee already exists" }],
      invalidRows: [{ rowIndex: 1, reason: "Missing email" }],
      invalidCount: 5,
    });
    renderPage();
    expect(await screen.findByRole("button", { name: "Validate file" })).toBeTruthy();

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: "Validate file" }));
    expect(await screen.findByText("To create")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Dry run/));
    fireEvent.click(screen.getByRole("button", { name: /^Commit import \(1 attendee\)$/ }));

    expect(await screen.findByText("Import complete")).toBeTruthy();
    expect(screen.getByText("Skipped rows — showing first 1 of 5")).toBeTruthy();
    expect(screen.getByText("Invalid rows — showing first 1 of 5")).toBeTruthy();
  });

  it("resets to the loading state when navigating directly from one event's import page to another, so the previous event's history can't flash under the new event's timezone (CodeRabbit review)", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    fetchImportHistory.mockResolvedValueOnce([
      {
        id: "log-evt1",
        created_at: "2026-06-01T10:00:00.000Z",
        filename: "evt1.csv",
        created: 5,
        updated: 1,
        skipped: 0,
      },
    ]);
    let resolveSecond!: (items: unknown) => void;
    const secondFetch = new Promise((resolve) => {
      resolveSecond = resolve;
    });
    fetchImportHistory.mockImplementationOnce(() => secondFetch);

    const router = createMemoryRouter(
      [{ path: "/admin/events/:eventId/attendees/import", element: <ImportPage /> }],
      { initialEntries: ["/admin/events/evt-1/attendees/import"], initialIndex: 0 },
    );
    renderWithToast(<RouterProvider router={router} />);

    expect(await screen.findByText("evt1.csv")).toBeTruthy();

    // useDelayedLoading only shows the text once the fetch has stayed pending past its
    // 200ms grace window (avoids flashing it for a near-instant response) — fake timers
    // must be installed before the navigation so the hook's setTimeout is one of ours.
    vi.useFakeTimers();
    try {
      await act(async () => {
        await router.navigate("/admin/events/evt-2/attendees/import");
      });

      expect(screen.queryByText("evt1.csv")).toBeNull();

      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.getByText("Loading…")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }

    await act(async () => {
      resolveSecond([
        {
          id: "log-evt2",
          created_at: "2026-06-02T10:00:00.000Z",
          filename: "evt2.csv",
          created: 2,
          updated: 0,
          skipped: 0,
        },
      ]);
    });

    expect(await screen.findByText("evt2.csv")).toBeTruthy();
  });
});

describe("ImportPage dry-run reflex guard (code review)", () => {
  it("re-arms Dry run on every fresh validate, even if it was already switched off beforehand", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    previewImport.mockResolvedValueOnce(samplePreview());
    renderPage();
    await screen.findByRole("button", { name: "Validate file" });

    selectFile();
    // Flip Dry run off BEFORE validating — this must not count as "reviewed the summary".
    fireEvent.click(screen.getByLabelText(/Dry run/));
    expect((screen.getByLabelText(/Dry run/) as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Validate file" }));
    await screen.findByText("To create");

    // The switch is forced back to safe, and Commit stays disabled until it's turned off again.
    expect((screen.getByLabelText(/Dry run/) as HTMLInputElement).checked).toBe(true);
    const commitBtn = screen.getByRole("button", { name: /^Commit import \(1 attendee\)$/ }) as HTMLButtonElement;
    expect(commitBtn.disabled).toBe(true);
  });

  it("re-arms Dry run on Re-validate too, not just the first Validate file click", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    previewImport.mockResolvedValue(samplePreview());
    renderPage();
    await screen.findByRole("button", { name: "Validate file" });

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: "Validate file" }));
    await screen.findByText("To create");

    fireEvent.click(screen.getByLabelText(/Dry run/));
    expect((screen.getByLabelText(/Dry run/) as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Re-validate" }));
    await waitFor(() => expect(previewImport).toHaveBeenCalledTimes(2));

    expect((screen.getByLabelText(/Dry run/) as HTMLInputElement).checked).toBe(true);
  });
});
