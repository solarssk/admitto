// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ImportPage } from "../../src/pages/ImportPage.js";
import { renderWithToast } from "../test-utils.js";

const fetchEventCustomFields = vi.fn();
const previewImport = vi.fn();
const commitImport = vi.fn();

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
    });
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Preview" })).toBeTruthy());

    selectFile();
    fireEvent.click(screen.getByLabelText(/Overwrite existing attendees/));

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() => {
      expect(previewImport).toHaveBeenCalledWith("evt-1", expect.any(File), true);
    });

    await waitFor(() => expect(screen.getByText("To create")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /^Import 1 attendee$/ }));
    await waitFor(() => {
      expect(commitImport).toHaveBeenCalledWith("evt-1", expect.any(File), true, { force: false });
    });
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Attendees imported: 1 created/);
    });
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
      });
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Preview" })).toBeTruthy());

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(screen.getByText("To create")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /^Import 2 attendees$/ }));
    await waitFor(() => {
      expect(screen.getByText(/Event is at capacity/)).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText(/Override capacity limit/));
    fireEvent.click(screen.getByRole("button", { name: /^Import 2 attendees$/ }));

    await waitFor(() => {
      expect(commitImport).toHaveBeenLastCalledWith("evt-1", expect.any(File), false, { force: true });
    });
  });

  it("ignores a cancelled file picker and resets to the upload step when a new file is chosen after preview", async () => {
    fetchEventCustomFields.mockResolvedValue([]);
    previewImport.mockResolvedValueOnce(samplePreview());
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Preview" })).toBeTruthy());

    // Cancelling the native file picker fires a change event with an empty FileList.
    fireEvent.change(screen.getByLabelText("File (.csv or .xlsx)"), { target: { files: [] } });
    expect((screen.getByRole("button", { name: "Preview" }) as HTMLButtonElement).disabled).toBe(true);

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(screen.getByText("To create")).toBeTruthy());

    // Choosing a different file after previewing sends the flow back to "upload".
    selectFile();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Preview" })).toBeTruthy();
      expect(screen.queryByText("To create")).toBeNull();
    });
  });
});
