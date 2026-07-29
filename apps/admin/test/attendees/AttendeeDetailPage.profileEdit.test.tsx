// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { mockMatchMedia, renderWithToast } from "../test-utils.js";

const loadAttendeeDetailData = vi.fn();

vi.mock("../../src/attendees/attendeeDetailForm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/attendees/attendeeDetailForm.js")>();
  return {
    ...actual,
    loadAttendeeDetailData: (...args: unknown[]) => loadAttendeeDetailData(...args),
  };
});

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: [{ role: "admin", scope_type: "organization", scope_id: "org-1" }] }),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useOutletContext: () => ({
      event: {
        id: "evt-1",
        title: "Demo",
        slug: "demo",
        date: "2026-06-01",
        timezone: "Europe/Warsaw",
        location: null,
        attendee_count: 1,
        archived_at: null,
      },
    }),
  };
});

const updateAttendee = vi.fn();
const resendTicket = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    updateAttendee: (...args: unknown[]) => updateAttendee(...args),
    resendTicket: (...args: unknown[]) => resendTicket(...args),
    fetchAttendeeDetail: vi.fn(),
    revokeAttendeeCheckIn: vi.fn(),
    fetchTicketTypes: vi.fn().mockResolvedValue([
      { id: "tt-1", key: "vip", label: "VIP", color: "purple", sort_order: 0, attendee_count: 1, created_at: "2026-01-01T00:00:00.000Z" },
      { id: "tt-2", key: "standard", label: "Standard", color: "gray", sort_order: 1, attendee_count: 0, created_at: "2026-01-01T00:00:00.000Z" },
    ]),
  };
});

function baseDetail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "att-1",
    name: "Anna",
    email: "anna@example.com",
    company: "Acme",
    department: "Eng",
    ticket_type: "vip",
    custom_data: { dietary: "vegan" },
    status: "registered" as const,
    admitted_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    check_in_status: "not_admitted" as const,
    last_mail_status: null,
    rsvp_status: "confirmed" as const,
    rsvp_updated_at: null,
    rsvp_source: null,
    ticket_ref: null,
    deliveries: [],
    action_log: [],
    event_items: [],
    ...overrides,
  };
}

const attributeFields = [{ label: "Dietary", source_field: "dietary", type: "text" as const }];

function mockLoad(detail: ReturnType<typeof baseDetail>) {
  loadAttendeeDetailData.mockResolvedValueOnce({ detail, attributeFields, itemsWarning: null });
}

function renderPage() {
  renderWithToast(
    <MemoryRouter initialEntries={["/admin/events/evt-1/attendees/att-1"]}>
      <Routes>
        <Route path="/admin/events/:eventId/attendees/:attendeeId" element={<AttendeeDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("AttendeeDetailPage profile edit (active event)", () => {
  it("edits every profile field and a custom attribute, then saves the combined patch", async () => {
    mockLoad(baseDetail());
    let resolveSave!: (value: ReturnType<typeof baseDetail>) => void;
    updateAttendee.mockReturnValueOnce(new Promise((resolve) => (resolveSave = resolve)));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "anna.b@example.com" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Anna B." } });
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Acme Corp" } });
    fireEvent.change(screen.getByLabelText("Department"), { target: { value: "Sales" } });
    fireEvent.change(screen.getByLabelText("Ticket type"), { target: { value: "standard" } });
    fireEvent.change(screen.getByLabelText("Dietary"), { target: { value: "vegetarian" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // While the save is in flight, every profile field (including custom
    // attributes) stays disabled — not just the Save button.
    await waitFor(() => {
      expect((screen.getByLabelText("Dietary") as HTMLInputElement).disabled).toBe(true);
    });
    resolveSave(baseDetail({ name: "Anna B." }));

    await waitFor(() => {
      expect(updateAttendee).toHaveBeenCalledWith(
        "evt-1",
        "att-1",
        expect.objectContaining({
          email: "anna.b@example.com",
          name: "Anna B.",
          company: "Acme Corp",
          department: "Sales",
          ticket_type: "standard",
          custom_data_fields: { dietary: "vegetarian" },
        }),
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Profile saved/);
    });
    // Save exits edit mode back to the read-only view (#361).
    expect(screen.queryByLabelText("Dietary")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("shows the email-conflict inline error instead of a toast, without saving", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockLoad(baseDetail());
    updateAttendee.mockRejectedValueOnce(new ApiError(409, "email in use", "email_conflict"));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "taken@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("This email is already used by another attendee in this event."),
    ).toBeTruthy();
  });

  it("shows a generic inline error for an unmapped 409 profile-save conflict", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockLoad(baseDetail());
    updateAttendee.mockRejectedValueOnce(new ApiError(409, "unexpected_conflict", "unexpected_conflict"));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Anna B." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Could not save changes.")).toBeTruthy();
  });

  it.each([
    ["unknown_custom_data_field", "Event configuration changed. Reload this page to edit attributes."],
    ["required_custom_data_field_missing", "Could not save attribute fields. Check required values and options."],
  ])("explains the %s custom-data validation response inline", async (code, message) => {
    const { ApiError } = await import("../../src/api/client.js");
    mockLoad(baseDetail());
    updateAttendee.mockRejectedValueOnce(new ApiError(400, code, code));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Dietary"), { target: { value: "vegetarian" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(message)).toBeTruthy();
  });

  it("opens the Resend ticket panel", async () => {
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Resend ticket/ }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/Resend ticket/);
  });

  it("shows a mapped mail_not_configured error in the Resend dialog, without closing it", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockLoad(baseDetail());
    resendTicket.mockRejectedValueOnce(new ApiError(422, "mail_not_configured", "mail_not_configured"));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Resend ticket/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(
      /Mail transport isn't configured for this event or organization/,
    );
    // Dialog stays open — the operator can fix mail settings and retry without reopening it.
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("changes attendance status and saves it along with the rest of the form", async () => {
    mockLoad(baseDetail());
    updateAttendee.mockResolvedValueOnce(baseDetail({ rsvp_status: "declined" }));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    // The RSVP control lives inside the Edit modal, as a normal field - it no longer
    // saves itself immediately on change; it's part of the same patch as everything
    // else and only goes out when Save changes is clicked.
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Attendance" }), {
      target: { value: "declined" },
    });
    expect(updateAttendee).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateAttendee).toHaveBeenCalledWith(
        "evt-1",
        "att-1",
        expect.objectContaining({ rsvp_status: "declined" }),
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Profile saved/);
    });
  });

  it("surfaces an orphaned ticket_type (not in the current catalog) instead of silently blanking the select", async () => {
    // This attendee's stored ticket_type ("vintage") has no matching entry in the fetched
    // catalog (e.g. the type was deleted after being assigned) — the mocked fetchTicketTypes
    // in this file's module mock only ever returns "vip" and "standard".
    mockLoad(baseDetail({ ticket_type: "vintage" }));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });
    // Read-only view renders the orphaned value via TicketTypeBadge's own fail-open fallback.
    expect(screen.getByText("vintage")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const select = (await screen.findByLabelText("Ticket type")) as HTMLSelectElement;
    await waitFor(() => {
      expect(select.value).toBe("vintage");
    });
    expect(screen.getByText("vintage (not in catalog)")).toBeTruthy();

    // Reassigning to a real catalog entry still works and submits normally.
    updateAttendee.mockResolvedValueOnce(baseDetail({ ticket_type: "standard" }));
    fireEvent.change(select, { target: { value: "standard" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateAttendee).toHaveBeenCalledWith(
        "evt-1",
        "att-1",
        expect.objectContaining({ ticket_type: "standard" }),
      );
    });
  });
});

describe("AttendeeDetailPage read-only view + explicit Edit mode (#361)", () => {
  it("renders the profile as read-only text by default, with no Save button until Edit is clicked", async () => {
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByText("anna@example.com")).toBeTruthy();
    expect(screen.getByText("Acme")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("Cancel with no changes exits edit mode immediately, without a confirm dialog", async () => {
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("Back with no unsaved changes navigates away immediately, without a confirm dialog", async () => {
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Anna" })).toBeNull());
  });

  it("shows the stale-write warning and Reload control when a save hits a 409 stale_write", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockLoad(baseDetail());
    updateAttendee.mockRejectedValueOnce(new ApiError(409, "stale", "stale_write"));
    // Auto-triggered reload (fired from inside the stale-write catch handler) fails too, so
    // `reloading` settles back to false while `staleWrite` stays true - the only state in which
    // the Reload button is actually enabled and clickable, not just rendered-but-disabled.
    loadAttendeeDetailData.mockRejectedValueOnce(new Error("network hiccup"));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Anna B." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Someone else updated this attendee. Reload and reapply your edits."),
    ).toBeTruthy();
    const reloadButton = (await screen.findByRole("button", { name: "Reload" })) as HTMLButtonElement;
    expect(reloadButton.disabled).toBe(false);

    loadAttendeeDetailData.mockResolvedValueOnce({ detail: baseDetail(), attributeFields, itemsWarning: null });
    fireEvent.click(reloadButton);

    await waitFor(() =>
      expect(
        screen.queryByText("Someone else updated this attendee. Reload and reapply your edits."),
      ).toBeNull(),
    );
  });

  it("clicking Save with no actual changes exits edit mode without calling the API", async () => {
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByLabelText("Email")).toBeNull());
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(updateAttendee).not.toHaveBeenCalled();
  });

  it("the header Back button warns before leaving with unsaved edits, distinct from in-form Cancel", async () => {
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Someone Else" } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    // Two dialogs are open at once here - the Edit modal underneath, and this confirm on top -
    // so the query must be scoped by accessible name, not just role.
    const dialog = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    expect(dialog.textContent).toMatch(/Leave without saving\?/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Leave" }));

    // Navigated away to the attendees list — no route in this test matches it, so the
    // attendee heading and page content are gone.
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Anna" })).toBeNull());
  });

  it("Cancel with unsaved changes confirms before discarding, and reverts the field on confirm", async () => {
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Someone Else Inc" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    const dialog = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    expect(dialog.textContent).toMatch(/Discard unsaved changes\?/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard" }));

    await waitFor(() => expect(screen.queryByLabelText("Email")).toBeNull());
    // The reverted Company *row* (not the discarded "Someone Else Inc") is scoped to the
    // read-only container to avoid matching a stray element elsewhere on the page.
    expect(document.querySelector(".attendee-detail-readonly")?.textContent).toContain("Acme");
    expect(document.querySelector(".attendee-detail-readonly")?.textContent).not.toContain(
      "Someone Else Inc",
    );
    expect(updateAttendee).not.toHaveBeenCalled();
  });

  it("returns to the read-only view after a successful save", async () => {
    mockLoad(baseDetail());
    updateAttendee.mockResolvedValueOnce(baseDetail({ name: "Anna B." }));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Anna B." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByLabelText("Email")).toBeNull());
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("clears a leftover save error once the field is reverted and Cancel is clicked (regression)", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockLoad(baseDetail());
    updateAttendee.mockRejectedValueOnce(new ApiError(500, "boom"));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Anna B." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Failed to save changes.")).toBeTruthy();

    // Field reverted back to its saved value -> no longer dirty -> Cancel takes the
    // immediate (no confirm dialog) path, which must still clear the stale error.
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Anna" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByLabelText("Email")).toBeNull());
    expect(screen.queryByText("Failed to save changes.")).toBeNull();
  });

  it("clears a leftover save error when Save changes is clicked on a since-reverted (no-op) form (regression, bot review)", async () => {
    // Distinct from the Cancel-button regression above: this goes through handleSave's own
    // "nothing actually changed" early return, a separate code path that used to leave a
    // stale error/emailConflict behind since it only called setEditMode(false).
    const { ApiError } = await import("../../src/api/client.js");
    mockLoad(baseDetail());
    updateAttendee.mockRejectedValueOnce(new ApiError(500, "boom"));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Anna B." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Failed to save changes.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Anna" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByLabelText("Email")).toBeNull());
    expect(screen.queryByText("Failed to save changes.")).toBeNull();
  });

  it("shows a generic save error inside the Edit modal itself, not hidden behind it (bot review)", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockLoad(baseDetail());
    updateAttendee.mockRejectedValueOnce(new ApiError(500, "boom"));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Anna B." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Failed to save changes.")).toBeTruthy();
    // Exactly one copy in the DOM - not also duplicated behind the modal, which would make
    // this and any other error-text query ambiguous (multiple matches).
    expect(screen.getAllByText("Failed to save changes.")).toHaveLength(1);
  });

  it("clears a stale email-conflict error after discarding the edit that caused it (regression)", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockLoad(baseDetail());
    updateAttendee.mockRejectedValueOnce(new ApiError(409, "email in use", "email_conflict"));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "taken@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("This email is already used by another attendee in this event."),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const dialog = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.queryByLabelText("Email")).toBeNull());

    // Re-entering edit mode must not resurrect the conflict from the abandoned attempt.
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      screen.queryByText("This email is already used by another attendee in this event."),
    ).toBeNull();
  });
});

describe("AttendeeDetailPage extended guest information (#365)", () => {
  it("shows Registered on / Added via derived from the oldest loaded action-log entry", async () => {
    mockLoad(
      baseDetail({
        created_at: "2026-01-05T09:30:00.000Z",
        action_log: [
          {
            id: "log-2",
            action_type: "rsvp_status_changed",
            actor_display: "Anna",
            metadata: { from: "none", to: "confirmed" },
            created_at: "2026-01-06T10:00:00.000Z",
          },
          {
            id: "log-1",
            action_type: "attendees_imported",
            actor_display: null,
            metadata: null,
            created_at: "2026-01-05T09:30:00.000Z",
          },
        ],
      }),
    );
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    expect(screen.getByText("Registered on")).toBeTruthy();
    expect(screen.getByText("Added via")).toBeTruthy();
    expect(screen.getByText("CSV/XLSX import")).toBeTruthy();
  });

  it("omits Added via when the action log doesn't include a creation entry", async () => {
    mockLoad(baseDetail({ action_log: [] }));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    expect(screen.getByText("Registered on")).toBeTruthy();
    expect(screen.queryByText("Added via")).toBeNull();
  });

  it("shows an Additional information card for custom_data keys with no configured attribute field", async () => {
    mockLoad(baseDetail({ custom_data: { dietary: "vegan", shirt_size: "L" } }));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    expect(screen.getByText("Additional information")).toBeTruthy();
    expect(screen.getByText("Shirt size")).toBeTruthy();
    expect(screen.getByText("L")).toBeTruthy();
  });

  it("shows a configured attribute field in Additional information, not inline in Profile", async () => {
    // Matches the design mockup: the Profile card stays to its fixed core fields; every
    // custom_data entry - configured or not - lives in Additional information instead.
    mockLoad(baseDetail({ custom_data: { dietary: "vegan" } }));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    expect(screen.getByText("Additional information")).toBeTruthy();
    expect(screen.getByText("Dietary")).toBeTruthy();
    expect(screen.getByText("vegan")).toBeTruthy();
  });

  it("shows an empty-state placeholder in Additional information when custom_data is empty", async () => {
    mockLoad(baseDetail({ custom_data: {} }));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    expect(screen.getByText("Additional information")).toBeTruthy();
    expect(screen.getByText("No additional information")).toBeTruthy();
  });

  it("shows a Wallet card with an empty-state placeholder below Additional information (PO review)", async () => {
    // No wallet-pass integration exists yet - this is a static placeholder, not a real empty
    // state. Deliberately titled "Wallet", not "Wallet pass", so it doesn't read as the same
    // thing as the app's own QR admission pass (Revoke menu's "Pass", the Pass chip).
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    // "Wallet" also appears as the status-strip chip's own label - scope to the card title.
    expect(screen.getAllByText("Wallet")).toHaveLength(2);
    expect(screen.getByText("Not added to a wallet")).toBeTruthy();
  });

  it("shows an empty-state placeholder in Event-day items when the event has no configured items", async () => {
    mockLoad(baseDetail({ event_items: [] }));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    expect(screen.getByText("Event-day items")).toBeTruthy();
    expect(screen.getByText("No event-day items")).toBeTruthy();
  });

  it("lists event-day items with their hand-out state, without a content_fields detail (PO review)", async () => {
    mockLoad(
      baseDetail({
        event_items: [
          { key: "gift_bag", label: "Gift bag", icon: "gift", state: "issued" },
          { key: "badge", label: "Name badge", icon: "id-badge-2", state: "issued" },
          { key: "headset", label: "Headset", icon: "headphones", state: "pending" },
        ],
      }),
    );
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    expect(screen.getByText("Gift bag")).toBeTruthy();
    // Scoped to the items list — the Check-in status-strip chip can also read "Not yet".
    const itemsList = document.querySelector(".attendee-items-list") as HTMLElement;
    expect(within(itemsList).getAllByText("Issued")).toHaveLength(2);
    expect(within(itemsList).getByText("Not yet")).toBeTruthy();
  });

  it("lists mail delivery history when deliveries exist", async () => {
    mockLoad(
      baseDetail({
        deliveries: [
          {
            id: "del-1",
            purpose: "initial",
            status: "sent",
            recipient_email: "anna@example.com",
            rendered_subject: "Your ticket",
            queued_at: "2026-01-05T09:31:00.000Z",
            accepted_at: "2026-01-05T09:31:05.000Z",
            sent_at: "2026-01-05T09:31:05.000Z",
            failed_at: null,
            error_code: null,
          },
        ],
      }),
    );
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    expect(screen.getByText("Mail delivery history")).toBeTruthy();
    expect(screen.getByText("Your ticket")).toBeTruthy();
    expect(screen.queryByText("No delivery attempts yet")).toBeNull();
  });

  it("shows an icon+text empty-state placeholder in Mail delivery history when nothing was ever sent", async () => {
    mockLoad(baseDetail({ deliveries: [] }));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    expect(screen.getByText("Mail delivery history")).toBeTruthy();
    expect(screen.getByText("No delivery attempts yet")).toBeTruthy();
  });
});
