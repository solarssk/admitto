// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { getTooltipText, mockMatchMedia, renderWithToast } from "../test-utils.js";

const loadAttendeeDetailData = vi.fn();
const revokeAttendeeCheckIn = vi.fn();
const bulkRevokeItems = vi.fn();

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

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    updateAttendee: vi.fn(),
    resendTicket: vi.fn(),
    fetchAttendeeDetail: vi.fn(),
    revokeAttendeeCheckIn: (...args: unknown[]) => revokeAttendeeCheckIn(...args),
    bulkRevokeItems: (...args: unknown[]) => bulkRevokeItems(...args),
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
    admitted_at: "2026-06-01T09:44:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    check_in_status: "admitted" as const,
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

function mockLoad(detail: ReturnType<typeof baseDetail>) {
  loadAttendeeDetailData.mockResolvedValueOnce({ detail, attributeFields: [], itemsWarning: null });
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

beforeEach(() => {
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/** Revoke pass/check-in live only inside "More actions" now, on every viewport (the standalone
 * desktop "Revoke" dropdown was folded in there too) - matches accessible names with a regex
 * since each item also carries a hint line (e.g. "Revoke check-in Undo this attendee's
 * check-in"), same convention as the Attendees list's bulk menu tests. */
function openMoreActionsMenu() {
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  return screen.getByRole("menu");
}

describe("AttendeeDetailPage — Revoke check-in", () => {
  it("moves Edit into More actions on mobile and opens the profile editor", async () => {
    mockMatchMedia(false);
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(within(openMoreActionsMenu()).getByRole("menuitem", { name: /^Edit/ }));

    expect(screen.queryByRole("menu")).toBeNull();
    expect(await screen.findByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("keeps Revoke check-in visible but disabled with a tooltip when not admitted", async () => {
    mockLoad(baseDetail({ check_in_status: "not_admitted", admitted_at: null }));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });
    const menu = openMoreActionsMenu();
    const item = within(menu).getByRole("menuitem", { name: /Revoke check-in/ });
    expect((item as HTMLButtonElement).disabled).toBe(true);
    expect(getTooltipText(item)).toBe("This attendee isn't checked in.");
    expect(within(menu).getByRole("menuitem", { name: /Revoke pass/ })).toBeTruthy();
  });

  it("Revoke pass menu item opens the pass confirm dialog and closes the menu", async () => {
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    const menu = openMoreActionsMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Revoke pass/ }));

    expect(screen.queryByRole("menu")).toBeNull();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Revoke pass?")).toBeTruthy();
  });

  it("clicking outside the open menu closes it without triggering an action", async () => {
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    openMoreActionsMenu();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows Revoke check-in disabled with a pass-revoked tooltip, and Restore pass as a menu item, once the pass itself has been revoked, even with a stale admitted_at (PO review)", async () => {
    mockLoad(baseDetail({ status: "revoked" }));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });
    const menu = openMoreActionsMenu();
    const checkInItem = within(menu).getByRole("menuitem", { name: /Revoke check-in/ });
    expect((checkInItem as HTMLButtonElement).disabled).toBe(true);
    expect(getTooltipText(checkInItem)).toBe("This attendee's pass is revoked.");
    expect(within(menu).queryByRole("menuitem", { name: /^Revoke pass/ })).toBeNull();
    expect(within(menu).getByRole("menuitem", { name: /Restore pass/ })).toBeTruthy();
  });

  it("confirms, revokes, and reloads the detail", async () => {
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    revokeAttendeeCheckIn.mockResolvedValue({ card: { check_in_status: "not_admitted" } });
    mockLoad(baseDetail({ check_in_status: "not_admitted", admitted_at: null }));

    const menu = openMoreActionsMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Revoke check-in/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Revoke check-in?")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
    await waitFor(() => {
      expect(revokeAttendeeCheckIn).toHaveBeenCalledWith("evt-1", "att-1");
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    // Reloaded detail keeps the action visible, now disabled with a tooltip instead of hidden.
    const reopenedMenu = openMoreActionsMenu();
    const item = within(reopenedMenu).getByRole("menuitem", { name: /Revoke check-in/ });
    expect((item as HTMLButtonElement).disabled).toBe(true);
    expect(getTooltipText(item)).toBe("This attendee isn't checked in.");
  });

  it("shows an inline error on failure and keeps the action available", async () => {
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    revokeAttendeeCheckIn.mockRejectedValue(new Error("boom"));

    const menu = openMoreActionsMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Revoke check-in/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(within(dialog).getByText("Could not revoke check-in.")).toBeTruthy();
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("disables Revoke items with a useful tooltip when the event has no configured items", async () => {
    mockLoad(baseDetail());
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    const item = within(openMoreActionsMenu()).getByRole("menuitem", { name: /Revoke items/ });
    expect((item as HTMLButtonElement).disabled).toBe(true);
    expect(getTooltipText(item)).toBe("No items configured for this event. Add some in Requirements.");
  });

  it.each(["cancelled", "revoked"] as const)(
    "disables Revoke items when a %s pass still has an issued item",
    async (status) => {
      mockLoad(baseDetail({ status, event_items: [{ key: "badge", label: "Badge", state: "issued" }] }));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      const item = within(openMoreActionsMenu()).getByRole("menuitem", { name: /Revoke items/ });
      expect((item as HTMLButtonElement).disabled).toBe(true);
      expect(getTooltipText(item)).toBe("Nothing issued to revoke for this attendee.");
    },
  );

  it("confirms Revoke items, scopes it to the attendee, reloads, and reports a singular success", async () => {
    mockLoad(baseDetail({ event_items: [{ key: "badge", label: "Badge", state: "issued" }] }));
    mockLoad(baseDetail({ event_items: [{ key: "badge", label: "Badge", state: "pending" }] }));
    bulkRevokeItems.mockResolvedValue({ revokedCount: 1 });
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(within(openMoreActionsMenu()).getByRole("menuitem", { name: /Revoke items/ }));
    const dialog = screen.getByRole("dialog", { name: "Revoke items?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(bulkRevokeItems).toHaveBeenCalledWith("evt-1", ["att-1"]);
      expect(screen.getByTestId("at-toast").textContent).toContain("1 item revoked.");
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([
    [0, "No issued items to revoke."],
    [2, "2 items revoked."],
  ])("reports the correct Revoke items outcome for %i revoked items", async (revokedCount, message) => {
    mockLoad(baseDetail({ event_items: [{ key: "badge", label: "Badge", state: "issued" }] }));
    mockLoad(baseDetail({ event_items: [{ key: "badge", label: "Badge", state: "pending" }] }));
    bulkRevokeItems.mockResolvedValue({ revokedCount });
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(within(openMoreActionsMenu()).getByRole("menuitem", { name: /Revoke items/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Revoke items?" })).getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(screen.getByTestId("at-toast").textContent).toContain(message));
  });

  it("accepts a returned item and keeps a revoke-items failure in its confirmation dialog", async () => {
    mockLoad(baseDetail({ event_items: [{ key: "badge", label: "Badge", state: "returned" }] }));
    bulkRevokeItems.mockRejectedValue(new Error("boom"));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(within(openMoreActionsMenu()).getByRole("menuitem", { name: /Revoke items/ }));
    const dialog = screen.getByRole("dialog", { name: "Revoke items?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    expect(await within(dialog).findByText("Could not revoke items.")).toBeTruthy();
  });

  it("closes the Revoke items dialog without making a request when cancelled", async () => {
    mockLoad(baseDetail({ event_items: [{ key: "badge", label: "Badge", state: "issued" }] }));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(within(openMoreActionsMenu()).getByRole("menuitem", { name: /Revoke items/ }));
    const dialog = screen.getByRole("dialog", { name: "Revoke items?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(bulkRevokeItems).not.toHaveBeenCalled();
  });

  it.each(["success", "failure"] as const)(
    "does not apply a stale Revoke items %s after navigating to another attendee",
    async (outcome) => {
      mockLoad(baseDetail({ event_items: [{ key: "badge", label: "Badge", state: "issued" }] }));
      mockLoad(baseDetail({ id: "att-2", name: "Bea", event_items: [] }));
      let settle!: () => void;
      const pending = new Promise<{ revokedCount: number }>((resolve, reject) => {
        settle = () => {
          if (outcome === "success") resolve({ revokedCount: 1 });
          else reject(new Error("request failed"));
        };
      });
      bulkRevokeItems.mockReturnValueOnce(pending);
      renderPage({ withRouteChangeControl: true });
      await screen.findByRole("heading", { name: "Anna" });

      fireEvent.click(within(openMoreActionsMenu()).getByRole("menuitem", { name: /Revoke items/ }));
      fireEvent.click(within(screen.getByRole("dialog", { name: "Revoke items?" })).getByRole("button", { name: "Revoke" }));
      await waitFor(() => expect(bulkRevokeItems).toHaveBeenCalled());

      fireEvent.click(screen.getByRole("button", { name: "Switch attendee" }));
      await screen.findByRole("heading", { name: "Bea" });
      expect(screen.queryByRole("dialog")).toBeNull();
      settle();

      await waitFor(() => expect(loadAttendeeDetailData).toHaveBeenCalledTimes(2));
      expect(screen.queryByText("Could not revoke items.")).toBeNull();
      expect(screen.queryByText("1 item revoked.")).toBeNull();
    },
  );

  it("keeps the Revoke items dialog open when its backdrop is clicked during the request", async () => {
    mockLoad(baseDetail({ event_items: [{ key: "badge", label: "Badge", state: "issued" }] }));
    let rejectRequest!: (reason?: unknown) => void;
    bulkRevokeItems.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectRequest = reject;
      }),
    );
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(within(openMoreActionsMenu()).getByRole("menuitem", { name: /Revoke items/ }));
    const dialog = screen.getByRole("dialog", { name: "Revoke items?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(bulkRevokeItems).toHaveBeenCalledOnce());

    fireEvent.click(document.querySelector(".confirm-dialog__backdrop")!);
    expect(screen.getByRole("dialog", { name: "Revoke items?" })).toBeTruthy();

    rejectRequest(new Error("request failed"));
    await within(dialog).findByText("Could not revoke items.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
