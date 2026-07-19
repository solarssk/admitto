// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
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
    parse: { validCount: 1, invalidRows: [], warnings: [] },
    summary: { toCreate: 1, toUpdate: 0, toSkip: 0 },
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
    });
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Validate file" })).toBeTruthy());

    selectFile();
    fireEvent.click(screen.getByLabelText(/Overwrite existing attendees/));

    fireEvent.click(screen.getByRole("button", { name: "Validate file" }));
    await waitFor(() => {
      expect(previewImport).toHaveBeenCalledWith("evt-1", expect.any(File), true);
    });

    await waitFor(() => expect(screen.getByText("To create")).toBeTruthy());

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
    });
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Validate file" })).toBeTruthy());

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: "Validate file" }));
    await waitFor(() => expect(screen.getByText("To create")).toBeTruthy());

    fireEvent.click(screen.getByLabelText(/Dry run/));
    fireEvent.click(screen.getByRole("button", { name: /^Commit import \(1 attendee\)$/ }));
    await waitFor(() => expect(commitImport).toHaveBeenCalled());

    expect(await screen.findByText("Invalid rows")).toBeTruthy();
    expect(screen.getByText('Unknown ticket type: "vip"')).toBeTruthy();
  });

  it("lets a superadmin override a capacity block and re-commit with force (plural count)", async () => {
    mockAssignments = [{ role: "superadmin", scope_type: "instance", scope_id: null }];
    fetchEventCustomFields.mockResolvedValue([]);
    previewImport.mockResolvedValueOnce(samplePreview({ summary: { toCreate: 2, toUpdate: 0, toSkip: 0 } }));
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
      });
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Validate file" })).toBeTruthy());

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: "Validate file" }));
    await waitFor(() => expect(screen.getByText("To create")).toBeTruthy());

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
    await waitFor(() => expect(screen.getByRole("button", { name: "Validate file" })).toBeTruthy());

    // Cancelling the native file picker fires a change event with an empty FileList.
    fireEvent.change(screen.getByLabelText("File (.csv or .xlsx)"), { target: { files: [] } });
    expect((screen.getByRole("button", { name: "Validate file" }) as HTMLButtonElement).disabled).toBe(true);

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: "Validate file" }));
    await waitFor(() => expect(screen.getByText("To create")).toBeTruthy());

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
    await waitFor(() => expect(screen.getByRole("button", { name: "Validate file" })).toBeTruthy());

    const dropzone = screen.getByRole("button", { name: "Upload a CSV or XLSX file" });
    const file = new File(["a,b\n1,2"], "dropped.csv", { type: "text/csv" });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    expect(screen.getByText("dropped.csv")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove file" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Validate file" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("rejects a dropped file with an unsupported extension via a toast", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Validate file" })).toBeTruthy());

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
    await waitFor(() => expect(screen.getByRole("button", { name: "Validate file" })).toBeTruthy());

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: "Validate file" }));
    await waitFor(() => expect(screen.getByText("To create")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Remove file" }));

    expect(screen.getByRole("button", { name: "Upload a CSV or XLSX file" })).toBeTruthy();
    expect(screen.queryByText("To create")).toBeNull();
    expect((screen.getByRole("button", { name: "Validate file" }) as HTMLButtonElement).disabled).toBe(true);
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

    await waitFor(() => expect(screen.getByText("Import history")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("attendees_final.csv")).toBeTruthy());
    expect(screen.getByText("312")).toBeTruthy();
    expect(screen.getByText("171")).toBeTruthy();
  });

  it("shows an empty state when there are no imports yet", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText("No imports yet for this event.")).toBeTruthy());
  });

  it("shows an inline error with Retry when history fails to load, and retries", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    fetchImportHistory.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce([]);
    renderPage();

    await waitFor(() => expect(screen.getByText("Couldn't load import history.")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("No imports yet for this event.")).toBeTruthy());
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
    });
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Validate file" })).toBeTruthy());

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: "Validate file" }));
    await waitFor(() => expect(screen.getByText("To create")).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/Dry run/));
    fireEvent.click(screen.getByRole("button", { name: /^Commit import \(1 attendee\)$/ }));

    await waitFor(() => expect(screen.getByText("Import complete")).toBeTruthy());
    expect(screen.getByText(/1 attendee created · 0 updated · 0 skipped/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "View attendees" })).toBeTruthy();
    // History refreshes after a successful commit (initial load + post-commit).
    expect(fetchImportHistory).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Import another file" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Upload a CSV or XLSX file" })).toBeTruthy(),
    );
    expect((screen.getByLabelText(/Dry run/) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText("Import complete")).toBeNull();
  });
});
