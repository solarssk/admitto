// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { renderWithToast } from "../test-utils.js";

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

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AttendeeDetailPage profile edit (active event)", () => {
  it("edits every profile field and a custom attribute, then saves the combined patch", async () => {
    mockLoad(baseDetail());
    let resolveSave!: (value: ReturnType<typeof baseDetail>) => void;
    updateAttendee.mockReturnValueOnce(new Promise((resolve) => (resolveSave = resolve)));
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "anna.b@example.com" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Anna B." } });
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Acme Corp" } });
    fireEvent.change(screen.getByLabelText("Department"), { target: { value: "Sales" } });
    fireEvent.change(screen.getByLabelText("Ticket type"), { target: { value: "standard" } });
    fireEvent.change(screen.getByLabelText("Dietary"), { target: { value: "vegetarian" } });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

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
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "taken@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByText("This email is already used by another attendee in this event."),
    ).toBeTruthy();
  });

  it("opens the Resend ticket panel", async () => {
    mockLoad(baseDetail());
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Resend ticket" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/Resend ticket/);
  });

  it("shows a mapped mail_not_configured error in the Resend dialog, without closing it", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockLoad(baseDetail());
    resendTicket.mockRejectedValueOnce(new ApiError(422, "mail_not_configured", "mail_not_configured"));
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Resend ticket" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(
      /Mail transport isn't configured for this event or organization/,
    );
    // Dialog stays open — the operator can fix mail settings and retry without reopening it.
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("changes RSVP status and saves it", async () => {
    mockLoad(baseDetail());
    updateAttendee.mockResolvedValueOnce(baseDetail({ rsvp_status: "declined" }));
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    fireEvent.change(screen.getByRole("combobox", { name: "RSVP status" }), {
      target: { value: "declined" },
    });

    await waitFor(() => {
      expect(updateAttendee).toHaveBeenCalledWith(
        "evt-1",
        "att-1",
        expect.objectContaining({ rsvp_status: "declined" }),
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Status updated/);
    });
  });

  it("surfaces an orphaned ticket_type (not in the current catalog) instead of silently blanking the select", async () => {
    // This attendee's stored ticket_type ("vintage") has no matching entry in the fetched
    // catalog (e.g. the type was deleted after being assigned) — the mocked fetchTicketTypes
    // in this file's module mock only ever returns "vip" and "standard".
    mockLoad(baseDetail({ ticket_type: "vintage" }));
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());
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
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

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
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.getByText("anna@example.com")).toBeTruthy();
    expect(screen.getByText("Acme")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
  });

  it("Cancel with no changes exits edit mode immediately, without a confirm dialog", async () => {
    mockLoad(baseDetail());
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("shows the stale-write warning and Reload control when a save hits a 409 stale_write", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockLoad(baseDetail());
    updateAttendee.mockRejectedValueOnce(new ApiError(409, "stale", "stale_write"));
    // Auto-triggered reload (fired from inside the stale-write catch handler) - left pending so
    // we can observe the intermediate staleWrite=true render before it resolves.
    let resolveReload!: () => void;
    loadAttendeeDetailData.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveReload = () => resolve({ detail: baseDetail(), attributeFields, itemsWarning: null });
      }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Anna B." } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByText("Someone else updated this attendee — reload and reapply your edits."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reload/ })).toBeTruthy();
    resolveReload();
  });

  it("clicking Save with no actual changes exits edit mode without calling the API", async () => {
    mockLoad(baseDetail());
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.queryByLabelText("Email")).toBeNull());
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(updateAttendee).not.toHaveBeenCalled();
  });

  it("the header Back button warns before leaving with unsaved edits, distinct from in-form Cancel", async () => {
    mockLoad(baseDetail());
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Someone Else" } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/Leave without saving\?/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Leave" }));

    // Navigated away to the attendees list — no route in this test matches it, so the
    // attendee heading and page content are gone.
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Anna" })).toBeNull());
  });

  it("Cancel with unsaved changes confirms before discarding, and reverts the field on confirm", async () => {
    mockLoad(baseDetail());
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Someone Else" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/Discard unsaved changes\?/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard" }));

    await waitFor(() => expect(screen.queryByLabelText("Email")).toBeNull());
    // Heading still shows the un-reverted name; the reverted Name *row* (not the discarded
    // "Someone Else") is scoped to the read-only container to avoid matching both.
    expect(document.querySelector(".attendee-detail-readonly")?.textContent).toContain("Anna");
    expect(document.querySelector(".attendee-detail-readonly")?.textContent).not.toContain(
      "Someone Else",
    );
    expect(updateAttendee).not.toHaveBeenCalled();
  });

  it("returns to the read-only view after a successful save", async () => {
    mockLoad(baseDetail());
    updateAttendee.mockResolvedValueOnce(baseDetail({ name: "Anna B." }));
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Anna B." } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.queryByLabelText("Email")).toBeNull());
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("clears a leftover save error once the field is reverted and Cancel is clicked (regression)", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockLoad(baseDetail());
    updateAttendee.mockRejectedValueOnce(new ApiError(500, "boom"));
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Anna B." } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Failed to save changes.")).toBeTruthy();

    // Field reverted back to its saved value -> no longer dirty -> Cancel takes the
    // immediate (no confirm dialog) path, which must still clear the stale error.
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Anna" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByLabelText("Email")).toBeNull());
    expect(screen.queryByText("Failed to save changes.")).toBeNull();
  });

  it("clears a stale email-conflict error after discarding the edit that caused it (regression)", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockLoad(baseDetail());
    updateAttendee.mockRejectedValueOnce(new ApiError(409, "email in use", "email_conflict"));
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "taken@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText("This email is already used by another attendee in this event."),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const dialog = await screen.findByRole("dialog");
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
  it("shows Added on / Added via derived from the oldest loaded action-log entry", async () => {
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
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    expect(screen.getByText("Added on")).toBeTruthy();
    expect(screen.getByText("Added via")).toBeTruthy();
    expect(screen.getByText("CSV/XLSX import")).toBeTruthy();
  });

  it("omits Added via when the action log doesn't include a creation entry", async () => {
    mockLoad(baseDetail({ action_log: [] }));
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    expect(screen.getByText("Added on")).toBeTruthy();
    expect(screen.queryByText("Added via")).toBeNull();
  });

  it("shows an Additional information card for custom_data keys with no configured attribute field", async () => {
    mockLoad(baseDetail({ custom_data: { dietary: "vegan", shirt_size: "L" } }));
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    expect(screen.getByText("Additional information")).toBeTruthy();
    expect(screen.getByText("Shirt size")).toBeTruthy();
    expect(screen.getByText("L")).toBeTruthy();
  });

  it("hides the Additional information card when every custom_data key is already a configured field", async () => {
    mockLoad(baseDetail({ custom_data: { dietary: "vegan" } }));
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    expect(screen.queryByText("Additional information")).toBeNull();
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
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    expect(screen.getByText("Mail delivery history")).toBeTruthy();
    expect(screen.getByText("Your ticket")).toBeTruthy();
    expect(screen.queryByText("No delivery attempts yet.")).toBeNull();
  });

  it("shows an empty state in the Mail delivery history card when nothing was ever sent", async () => {
    mockLoad(baseDetail({ deliveries: [] }));
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Anna" })).toBeTruthy());

    expect(screen.getByText("Mail delivery history")).toBeTruthy();
    expect(screen.getByText("No delivery attempts yet.")).toBeTruthy();
  });
});
