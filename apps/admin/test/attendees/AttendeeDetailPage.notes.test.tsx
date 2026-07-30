// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import type { RoleAssignment } from "../../src/api/types.js";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { mockMatchMedia, renderWithToast } from "../test-utils.js";

const loadAttendeeDetailData = vi.fn();
const addAttendeeNote = vi.fn();
const updateAttendeeNote = vi.fn();
const deleteAttendeeNote = vi.fn();

const ADMIN_ONE: RoleAssignment = { role: "admin", scope_type: "organization", scope_id: "org-1" };
let assignments: RoleAssignment[] = [ADMIN_ONE];
let currentUser: { id: string } | undefined = { id: "user-admin-1" };
let outletEvent = {
  id: "evt-1",
  title: "Demo",
  slug: "demo",
  date: "2026-06-01",
  timezone: "Europe/Warsaw",
  location: null,
  attendee_count: 1,
  archived_at: null as string | null,
  organization_id: "org-1",
};

vi.mock("../../src/attendees/attendeeDetailForm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/attendees/attendeeDetailForm.js")>();
  return {
    ...actual,
    loadAttendeeDetailData: (...args: unknown[]) => loadAttendeeDetailData(...args),
  };
});

// `assignments`/`currentUser` are read fresh on every call (not captured once at mock setup),
// so individual tests can reassign them before rendering to exercise admin/superadmin RBAC.
vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments, user: currentUser }),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useOutletContext: () => ({ event: outletEvent }),
  };
});

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    updateAttendee: vi.fn(),
    resendTicket: vi.fn(),
    fetchAttendeeDetail: vi.fn(),
    addAttendeeNote: (...args: unknown[]) => addAttendeeNote(...args),
    updateAttendeeNote: (...args: unknown[]) => updateAttendeeNote(...args),
    deleteAttendeeNote: (...args: unknown[]) => deleteAttendeeNote(...args),
  };
});

function baseDetail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "att-1",
    name: "Anna",
    email: "anna@example.com",
    company: null,
    department: null,
    ticket_type: "vip",
    custom_data: {},
    status: "registered" as const,
    admitted_at: null,
    updated_at: "2026-01-01T00:00:00.000Z",
    check_in_status: "not_admitted" as const,
    last_mail_status: null,
    rsvp_status: "confirmed" as const,
    rsvp_updated_at: null,
    rsvp_source: null,
    deliveries: [],
    action_log: [],
    event_items: [],
    notes: [],
    notes_total: Array.isArray(overrides.notes) ? overrides.notes.length : 0,
    notes_page: 1,
    notes_page_size: 50,
    ...overrides,
  };
}

function mockLoad(detail: ReturnType<typeof baseDetail>) {
  loadAttendeeDetailData.mockResolvedValueOnce({ detail, attributeFields: [], itemsWarning: null });
}

function makeNote(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "note-1",
    body: "Called about dietary needs.",
    author_display: "Ola Nowak",
    author_user_id: "user-admin-1",
    author_role: "admin",
    created_at: "2026-06-01T09:00:00.000Z",
    ...overrides,
  };
}

function RouteChangeControl() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate("/admin/events/evt-2/attendees/att-2")}>
      Switch attendee
    </button>
  );
}

function renderPage({ withRouteChangeControl = false } = {}) {
  renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/attendees/att-1"]}>
      <Routes>
        <Route
          path="/admin/events/:eventId/attendees/:attendeeId"
          element={
            <>
              {withRouteChangeControl && <RouteChangeControl />}
              <AttendeeDetailPage />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

async function openNotesTab() {
  fireEvent.click(await screen.findByRole("tab", { name: /Notes/ }));
}

/** The page header also has a plain "Edit" action for the attendee's own profile, so note-level
 * Edit buttons must be queried within the notes list to avoid an ambiguous match. */
function notesList() {
  return screen.getByRole("list");
}

beforeEach(() => {
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  assignments = [ADMIN_ONE];
  currentUser = { id: "user-admin-1" };
  outletEvent = { ...outletEvent, archived_at: null };
});

describe("AttendeeDetailPage — Notes tab", () => {
  it("does not load detail when the route has no event or attendee parameters", () => {
    renderWithToast(
      <MemoryRouter initialEntries={["/"]}>
        <AttendeeDetailPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Missing event or attendee.")).toBeTruthy();
    expect(loadAttendeeDetailData).not.toHaveBeenCalled();
  });

  it("does not load detail when the route has an event but no attendee parameter", () => {
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/evt-1"]}>
        <Routes>
          <Route path="/admin/events/:eventId" element={<AttendeeDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Missing event or attendee.")).toBeTruthy();
    expect(loadAttendeeDetailData).not.toHaveBeenCalled();
  });

  it("shows the tab with no count badge and an empty state when there are no notes", async () => {
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    expect(screen.getByRole("tab", { name: "Notes" })).toBeTruthy();
    await openNotesTab();

    expect(screen.getByText("No notes yet.")).toBeTruthy();
    const hint = screen.getByText(
      /Internal notes are visible to staff only and are never shown to the attendee\./,
    );
    expect(hint.closest(".at-notice--info")).toBeTruthy();
  });

  it("shows a count badge and lists existing notes with their author", async () => {
    mockLoad(
      baseDetail({
        notes: [
          {
            id: "note-1",
            body: "Called about dietary needs.",
            author_display: "Admin",
            created_at: "2026-06-01T09:00:00.000Z",
          },
        ],
      }),
    );
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    expect(screen.getByRole("tab", { name: "Notes1" })).toBeTruthy();
    await openNotesTab();

    expect(screen.getByText("Called about dietary needs.")).toBeTruthy();
    expect(screen.getByText("Admin")).toBeTruthy();
    expect(screen.queryByText("No notes yet.")).toBeNull();
  });

  it("shows the total note count and loads another notes page", async () => {
    mockLoad(baseDetail({
      notes: [makeNote({ id: "n1", body: "Newest" })],
      notes_total: 51,
      notes_page: 1,
      notes_page_size: 50,
    }));
    mockLoad(baseDetail({
      notes: [makeNote({ id: "n51", body: "Oldest" })],
      notes_total: 51,
      notes_page: 2,
      notes_page_size: 50,
    }));
    mockLoad(baseDetail({
      notes: [makeNote({ id: "n1", body: "Newest" })],
      notes_total: 51,
      notes_page: 1,
      notes_page_size: 50,
    }));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });
    expect(screen.getByRole("tab", { name: "Notes51" })).toBeTruthy();
    await openNotesTab();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Oldest")).toBeTruthy();
    expect(screen.getByText("Page 2 of 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(await screen.findByText("Newest")).toBeTruthy();
  });

  it("keeps notes pagination usable after adding a note from a later page", async () => {
    mockLoad(baseDetail({
      notes: [makeNote({ id: "n1", body: "Newest" })],
      notes_total: 51,
      notes_page: 1,
      notes_page_size: 50,
    }));
    mockLoad(baseDetail({
      notes: [makeNote({ id: "n51", body: "Oldest" })],
      notes_total: 51,
      notes_page: 2,
      notes_page_size: 50,
    }));
    mockLoad(baseDetail({
      notes: [makeNote({ id: "n-new", body: "Added note" })],
      notes_total: 52,
      notes_page: 1,
      notes_page_size: 50,
    }));
    mockLoad(baseDetail({
      notes: [makeNote({ id: "n52", body: "Oldest after add" })],
      notes_total: 52,
      notes_page: 2,
      notes_page_size: 50,
    }));
    addAttendeeNote.mockResolvedValueOnce(baseDetail({
      notes: [makeNote({ id: "n-new", body: "Added note" })],
      notes_total: 52,
      notes_page: 1,
      notes_page_size: 50,
    }));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });
    await openNotesTab();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Oldest")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Add a note about this attendee…"), {
      target: { value: "Added note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Added note")).toBeTruthy();
    await waitFor(() => expect(loadAttendeeDetailData).toHaveBeenCalledTimes(3));

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Oldest after add")).toBeTruthy();
    expect(loadAttendeeDetailData).toHaveBeenLastCalledWith("evt-1", "att-1", 2);
  });

  it("ignores a stale notes-page response after switching attendee", async () => {
    mockLoad(baseDetail({
      notes: [makeNote({ id: "n1", body: "Anna newest" })],
      notes_total: 51,
      notes_page: 1,
      notes_page_size: 50,
    }));
    mockLoad(baseDetail({
      notes: [makeNote({ id: "n51", body: "Anna oldest" })],
      notes_total: 51,
      notes_page: 2,
      notes_page_size: 50,
    }));
    let resolveStalePage!: (value: { detail: ReturnType<typeof baseDetail>; attributeFields: []; itemsWarning: null }) => void;
    let resolveFirstPage!: (value: { detail: ReturnType<typeof baseDetail>; attributeFields: []; itemsWarning: null }) => void;
    loadAttendeeDetailData.mockReturnValueOnce(new Promise((resolve) => { resolveStalePage = resolve; }));
    loadAttendeeDetailData.mockReturnValueOnce(new Promise((resolve) => { resolveFirstPage = resolve; }));
    renderPage({ withRouteChangeControl: true });
    await screen.findByRole("heading", { name: "Anna" });
    await openNotesTab();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Anna oldest")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Switch attendee" }));
    await waitFor(() => expect(loadAttendeeDetailData).toHaveBeenCalledTimes(4));
    expect(loadAttendeeDetailData).toHaveBeenNthCalledWith(3, "evt-2", "att-2", 2);
    expect(loadAttendeeDetailData).toHaveBeenNthCalledWith(4, "evt-2", "att-2", 1);

    resolveFirstPage({
      detail: baseDetail({
        id: "att-2",
        name: "Bea",
        notes: [makeNote({ id: "b1", body: "Bea newest" })],
        notes_total: 51,
        notes_page: 1,
        notes_page_size: 50,
      }),
      attributeFields: [],
      itemsWarning: null,
    });
    expect(await screen.findByText("Bea newest")).toBeTruthy();

    resolveStalePage({
      detail: baseDetail({
        id: "att-2",
        name: "Bea",
        notes: [makeNote({ id: "b51", body: "Bea stale oldest" })],
        notes_total: 51,
        notes_page: 2,
        notes_page_size: 50,
      }),
      attributeFields: [],
      itemsWarning: null,
    });
    await waitFor(() => expect(screen.queryByText("Bea stale oldest")).toBeNull());
    expect(screen.getByText("Bea newest")).toBeTruthy();
  });

  it("keeps the Notes tab usable with a legacy detail response that lacks pagination metadata", async () => {
    mockLoad(baseDetail({
      notes: undefined,
      notes_total: undefined,
      notes_page: undefined,
      notes_page_size: undefined,
    }));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });
    await openNotesTab();

    expect(screen.getByText("No notes yet.")).toBeTruthy();
  });

  it("disables Add until the draft has non-whitespace text", async () => {
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });
    await openNotesTab();

    const addButton = screen.getByRole("button", { name: "Add" });
    const textarea = screen.getByPlaceholderText("Add a note about this attendee…");
    expect((addButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(textarea, { target: { value: "   " } });
    expect((addButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(textarea, { target: { value: "Looks good" } });
    expect((addButton as HTMLButtonElement).disabled).toBe(false);
  });

  it("submits a note, replaces the detail with the server response, clears the draft, and toasts success", async () => {
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });
    await openNotesTab();

    const textarea = screen.getByPlaceholderText("Add a note about this attendee…");
    fireEvent.change(textarea, { target: { value: "Needs wheelchair access" } });

    addAttendeeNote.mockResolvedValueOnce(
      baseDetail({
        notes: [
          {
            id: "note-1",
            body: "Needs wheelchair access",
            author_display: "Admin",
            created_at: "2026-06-01T09:00:00.000Z",
          },
        ],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(addAttendeeNote).toHaveBeenCalledWith("evt-1", "att-1", "Needs wheelchair access");
    });
    await waitFor(() => {
      expect(screen.getByText("Needs wheelchair access")).toBeTruthy();
    });
    expect(screen.getByTestId("at-toast").textContent).toContain("Note added");
    expect((screen.getByPlaceholderText("Add a note about this attendee…") as HTMLTextAreaElement).value).toBe("");
  });

  it("toasts an API error and preserves the draft on failure", async () => {
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });
    await openNotesTab();

    const textarea = screen.getByPlaceholderText("Add a note about this attendee…");
    fireEvent.change(textarea, { target: { value: "Needs wheelchair access" } });

    addAttendeeNote.mockRejectedValueOnce(new Error("boom"));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect((await screen.findByTestId("at-toast")).textContent).toContain("Could not add note.");
    expect((screen.getByPlaceholderText("Add a note about this attendee…") as HTMLTextAreaElement).value).toBe(
      "Needs wheelchair access",
    );
  });

  it("does not apply a stale note submission after navigating to another attendee", async () => {
    mockLoad(baseDetail());
    mockLoad(baseDetail({ id: "att-2", name: "Bea", notes: [] }));
    renderPage({ withRouteChangeControl: true });
    await screen.findByRole("heading", { name: "Anna" });
    await openNotesTab();

    const textarea = screen.getByPlaceholderText("Add a note about this attendee…");
    fireEvent.change(textarea, { target: { value: "Late arrival expected" } });

    let resolveRequest!: (value: ReturnType<typeof baseDetail>) => void;
    addAttendeeNote.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(addAttendeeNote).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "Switch attendee" }));
    await screen.findByRole("heading", { name: "Bea" });

    resolveRequest(
      baseDetail({
        notes: [
          {
            id: "note-1",
            body: "Late arrival expected",
            author_display: "Admin",
            created_at: "2026-06-01T09:00:00.000Z",
          },
        ],
      }),
    );

    await waitFor(() => expect(loadAttendeeDetailData).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("at-toast")).toBeNull();
    await openNotesTab();
    expect(screen.queryByText("Late arrival expected")).toBeNull();
  });

  it("does not show an add failure from a previously selected attendee", async () => {
    mockLoad(baseDetail());
    mockLoad(baseDetail({ id: "att-2", name: "Bea", notes: [] }));
    renderPage({ withRouteChangeControl: true });
    await screen.findByRole("heading", { name: "Anna" });
    await openNotesTab();

    fireEvent.change(screen.getByPlaceholderText("Add a note about this attendee…"), {
      target: { value: "Late arrival expected" },
    });
    let rejectRequest!: (reason: Error) => void;
    addAttendeeNote.mockReturnValueOnce(new Promise((_, reject) => { rejectRequest = reject; }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(addAttendeeNote).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "Switch attendee" }));
    await screen.findByRole("heading", { name: "Bea" });
    rejectRequest(new Error("network"));

    await waitFor(() => expect(loadAttendeeDetailData).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("at-toast")).toBeNull();
  });

  it("does not apply a stale note edit after navigating to another attendee", async () => {
    mockLoad(baseDetail({ notes: [makeNote({ id: "n1", body: "Original" })] }));
    mockLoad(baseDetail({ id: "att-2", name: "Bea", notes: [] }));
    renderPage({ withRouteChangeControl: true });
    await screen.findByRole("heading", { name: "Anna" });
    await openNotesTab();

    fireEvent.click(within(notesList()).getByRole("button", { name: /^Edit note by/ }));
    fireEvent.change(screen.getByDisplayValue("Original"), { target: { value: "Changed" } });
    let resolveRequest!: (value: ReturnType<typeof baseDetail>) => void;
    updateAttendeeNote.mockReturnValueOnce(new Promise((resolve) => { resolveRequest = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateAttendeeNote).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "Switch attendee" }));
    await screen.findByRole("heading", { name: "Bea" });
    resolveRequest(baseDetail({ notes: [makeNote({ id: "n1", body: "Changed" })] }));

    await waitFor(() => expect(loadAttendeeDetailData).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("at-toast")).toBeNull();
  });

  it("does not show an edit failure from a previously selected attendee", async () => {
    mockLoad(baseDetail({ notes: [makeNote({ id: "n1", body: "Original" })] }));
    mockLoad(baseDetail({ id: "att-2", name: "Bea", notes: [] }));
    renderPage({ withRouteChangeControl: true });
    await screen.findByRole("heading", { name: "Anna" });
    await openNotesTab();

    fireEvent.click(within(notesList()).getByRole("button", { name: /^Edit note by/ }));
    let rejectRequest!: (reason: Error) => void;
    updateAttendeeNote.mockReturnValueOnce(new Promise((_, reject) => { rejectRequest = reject; }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateAttendeeNote).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "Switch attendee" }));
    await screen.findByRole("heading", { name: "Bea" });
    rejectRequest(new Error("network"));

    await waitFor(() => expect(loadAttendeeDetailData).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("at-toast")).toBeNull();
  });

  it("closes a pending note-delete dialog when navigating to another attendee", async () => {
    mockLoad(baseDetail({ notes: [makeNote()] }));
    mockLoad(baseDetail({ id: "att-2", name: "Bea", notes: [] }));
    renderPage({ withRouteChangeControl: true });
    await screen.findByRole("heading", { name: "Anna" });
    await openNotesTab();

    fireEvent.click(within(notesList()).getByRole("button", { name: /^Delete note by/ }));
    await screen.findByText("Delete this note?");
    fireEvent.click(screen.getByRole("button", { name: "Switch attendee" }));

    await screen.findByRole("heading", { name: "Bea" });
    expect(screen.queryByText("Delete this note?")).toBeNull();
  });

  it("does not apply a stale note delete after navigating to another attendee", async () => {
    mockLoad(baseDetail({ notes: [makeNote()] }));
    mockLoad(baseDetail({ id: "att-2", name: "Bea", notes: [] }));
    renderPage({ withRouteChangeControl: true });
    await screen.findByRole("heading", { name: "Anna" });
    await openNotesTab();

    fireEvent.click(within(notesList()).getByRole("button", { name: /^Delete note by/ }));
    await screen.findByText("Delete this note?");
    let resolveRequest!: (value: ReturnType<typeof baseDetail>) => void;
    deleteAttendeeNote.mockReturnValueOnce(new Promise((resolve) => { resolveRequest = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteAttendeeNote).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "Switch attendee" }));
    await screen.findByRole("heading", { name: "Bea" });
    resolveRequest(baseDetail({ notes: [] }));

    await waitFor(() => expect(loadAttendeeDetailData).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("at-toast")).toBeNull();
  });

  it("does not show a delete failure from a previously selected attendee", async () => {
    mockLoad(baseDetail({ notes: [makeNote()] }));
    mockLoad(baseDetail({ id: "att-2", name: "Bea", notes: [] }));
    renderPage({ withRouteChangeControl: true });
    await screen.findByRole("heading", { name: "Anna" });
    await openNotesTab();

    fireEvent.click(within(notesList()).getByRole("button", { name: /^Delete note by/ }));
    let rejectRequest!: (reason: Error) => void;
    deleteAttendeeNote.mockReturnValueOnce(new Promise((_, reject) => { rejectRequest = reject; }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteAttendeeNote).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "Switch attendee" }));
    await screen.findByRole("heading", { name: "Bea" });
    rejectRequest(new Error("network"));

    await waitFor(() => expect(loadAttendeeDetailData).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("at-toast")).toBeNull();
  });

  it("disables note mutations for an archived event", async () => {
    outletEvent = { ...outletEvent, archived_at: "2026-06-02T00:00:00.000Z" };
    mockLoad(baseDetail({ notes: [makeNote()] }));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });
    await openNotesTab();

    expect((screen.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("textbox", { name: "New internal note" }) as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /^Edit note by/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete note by/ })).toBeNull();
  });

  it("renders an avatar and a role badge for the note's author", async () => {
    mockLoad(baseDetail({ notes: [makeNote({ author_display: "Ola Nowak", author_role: "admin" })] }));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });
    await openNotesTab();

    expect(screen.getByTitle("Ola Nowak")).toBeTruthy();
    expect(screen.getByText("AD")).toBeTruthy();
  });

  it("shows distinct role badges for superadmin, admin, and operator authors", async () => {
    mockLoad(
      baseDetail({
        notes: [
          makeNote({ id: "n1", author_user_id: "u-super", author_role: "superadmin" }),
          makeNote({ id: "n2", author_user_id: "u-admin2", author_role: "admin" }),
          makeNote({ id: "n3", author_user_id: "u-op1", author_role: "operator" }),
        ],
      }),
    );
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });
    await openNotesTab();

    expect(screen.getByText("SA")).toBeTruthy();
    expect(screen.getByText("AD")).toBeTruthy();
    expect(screen.getByText("OP")).toBeTruthy();
  });

  describe("editing a note", () => {
    it("shows Edit only on the signed-in user's own note", async () => {
      mockLoad(
        baseDetail({
          notes: [
            makeNote({ id: "n1", author_user_id: "user-admin-1" }),
            makeNote({ id: "n2", author_user_id: "user-op", author_role: "operator" }),
          ],
        }),
      );
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });
      await openNotesTab();

      expect(within(notesList()).getAllByRole("button", { name: /^Edit note by/ })).toHaveLength(1);
    });

    it("edits the author's own note, replaces the detail, and toasts success", async () => {
      mockLoad(baseDetail({ notes: [makeNote({ id: "n1", body: "Original body" })] }));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });
      await openNotesTab();

      fireEvent.click(within(notesList()).getByRole("button", { name: /^Edit note by/ }));
      fireEvent.change(screen.getByDisplayValue("Original body"), {
        target: { value: "Updated body" },
      });

      updateAttendeeNote.mockResolvedValueOnce(
        baseDetail({ notes: [makeNote({ id: "n1", body: "Updated body" })] }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => {
        expect(updateAttendeeNote).toHaveBeenCalledWith("evt-1", "att-1", "n1", "Updated body");
      });
      expect(await screen.findByText("Updated body")).toBeTruthy();
      expect(screen.getByTestId("at-toast").textContent).toContain("Note updated");
    });

    it("Cancel discards the draft without calling updateAttendeeNote", async () => {
      mockLoad(baseDetail({ notes: [makeNote({ id: "n1", body: "Original body" })] }));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });
      await openNotesTab();

      fireEvent.click(within(notesList()).getByRole("button", { name: /^Edit note by/ }));
      fireEvent.change(screen.getByDisplayValue("Original body"), { target: { value: "Changed" } });
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.queryByDisplayValue("Changed")).toBeNull();
      expect(screen.getByText("Original body")).toBeTruthy();
      expect(updateAttendeeNote).not.toHaveBeenCalled();
    });

    it("toasts an API error and stays in edit mode on failure", async () => {
      mockLoad(baseDetail({ notes: [makeNote({ id: "n1", body: "Original body" })] }));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });
      await openNotesTab();

      fireEvent.click(within(notesList()).getByRole("button", { name: /^Edit note by/ }));
      fireEvent.change(screen.getByDisplayValue("Original body"), { target: { value: "Changed" } });
      updateAttendeeNote.mockRejectedValueOnce(new Error("boom"));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      expect((await screen.findByTestId("at-toast")).textContent).toContain("Could not update note.");
      expect(screen.getByDisplayValue("Changed")).toBeTruthy();
    });
  });

  describe("deleting a note", () => {
    it("admin sees Delete on their own note and an operator's note, not another admin's", async () => {
      mockLoad(
        baseDetail({
          notes: [
            makeNote({ id: "n1", author_user_id: "user-admin-1", author_role: "admin" }),
            makeNote({ id: "n2", author_user_id: "user-op", author_role: "operator" }),
            makeNote({ id: "n3", author_user_id: "user-admin-2", author_role: "admin" }),
          ],
        }),
      );
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });
      await openNotesTab();

      expect(screen.getAllByRole("button", { name: /^Delete note by/ })).toHaveLength(2);
    });

    it("superadmin sees Delete on every note", async () => {
      assignments = [{ role: "superadmin", scope_type: "instance", scope_id: null }];
      currentUser = { id: "user-super" };
      mockLoad(
        baseDetail({
          notes: [
            makeNote({ id: "n1", author_user_id: "user-admin-1", author_role: "admin" }),
            makeNote({ id: "n2", author_user_id: "user-op", author_role: "operator" }),
            makeNote({ id: "n3", author_user_id: "user-admin-2", author_role: "admin" }),
          ],
        }),
      );
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });
      await openNotesTab();

      expect(screen.getAllByRole("button", { name: /^Delete note by/ })).toHaveLength(3);
    });

    it("deletes a note through the confirm dialog, replaces the detail, and toasts success", async () => {
      mockLoad(baseDetail({ notes: [makeNote({ id: "n1", body: "Remove me" })] }));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });
      await openNotesTab();

      fireEvent.click(screen.getByRole("button", { name: /^Delete note by/ }));
      await screen.findByText("Delete this note?");

      deleteAttendeeNote.mockResolvedValueOnce(baseDetail({ notes: [] }));
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        expect(deleteAttendeeNote).toHaveBeenCalledWith("evt-1", "att-1", "n1");
      });
      await waitFor(() => expect(screen.queryByText("Remove me")).toBeNull());
      expect(screen.getByTestId("at-toast").textContent).toContain("Note deleted");
    });

    it("Cancel closes the dialog without calling deleteAttendeeNote", async () => {
      mockLoad(baseDetail({ notes: [makeNote({ id: "n1" })] }));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });
      await openNotesTab();

      fireEvent.click(screen.getByRole("button", { name: /^Delete note by/ }));
      await screen.findByText("Delete this note?");
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.queryByText("Delete this note?")).toBeNull();
      expect(deleteAttendeeNote).not.toHaveBeenCalled();
    });

    it("keeps the dialog open while a deletion is in progress", async () => {
      mockLoad(baseDetail({ notes: [makeNote({ id: "n1" })] }));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });
      await openNotesTab();

      fireEvent.click(screen.getByRole("button", { name: /^Delete note by/ }));
      let resolveRequest!: (value: ReturnType<typeof baseDetail>) => void;
      deleteAttendeeNote.mockReturnValueOnce(new Promise((resolve) => { resolveRequest = resolve; }));
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
      await waitFor(() => expect(deleteAttendeeNote).toHaveBeenCalledOnce());
      fireEvent.click(document.querySelector(".at-modal-backdrop")!);

      expect(screen.getByText("Delete this note?")).toBeTruthy();
      resolveRequest(baseDetail({ notes: [] }));
      await waitFor(() => expect(screen.queryByText("Delete this note?")).toBeNull());
    });

    it("shows an inline error and keeps the dialog open when delete fails", async () => {
      mockLoad(baseDetail({ notes: [makeNote({ id: "n1" })] }));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });
      await openNotesTab();

      fireEvent.click(screen.getByRole("button", { name: /^Delete note by/ }));
      await screen.findByText("Delete this note?");
      deleteAttendeeNote.mockRejectedValueOnce(new Error("boom"));
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));

      expect((await screen.findByRole("alert")).textContent).toBe("Could not delete note.");
      expect(screen.getByText("Delete this note?")).toBeTruthy();
    });
  });
});
