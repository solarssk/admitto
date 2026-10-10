// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider } from "react-router/dom";
import { createMemoryRouter, MemoryRouter, Route, Routes } from "react-router";
import { ApiError } from "../../src/api/client.js";
import { reportApiError } from "../../src/connection/ConnectionStateProvider.js";
import { waitForImportJobResult } from "../../src/import/waitForImportJobResult.js";
import { ImportPage } from "../../src/pages/ImportPage.js";
import { LOAD_TIMEOUT_MESSAGE, SLOW_NOTICE_TEXT } from "../../src/utils/loading-timing.js";
import { advanceTimers, deferred, hangUntilAborted, isOff, makeOrgAdminAssignment, renderWithToast } from "../test-utils.js";
import { importApiMocks } from "./importApiMock.js";

const { fetchEventCustomFields, previewImport, commitImport, fetchImportHistory } = importApiMocks;

vi.mock("../../src/connection/ConnectionStateProvider.js");

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: [makeOrgAdminAssignment()] }),
}));

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const { buildImportApiMock } = await import("./importApiMock.js");
  return buildImportApiMock(await importOriginal<typeof import("../../src/api/client.js")>());
});

vi.mock("../../src/import/waitForImportJobResult.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/import/waitForImportJobResult.js")>()),
  waitForImportJobResult: vi.fn(),
}));

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useOutletContext: () => ({ event: { id: "evt-1", title: "Demo", archived_at: null, timezone: "Europe/Warsaw" } }),
}));

const IMPORT_PATH = "/admin/events/:eventId/attendees/import";

function renderPage() {
  return renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/attendees/import"]}>
      <Routes>
        <Route path={IMPORT_PATH} element={<ImportPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const placeholder = () => screen.queryByRole("status", { name: "Loading import history" });
const historyRow = (id: string, filename: string) => ({
  id,
  created_at: "2026-06-01T10:00:00.000Z",
  filename,
  created: 5,
  updated: 1,
  skipped: 0,
  status: "succeeded" as const,
  error: null,
});

const samplePreview = () => ({
  importId: "imp-1",
  parse: { validCount: 1, invalidRows: [], invalidCount: 0, warnings: [] },
  summary: { toCreate: 1, toUpdate: 0, toSkip: 0, skipped: [] },
  sampleRows: [
    { rowIndex: 1, name: "Jane", email: "jane@example.com", ticket_type: "", company: "", department: "", external_uuid: "", custom_data: {} },
  ],
  attributeFieldLabels: [],
});

const sampleResult = () => ({
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

function pickFile() {
  const input = screen.getByLabelText("File (.csv or .xlsx)") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["a,b\n1,2"], "attendees.csv", { type: "text/csv" })] } });
}

/** The page with a file chosen and validated: the summary is on screen. */
async function toPreviewStep() {
  previewImport.mockResolvedValueOnce(samplePreview());
  renderPage();
  await advanceTimers(0);
  pickFile();
  fireEvent.click(screen.getByRole("button", { name: "Validate file" }));
  await advanceTimers(0);
  expect(screen.getByText("To create")).toBeTruthy();
}

const commitButton = () => screen.getByRole("button", { name: /^(Commit import \(1 attendee\)|Importing…)$/ });

/** From the summary to a commit that is on its way: Dry run off, Commit pressed, the job not answered. */
async function startCommit() {
  fireEvent.click(screen.getByLabelText(/Dry run/));
  const job = deferred<ReturnType<typeof sampleResult>>();
  commitImport.mockResolvedValue({ jobId: "job-1", status: "pending", importId: "imp-1" });
  vi.mocked(waitForImportJobResult).mockReturnValue(job.promise as never);
  const commit = commitButton();
  commit.focus();
  fireEvent.click(commit);
  await advanceTimers(0);
  return { job, commit };
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchImportHistory.mockReset().mockResolvedValue([]);
  fetchEventCustomFields.mockReset().mockResolvedValue([]);
  previewImport.mockReset();
  commitImport.mockReset();
  vi.mocked(waitForImportJobResult).mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("ImportPage on the loading standard: the import history", () => {
  it("holds the history's room invisibly for 200ms, then draws the table's own shape with its real column headings", async () => {
    fetchImportHistory.mockImplementation(hangUntilAborted as never);
    renderPage();
    await advanceTimers(0);

    const held = placeholder() as HTMLElement;
    expect(held.classList.contains("at-loading-hold")).toBe(true);
    expect(within(held).getAllByRole("columnheader", { hidden: true }).map((heading) => heading.textContent)).toEqual([
      "Date",
      "File",
      "Status",
      "Created",
      "Updated",
      "Skipped",
    ]);
    await advanceTimers(200);
    expect((placeholder() as HTMLElement).classList.contains("at-loading-hold")).toBe(false);
  });

  it("never draws the placeholder for an answer that comes within 200ms", async () => {
    renderPage();
    await advanceTimers(0);
    expect(placeholder()).toBeNull();
    expect(screen.getByText("No imports yet for this event.")).toBeTruthy();
    await advanceTimers(500);
    expect(placeholder()).toBeNull();
  });

  it("keeps a placeholder that did show for at least 400ms before the rows replace it", async () => {
    const slow = deferred<ReturnType<typeof historyRow>[]>();
    fetchImportHistory.mockReturnValue(slow.promise);
    renderPage();
    await advanceTimers(0);
    await advanceTimers(250);
    expect((placeholder() as HTMLElement).classList.contains("at-loading-hold")).toBe(false);

    await act(async () => slow.resolve([historyRow("log-1", "first.csv")]));
    expect(placeholder()).not.toBeNull();
    await advanceTimers(349);
    expect(placeholder()).not.toBeNull();
    await advanceTimers(1);
    expect(placeholder()).toBeNull();
    expect(screen.getByText("first.csv")).toBeTruthy();
  });

  it("keeps the card unpadded for the table and for its placeholder, and padded for the text states", async () => {
    const card = () => screen.getByText("Import history").closest(".at-card") as HTMLElement;
    const rows = deferred<ReturnType<typeof historyRow>[]>();
    fetchImportHistory.mockReturnValueOnce(rows.promise);
    renderPage();
    await advanceTimers(0);
    await advanceTimers(250);
    expect(placeholder()).not.toBeNull();
    expect(card().querySelector(".at-card__body")).toBeNull();

    await act(async () => rows.resolve([historyRow("log-1", "first.csv")]));
    await advanceTimers(500);
    expect(screen.getByText("first.csv")).toBeTruthy();
    expect(card().querySelector(".at-card__body")).toBeNull();
  });

  it("keeps the normal card padding for the text states: no imports yet, and an error", async () => {
    const card = () => screen.getByText("Import history").closest(".at-card") as HTMLElement;
    renderPage();
    await advanceTimers(0);
    expect(screen.getByText("No imports yet for this event.")).toBeTruthy();
    expect(card().querySelector(".at-card__body")).not.toBeNull();
    cleanup();

    fetchImportHistory.mockRejectedValueOnce(new Error("blip"));
    renderPage();
    await advanceTimers(0);
    expect(screen.getByRole("alert").textContent).toContain("Could not load import history");
    expect(card().querySelector(".at-card__body")).not.toBeNull();
  });

  it("says it is taking longer than usual after 8 seconds", async () => {
    fetchImportHistory.mockImplementation(hangUntilAborted as never);
    renderPage();
    await advanceTimers(0);
    await advanceTimers(7_999);
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
    await advanceTimers(1);
    expect(screen.getByText(SLOW_NOTICE_TEXT)).toBeTruthy();
  });

  it("ends in an error after 30 seconds, and the Retry keeps the error on screen, busy, until the rows are in", async () => {
    fetchImportHistory.mockImplementationOnce(hangUntilAborted as never);
    renderPage();
    await advanceTimers(0);
    await advanceTimers(30_000);
    await advanceTimers(0);
    expect(screen.getByRole("alert").textContent).toContain("Could not load import history");
    expect(screen.getByRole("alert").textContent).toContain(LOAD_TIMEOUT_MESSAGE);

    const rows = deferred<ReturnType<typeof historyRow>[]>();
    fetchImportHistory.mockReturnValueOnce(rows.promise);
    const retry = screen.getByRole("button", { name: "Retry" });
    retry.focus();
    fireEvent.click(retry);
    await advanceTimers(500);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(retry);
    expect(screen.getByRole("alert").textContent).toContain("Could not load import history");
    expect(placeholder()).toBeNull();

    await act(async () => rows.resolve([historyRow("log-1", "second.csv")]));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("second.csv")).toBeTruthy();
  });

  it("keeps the rows on screen, blocked and then dimmed, while the history refreshes after a commit that failed", async () => {
    fetchImportHistory.mockResolvedValueOnce([historyRow("log-1", "first.csv")]);
    await toPreviewStep();
    expect(screen.getByText("first.csv")).toBeTruthy();

    const refreshed = deferred<ReturnType<typeof historyRow>[]>();
    fetchImportHistory.mockReturnValueOnce(refreshed.promise);
    commitImport.mockRejectedValueOnce(new ApiError(500, "boom"));
    fireEvent.click(screen.getByLabelText(/Dry run/));
    fireEvent.click(commitButton());
    await advanceTimers(0);

    expect(screen.getByText("first.csv")).toBeTruthy();
    expect(document.querySelector(".refetch-card--busy")).not.toBeNull();
    expect(document.querySelector(".refetch-card--dim")).toBeNull();
    await advanceTimers(200);
    expect(document.querySelector(".refetch-card--dim")).not.toBeNull();

    await act(async () => refreshed.resolve([historyRow("log-2", "failed-job.csv"), historyRow("log-1", "first.csv")]));
    await advanceTimers(500);
    expect(screen.getByText("failed-job.csv")).toBeTruthy();
    expect(document.querySelector(".refetch-card--busy")).toBeNull();
  });

  it("keeps the rows and says they may be older when the refresh after a commit fails", async () => {
    fetchImportHistory.mockResolvedValueOnce([historyRow("log-1", "first.csv")]);
    await toPreviewStep();

    fetchImportHistory.mockRejectedValueOnce(new Error("blip"));
    commitImport.mockRejectedValueOnce(new ApiError(500, "boom"));
    fireEvent.click(screen.getByLabelText(/Dry run/));
    fireEvent.click(commitButton());
    await advanceTimers(500);

    expect(screen.getByText("first.csv")).toBeTruthy();
    const warning = screen.getAllByRole("alert").find((alert) => alert.textContent?.includes("may show older details"));
    expect(warning).toBeTruthy();
    expect(within(warning as HTMLElement).getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});

describe("ImportPage: what the history lists and what the route says", () => {
  it("lists each import with its outcome: a failed job with its error, or a plain Failed, and a missing file name as a dash", async () => {
    fetchImportHistory.mockResolvedValue([
      historyRow("log-1", "ok.csv"),
      { ...historyRow("log-2", "bad.csv"), status: "failed" as const, error: "Worker stopped" },
      { ...historyRow("log-3", "unused"), filename: null, status: "failed" as const, error: null },
    ]);
    renderPage();
    await advanceTimers(0);

    expect(screen.getByText("Succeeded")).toBeTruthy();
    expect(screen.getByText("Worker stopped")).toBeTruthy();
    const plainFailure = screen.getByText("Failed").closest("tr") as HTMLElement;
    expect(within(plainFailure).getByText("-")).toBeTruthy();
  });

  it("says the event is missing when the route has no event id", () => {
    renderWithToast(
      <MemoryRouter initialEntries={["/import"]}>
        <Routes>
          <Route path="/import" element={<ImportPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Missing event.")).toBeTruthy();
  });
});

describe("ImportPage on the loading standard: Validate and Re-validate", () => {
  it("shows Validate busy on the button itself, with the label's room and its focus, runs a bar along the file's card, and ignores a second press", async () => {
    const answer = deferred<ReturnType<typeof samplePreview>>();
    previewImport.mockReturnValue(answer.promise);
    renderPage();
    await advanceTimers(0);
    pickFile();

    const validate = screen.getByRole("button", { name: "Validate file" });
    validate.focus();
    fireEvent.click(validate);
    await advanceTimers(0);

    expect(validate.getAttribute("aria-busy")).toBe("true");
    expect(isOff(validate)).toBe(true);
    expect(screen.getByRole("button", { name: "Validating…" })).toBe(validate);
    expect(document.activeElement).toBe(validate);
    expect(screen.getByRole("status", { name: "Validating file" })).toBeTruthy();
    expect(screen.getByText("Validating file. Actions are paused until it finishes.")).toBeTruthy();
    fireEvent.click(validate);
    expect(previewImport).toHaveBeenCalledTimes(1);

    await act(async () => answer.resolve(samplePreview()));
    expect(screen.getByText("To create")).toBeTruthy();
  });

  it("hands the keyboard focus to the summary when it replaces the Validate button that held it", async () => {
    previewImport.mockResolvedValueOnce(samplePreview());
    renderPage();
    await advanceTimers(0);
    pickFile();

    const validate = screen.getByRole("button", { name: "Validate file" });
    validate.focus();
    fireEvent.click(validate);
    await advanceTimers(0);

    expect(screen.queryByRole("button", { name: "Validate file" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByText("Validation summary"));
  });

  it("leaves the focus alone when the operator has moved on by the time the summary is there", async () => {
    const answer = deferred<ReturnType<typeof samplePreview>>();
    previewImport.mockReturnValue(answer.promise);
    renderPage();
    await advanceTimers(0);
    pickFile();

    const validate = screen.getByRole("button", { name: "Validate file" });
    validate.focus();
    fireEvent.click(validate);
    await advanceTimers(0);
    const download = screen.getByRole("link", { name: /Download CSV template/ });
    download.focus();

    await act(async () => answer.resolve(samplePreview()));
    expect(document.activeElement).toBe(download);
  });

  it("puts Validate back with its focus when the validation fails, says why, and takes the bar away", async () => {
    previewImport.mockRejectedValueOnce(new ApiError(400, "invalid file content", "invalid file content"));
    renderPage();
    await advanceTimers(0);
    pickFile();

    const validate = screen.getByRole("button", { name: "Validate file" });
    validate.focus();
    fireEvent.click(validate);
    await advanceTimers(0);
    await advanceTimers(400);

    expect(screen.getByTestId("at-toast")).toBeTruthy();
    expect(validate.getAttribute("aria-busy")).toBeNull();
    expect(isOff(validate)).toBe(false);
    expect(document.activeElement).toBe(validate);
    expect(screen.queryByRole("status", { name: "Validating file" })).toBeNull();
    expect(screen.queryByText(/Actions are paused until it finishes/)).toBeNull();
    expect(reportApiError).toHaveBeenCalledWith(400);
  });

  it("keeps the options and the file off while a validation runs, since they are not the busy control", async () => {
    previewImport.mockReturnValue(new Promise(() => {}));
    renderPage();
    await advanceTimers(0);
    pickFile();
    fireEvent.click(screen.getByRole("button", { name: "Validate file" }));
    await advanceTimers(0);

    expect((screen.getByLabelText(/Overwrite existing attendees/) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Remove file" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows Re-validate busy on its own button while Commit waits", async () => {
    await toPreviewStep();
    const second = deferred<ReturnType<typeof samplePreview>>();
    previewImport.mockReturnValueOnce(second.promise);

    const revalidate = screen.getByRole("button", { name: "Re-validate" });
    revalidate.focus();
    fireEvent.click(revalidate);
    await advanceTimers(0);

    expect(revalidate.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("button", { name: "Validating…" })).toBe(revalidate);
    expect(document.activeElement).toBe(revalidate);
    const commit = commitButton();
    expect(commit.getAttribute("aria-busy")).toBeNull();
    expect(isOff(commit)).toBe(true);

    await act(async () => second.resolve(samplePreview()));
    await advanceTimers(400);
    expect(revalidate.getAttribute("aria-busy")).toBeNull();
    expect(screen.queryByRole("status", { name: "Validating file" })).toBeNull();
  });

  it("abandons a validation that is still on its way when the operator goes to another event, and shows nothing of its answer there", async () => {
    const answer = deferred<ReturnType<typeof samplePreview>>();
    previewImport.mockReturnValue(answer.promise);
    const router = createMemoryRouter([{ path: IMPORT_PATH, element: <ImportPage /> }], {
      initialEntries: ["/admin/events/evt-1/attendees/import"],
    });
    renderWithToast(<RouterProvider router={router} />);
    await advanceTimers(0);
    pickFile();
    fireEvent.click(screen.getByRole("button", { name: "Validate file" }));
    await advanceTimers(0);
    const signal = previewImport.mock.calls[0]?.[3] as AbortSignal;
    expect(signal.aborted).toBe(false);

    await act(async () => {
      await router.navigate("/admin/events/evt-2/attendees/import");
    });
    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole("button", { name: "Validating…" })).toBeNull();

    await act(async () => answer.resolve(samplePreview()));
    expect(screen.queryByText("To create")).toBeNull();
    expect(screen.queryByTestId("at-toast")).toBeNull();
    expect(screen.getByRole("button", { name: "Upload a CSV or XLSX file" })).toBeTruthy();
  });

  it("ignores the answer of a validation that was abandoned, and one that fails after it", async () => {
    const answer = deferred<ReturnType<typeof samplePreview>>();
    previewImport.mockReturnValue(answer.promise);
    const view = renderPage();
    await advanceTimers(0);
    pickFile();
    fireEvent.click(screen.getByRole("button", { name: "Validate file" }));
    await advanceTimers(0);
    view.unmount();

    await act(async () => answer.reject(new ApiError(500, "boom")));
    expect(reportApiError).not.toHaveBeenCalled();
  });
});

describe("ImportPage on the loading standard: Commit", () => {
  it("shows Commit busy on its own button and a bar along the file's card, and keeps Re-validate and the options off meanwhile", async () => {
    await toPreviewStep();
    const { job, commit } = await startCommit();

    expect(commit.getAttribute("aria-busy")).toBe("true");
    expect(isOff(commit)).toBe(true);
    expect(screen.getByRole("button", { name: "Importing…" })).toBe(commit);
    expect(document.activeElement).toBe(commit);
    const revalidate = screen.getByRole("button", { name: "Re-validate" });
    expect(revalidate.getAttribute("aria-busy")).toBeNull();
    expect(isOff(revalidate)).toBe(true);
    expect((screen.getByLabelText(/Overwrite existing attendees/) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole("status", { name: "Importing attendees" })).toBeTruthy();
    expect(screen.getByText("Importing attendees. Actions are paused until it finishes.")).toBeTruthy();
    fireEvent.click(commit);
    expect(commitImport).toHaveBeenCalledTimes(1);

    await act(async () => job.resolve(sampleResult()));
  });

  it("hands the keyboard focus to the title of the done step when it replaces the Commit button that held it", async () => {
    await toPreviewStep();
    const { job } = await startCommit();
    fetchImportHistory.mockClear();

    await act(async () => job.resolve(sampleResult()));
    expect(screen.queryByRole("button", { name: /^Commit import/ })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Import complete" }));
    // The history is read again for the next time the upload step is on screen.
    expect(fetchImportHistory).toHaveBeenCalledTimes(1);
  });

  it("brings Commit back with its focus when the commit fails, says why, and refreshes the history", async () => {
    await toPreviewStep();
    fireEvent.click(screen.getByLabelText(/Dry run/));
    commitImport.mockRejectedValueOnce(new ApiError(500, "boom"));
    const commit = commitButton();
    commit.focus();
    fetchImportHistory.mockClear();
    fireEvent.click(commit);
    await advanceTimers(500);

    expect(screen.getByTestId("at-toast")).toBeTruthy();
    expect(commit.getAttribute("aria-busy")).toBeNull();
    expect(document.activeElement).toBe(commit);
    expect(screen.queryByRole("status", { name: "Importing attendees" })).toBeNull();
    expect(fetchImportHistory).toHaveBeenCalledTimes(1);
  });

  it("hands the focus to the drop zone when Import another file brings the upload step back", async () => {
    await toPreviewStep();
    const { job } = await startCommit();
    await act(async () => job.resolve(sampleResult()));

    const another = screen.getByRole("button", { name: "Import another file" });
    another.focus();
    fireEvent.click(another);
    await advanceTimers(0);

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Upload a CSV or XLSX file" }));
  });

  it("does not move the focus of an operator who clicked something else while the import ran", async () => {
    await toPreviewStep();
    const { job } = await startCommit();
    const back = screen.getByRole("link", { name: /Back to attendees/ });
    back.focus();

    await act(async () => job.resolve(sampleResult()));
    expect(document.activeElement).toBe(back);
  });
});

describe("ImportPage on the loading standard: the event's custom columns", () => {
  const shirtSize = {
    id: "1",
    source_field: "shirt_size",
    label: "Shirt size",
    description: "Attendee's t-shirt size",
    type: "text",
    required: false,
    options: null,
    created_at: "2026-01-01T00:00:00.000Z",
  };

  it("draws a placeholder under the table only once the lookup has taken 200ms", async () => {
    fetchEventCustomFields.mockImplementation(hangUntilAborted as never);
    renderPage();
    await advanceTimers(0);

    const slot = screen.getByRole("status", { name: "Loading custom columns" });
    expect(slot.classList.contains("at-loading-hold")).toBe(true);
    await advanceTimers(200);
    expect(screen.getByRole("status", { name: "Loading custom columns" }).classList.contains("at-loading-hold")).toBe(false);
  });

  it("says the custom columns could not be loaded, with a Retry that reruns that lookup only", async () => {
    const answer = deferred<(typeof shirtSize)[]>();
    fetchEventCustomFields.mockRejectedValueOnce(new ApiError(500, "boom")).mockReturnValueOnce(answer.promise);
    renderPage();
    await advanceTimers(0);

    expect(screen.getByText("Could not load this event's custom columns.")).toBeTruthy();
    expect(screen.queryByText("shirt_size")).toBeNull();
    fetchImportHistory.mockClear();

    const retry = screen.getByRole("button", { name: "Retry loading custom columns" });
    fireEvent.click(retry);
    await advanceTimers(0);
    // The error and its Retry stay on screen, busy, until the answer is in.
    expect(screen.getByText("Could not load this event's custom columns.")).toBeTruthy();
    expect(retry.getAttribute("aria-busy")).toBe("true");

    await act(async () => answer.resolve([shirtSize]));
    await advanceTimers(500);
    expect(screen.queryByText("Could not load this event's custom columns.")).toBeNull();
    expect(screen.getByText("shirt_size")).toBeTruthy();
    expect(fetchImportHistory).not.toHaveBeenCalled();
  });
});
