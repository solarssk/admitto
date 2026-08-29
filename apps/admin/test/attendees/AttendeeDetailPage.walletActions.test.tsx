// @vitest-environment jsdom
// This import must come first, before every other import in the file - see
// attendeeDetailPageMocks.ts's own doc comment for why.
import { mockAttendeeDetailForm, mockAuthProvider, mockOutletEvent } from "./attendeeDetailPageMocks.js";
import { baseAttendeeDetailEvent, getTooltipText, mockMatchMedia, renderWithToast } from "../test-utils.js";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { AttendeeDetailPage } from "../../src/pages/AttendeeDetailPage.js";
import { ARCHIVED_ACTION_TOOLTIP } from "../../src/components/ArchivedGuard.js";

const loadAttendeeDetailData = vi.fn();
const voidWalletPass = vi.fn();
const restoreWalletPass = vi.fn();
const reissueWalletPass = vi.fn();
const refreshWalletPassStatus = vi.fn();
const deleteWalletPass = vi.fn();

vi.mock("../../src/attendees/attendeeDetailForm.js", (importOriginal) =>
  mockAttendeeDetailForm(importOriginal, () => loadAttendeeDetailData),
);

vi.mock("../../src/auth/AuthProvider.js", () => mockAuthProvider());

let mockArchivedAt: string | null = null;
let mockWalletEnabled = true;
let mockWalletAppleEnabled = true;
let mockWalletGoogleEnabled = true;
let mockWalletSamsungEnabled = true;

vi.mock("react-router", (importOriginal) =>
  mockOutletEvent(importOriginal, () => ({
    ...baseAttendeeDetailEvent,
    wallet_enabled: mockWalletEnabled,
    wallet_apple_enabled: mockWalletAppleEnabled,
    wallet_google_enabled: mockWalletGoogleEnabled,
    wallet_samsung_enabled: mockWalletSamsungEnabled,
    archived_at: mockArchivedAt,
  })),
);

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    resendTicket: vi.fn(),
    fetchAttendeeDetail: vi.fn(),
    revokeAttendeeCheckIn: vi.fn(),
    voidWalletPass: (...args: unknown[]) => voidWalletPass(...args),
    restoreWalletPass: (...args: unknown[]) => restoreWalletPass(...args),
    reissueWalletPass: (...args: unknown[]) => reissueWalletPass(...args),
    refreshWalletPassStatus: (...args: unknown[]) => refreshWalletPassStatus(...args),
    deleteWalletPass: (...args: unknown[]) => deleteWalletPass(...args),
  };
});

function walletPass(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    status: "active" as const,
    issued_at: "2026-01-01T00:00:00.000Z",
    voided_at: null,
    apple_url: "https://example.com/apple",
    android_url: "https://example.com/android",
    last_synced_at: null,
    last_error_code: null,
    apple_active_registrations: null,
    apple_inactive_registrations: null,
    google_active_registrations: null,
    google_inactive_registrations: null,
    first_downloaded_at: null,
    registration_checked_at: null,
    ...overrides,
  };
}

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
    wallet_pass: null,
    ...overrides,
  };
}

function mockLoad(detail: ReturnType<typeof baseDetail>) {
  loadAttendeeDetailData.mockResolvedValueOnce({ detail, attributeFields: [], itemsWarning: null });
}

function RouteChangeControl() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate("/admin/events/evt-1/attendees/att-2")}>
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

function openMoreActionsMenu() {
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
}

beforeEach(() => {
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockArchivedAt = null;
  mockWalletEnabled = true;
  mockWalletAppleEnabled = true;
  mockWalletGoogleEnabled = true;
  mockWalletSamsungEnabled = true;
  vi.unstubAllGlobals();
});

describe("AttendeeDetailPage — Wallet pass actions (Void / Restore / Push updates / Delete)", () => {
  describe("More actions menu render gate", () => {
    it("shows no wallet actions when the attendee has no wallet pass", async () => {
      mockLoad(baseDetail({ wallet_pass: null }));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      openMoreActionsMenu();
      expect(screen.queryByRole("menuitem", { name: /Void wallet pass/ })).toBeNull();
      expect(screen.queryByRole("menuitem", { name: /Restore wallet pass/ })).toBeNull();
      expect(screen.queryByRole("menuitem", { name: /Push updates/ })).toBeNull();
      expect(screen.queryByRole("menuitem", { name: /Delete wallet pass/ })).toBeNull();
    });

    it("shows Void wallet pass and Push updates (not Restore) for an active pass", async () => {
      mockLoad(baseDetail({ wallet_pass: walletPass({ status: "active" }) }));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      openMoreActionsMenu();
      expect(screen.getByRole("menuitem", { name: /Void wallet pass/ })).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: /Push updates/ })).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: /Delete wallet pass/ })).toBeTruthy();
      expect(screen.queryByRole("menuitem", { name: /Restore wallet pass/ })).toBeNull();
    });

    it("shows Restore wallet pass and Push updates (not Void) for a voided pass", async () => {
      mockLoad(baseDetail({ wallet_pass: walletPass({ status: "voided" }) }));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      openMoreActionsMenu();
      expect(screen.getByRole("menuitem", { name: /Restore wallet pass/ })).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: /Push updates/ })).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: /Delete wallet pass/ })).toBeTruthy();
      expect(screen.queryByRole("menuitem", { name: /Void wallet pass/ })).toBeNull();
    });

    it("hides every wallet lifecycle action, even for an active pass, once the event's Wallet feature is disabled", async () => {
      mockWalletEnabled = false;
      mockLoad(baseDetail({ wallet_pass: walletPass({ status: "active" }) }));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      openMoreActionsMenu();
      expect(screen.queryByRole("menuitem", { name: /Void wallet pass/ })).toBeNull();
      expect(screen.queryByRole("menuitem", { name: /Restore wallet pass/ })).toBeNull();
      expect(screen.queryByRole("menuitem", { name: /Push updates/ })).toBeNull();
      expect(screen.queryByRole("menuitem", { name: /Refresh status/ })).toBeNull();
      expect(screen.queryByRole("menuitem", { name: /Delete wallet pass/ })).toBeNull();
    });
  });

  describe("Void wallet pass", () => {
    it("confirms, calls voidWalletPass, reloads detail, and closes the dialog", async () => {
      mockLoad(baseDetail({ wallet_pass: walletPass({ status: "active" }) }));
      mockLoad(baseDetail({ wallet_pass: walletPass({ status: "voided" }) }));
      voidWalletPass.mockResolvedValueOnce(walletPass({ status: "voided" }));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      openMoreActionsMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: /Void wallet pass/ }));
      const dialog = screen.getByRole("dialog", { name: "Void wallet pass?" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Void" }));

      await waitFor(() => {
        expect(voidWalletPass).toHaveBeenCalledWith("evt-1", "att-1");
        expect(screen.queryByRole("dialog")).toBeNull();
      });

      openMoreActionsMenu();
      expect(screen.getByRole("menuitem", { name: /Restore wallet pass/ })).toBeTruthy();
    });

    it("shows an inline error and keeps the dialog open when voidWalletPass fails", async () => {
      mockLoad(baseDetail({ wallet_pass: walletPass({ status: "active" }) }));
      const { ApiError } = await import("../../src/api/client.js");
      voidWalletPass.mockRejectedValueOnce(new ApiError(500, "server_error", "server_error"));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      openMoreActionsMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: /Void wallet pass/ }));
      const dialog = screen.getByRole("dialog", { name: "Void wallet pass?" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Void" }));

      expect(await within(dialog).findByText("Could not void the wallet pass.")).toBeTruthy();
      expect(screen.getByRole("dialog")).toBeTruthy();
    });

    it("Cancel closes the dialog without calling voidWalletPass", async () => {
      mockLoad(baseDetail({ wallet_pass: walletPass({ status: "active" }) }));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      openMoreActionsMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: /Void wallet pass/ }));
      const dialog = screen.getByRole("dialog", { name: "Void wallet pass?" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(voidWalletPass).not.toHaveBeenCalled();
    });

    it("disables Void wallet pass (in More actions) for an archived event", async () => {
      mockArchivedAt = "2026-01-01T00:00:00.000Z";
      mockLoad(baseDetail({ wallet_pass: walletPass({ status: "active" }) }));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      openMoreActionsMenu();
      const item = screen.getByRole("menuitem", { name: /Void wallet pass/ });
      expect((item as HTMLButtonElement).disabled).toBe(true);
      const describedBy = item.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy!)?.textContent).toBe(ARCHIVED_ACTION_TOOLTIP);
      expect(getTooltipText(item)).toBe(ARCHIVED_ACTION_TOOLTIP);
    });
  });

  describe("Restore wallet pass", () => {
    it("confirms, calls restoreWalletPass, and reloads detail", async () => {
      mockLoad(baseDetail({ wallet_pass: walletPass({ status: "voided" }) }));
      mockLoad(baseDetail({ wallet_pass: walletPass({ status: "active" }) }));
      restoreWalletPass.mockResolvedValueOnce(walletPass({ status: "active" }));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      openMoreActionsMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: /Restore wallet pass/ }));
      const dialog = screen.getByRole("dialog", { name: "Restore wallet pass?" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Restore" }));

      await waitFor(() => {
        expect(restoreWalletPass).toHaveBeenCalledWith("evt-1", "att-1");
        expect(screen.queryByRole("dialog")).toBeNull();
      });

      openMoreActionsMenu();
      expect(screen.getByRole("menuitem", { name: /Void wallet pass/ })).toBeTruthy();
    });

    it("shows an inline error and keeps the dialog open when restoreWalletPass fails", async () => {
      mockLoad(baseDetail({ wallet_pass: walletPass({ status: "voided" }) }));
      const { ApiError } = await import("../../src/api/client.js");
      restoreWalletPass.mockRejectedValueOnce(new ApiError(500, "server_error", "server_error"));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      openMoreActionsMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: /Restore wallet pass/ }));
      const dialog = screen.getByRole("dialog", { name: "Restore wallet pass?" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Restore" }));

      expect(await within(dialog).findByText("Could not restore the wallet pass.")).toBeTruthy();
      expect(screen.getByRole("dialog")).toBeTruthy();
    });

    it("Cancel closes the dialog without calling restoreWalletPass", async () => {
      mockLoad(baseDetail({ wallet_pass: walletPass({ status: "voided" }) }));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      openMoreActionsMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: /Restore wallet pass/ }));
      const dialog = screen.getByRole("dialog", { name: "Restore wallet pass?" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(restoreWalletPass).not.toHaveBeenCalled();
    });
  });

  describe("Push updates (reissue)", () => {
    it("confirms, calls reissueWalletPass, toasts, and reloads detail", async () => {
      mockLoad(baseDetail({ wallet_pass: walletPass({ status: "active" }) }));
      mockLoad(baseDetail({ wallet_pass: walletPass({ status: "active" }) }));
      reissueWalletPass.mockResolvedValueOnce(walletPass({ status: "active" }));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      openMoreActionsMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: /Push updates/ }));
      const dialog = screen.getByRole("dialog", { name: "Push updates to their wallet pass?" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Push updates" }));

      await waitFor(() => {
        expect(reissueWalletPass).toHaveBeenCalledWith("evt-1", "att-1");
        expect(screen.queryByRole("dialog")).toBeNull();
      });
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Wallet pass updated\./);
    });

    it("shows an inline error and keeps the dialog open when reissueWalletPass fails", async () => {
      mockLoad(baseDetail({ wallet_pass: walletPass({ status: "active" }) }));
      const { ApiError } = await import("../../src/api/client.js");
      reissueWalletPass.mockRejectedValueOnce(new ApiError(500, "server_error", "server_error"));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      openMoreActionsMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: /Push updates/ }));
      const dialog = screen.getByRole("dialog", { name: "Push updates to their wallet pass?" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Push updates" }));

      expect(await within(dialog).findByText("Could not push updates to the wallet pass.")).toBeTruthy();
      expect(screen.getByRole("dialog")).toBeTruthy();
      expect(screen.queryByTestId("at-toast")).toBeNull();
    });

    it("Cancel closes the dialog without calling reissueWalletPass", async () => {
      mockLoad(baseDetail({ wallet_pass: walletPass({ status: "active" }) }));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      openMoreActionsMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: /Push updates/ }));
      const dialog = screen.getByRole("dialog", { name: "Push updates to their wallet pass?" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(reissueWalletPass).not.toHaveBeenCalled();
    });
  });

  describe("Refresh status", () => {
    it("calls refreshWalletPassStatus, toasts, and reloads detail - no confirm dialog, unlike the other wallet actions", async () => {
      mockLoad(baseDetail({ wallet_pass: walletPass({ status: "active" }) }));
      mockLoad(baseDetail({ wallet_pass: walletPass({ status: "active" }) }));
      refreshWalletPassStatus.mockResolvedValueOnce(walletPass({ status: "active" }));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      openMoreActionsMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: /Refresh status/ }));

      await waitFor(() => {
        expect(refreshWalletPassStatus).toHaveBeenCalledWith("evt-1", "att-1");
      });
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Wallet status refreshed\./);
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("toasts an error (not an inline dialog message, since this action has no dialog) when refreshWalletPassStatus fails", async () => {
      mockLoad(baseDetail({ wallet_pass: walletPass({ status: "active" }) }));
      const { ApiError } = await import("../../src/api/client.js");
      refreshWalletPassStatus.mockRejectedValueOnce(new ApiError(500, "server_error", "server_error"));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      openMoreActionsMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: /Refresh status/ }));

      await waitFor(() => {
        expect(screen.getByTestId("at-toast").textContent).toMatch(/Could not refresh the wallet status\./);
      });
    });

    it("does not toast or reload a stale success after navigating to another attendee mid-request", async () => {
      mockLoad(baseDetail({ wallet_pass: walletPass({ status: "active" }) }));
      mockLoad(baseDetail({ id: "att-2", name: "Bea", wallet_pass: null }));
      let resolveRefresh!: (value: ReturnType<typeof walletPass>) => void;
      refreshWalletPassStatus.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
      );
      renderPage({ withRouteChangeControl: true });
      await screen.findByRole("heading", { name: "Anna" });

      openMoreActionsMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: /Refresh status/ }));
      await waitFor(() => expect(refreshWalletPassStatus).toHaveBeenCalledOnce());

      fireEvent.click(screen.getByRole("button", { name: "Switch attendee" }));
      await screen.findByRole("heading", { name: "Bea" });
      resolveRefresh(walletPass({ status: "active" }));

      await waitFor(() => expect(loadAttendeeDetailData).toHaveBeenCalledTimes(2));
      expect(screen.queryByTestId("at-toast")).toBeNull();
    });

    it("does not toast a stale failure after navigating to another attendee mid-request", async () => {
      mockLoad(baseDetail({ wallet_pass: walletPass({ status: "active" }) }));
      mockLoad(baseDetail({ id: "att-2", name: "Bea", wallet_pass: null }));
      const { ApiError } = await import("../../src/api/client.js");
      let rejectRefresh!: (reason: Error) => void;
      refreshWalletPassStatus.mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectRefresh = reject;
        }),
      );
      renderPage({ withRouteChangeControl: true });
      await screen.findByRole("heading", { name: "Anna" });

      openMoreActionsMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: /Refresh status/ }));
      await waitFor(() => expect(refreshWalletPassStatus).toHaveBeenCalledOnce());

      fireEvent.click(screen.getByRole("button", { name: "Switch attendee" }));
      await screen.findByRole("heading", { name: "Bea" });
      rejectRefresh(new ApiError(500, "server_error", "server_error"));

      await waitFor(() => expect(loadAttendeeDetailData).toHaveBeenCalledTimes(2));
      expect(screen.queryByTestId("at-toast")).toBeNull();
    });
  });

  describe("Delete wallet pass", () => {
    it("shows the caveats list in the confirm dialog", async () => {
      mockLoad(baseDetail({ wallet_pass: walletPass({ status: "active" }) }));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      openMoreActionsMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: /Delete wallet pass/ }));
      const dialog = screen.getByRole("dialog", { name: "Delete wallet pass?" });
      expect(
        within(dialog).getByText(/Apple\/Google Wallet gives us no way to remove it from their phone/),
      ).toBeTruthy();
      expect(within(dialog).getByText(/Doesn't affect check-in/)).toBeTruthy();
      expect(within(dialog).getByText(/They'd need to add it again from their ticket page/)).toBeTruthy();
    });

    it("confirms, calls deleteWalletPass, toasts, and reloads detail", async () => {
      mockLoad(baseDetail({ wallet_pass: walletPass({ status: "active" }) }));
      mockLoad(baseDetail({ wallet_pass: null }));
      deleteWalletPass.mockResolvedValueOnce({ deleted: true });
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      openMoreActionsMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: /Delete wallet pass/ }));
      const dialog = screen.getByRole("dialog", { name: "Delete wallet pass?" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        expect(deleteWalletPass).toHaveBeenCalledWith("evt-1", "att-1");
        expect(screen.queryByRole("dialog")).toBeNull();
      });
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Wallet pass deleted\./);

      openMoreActionsMenu();
      expect(screen.queryByRole("menuitem", { name: /Void wallet pass/ })).toBeNull();
    });

    it("shows an inline error and keeps the dialog open when deleteWalletPass fails", async () => {
      mockLoad(baseDetail({ wallet_pass: walletPass({ status: "active" }) }));
      const { ApiError } = await import("../../src/api/client.js");
      deleteWalletPass.mockRejectedValueOnce(new ApiError(500, "server_error", "server_error"));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      openMoreActionsMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: /Delete wallet pass/ }));
      const dialog = screen.getByRole("dialog", { name: "Delete wallet pass?" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

      expect(await within(dialog).findByText("Could not delete the wallet pass.")).toBeTruthy();
      expect(screen.getByRole("dialog")).toBeTruthy();
      expect(screen.queryByTestId("at-toast")).toBeNull();
    });

    it("Cancel closes the dialog without calling deleteWalletPass", async () => {
      mockLoad(baseDetail({ wallet_pass: walletPass({ status: "active" }) }));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      openMoreActionsMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: /Delete wallet pass/ }));
      const dialog = screen.getByRole("dialog", { name: "Delete wallet pass?" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(deleteWalletPass).not.toHaveBeenCalled();
    });
  });

  describe("Wallet status chip tone", () => {
    // rsvp_status is "confirmed" and pass status isn't "revoked" on baseDetail's own defaults, so
    // "warn"/wallet-specific tones can only come from the Wallet chip in these two fixtures -
    // avoids ambiguity with the Card titled "Wallet" elsewhere on the page, which also matches a
    // plain getByText("Wallet") query.
    it("shows a warn tone for an expired pass", async () => {
      mockLoad(baseDetail({ wallet_pass: walletPass({ status: "expired" }) }));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      expect(document.querySelector(".attendee-status-chip__icon--warn")).toBeTruthy();
    });

    it("shows a neutral tone for a pass status with no dedicated mapping", async () => {
      mockLoad(baseDetail({ wallet_pass: walletPass({ status: "pending" }) }));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      const icons = document.querySelectorAll(".attendee-status-chip__icon--neutral");
      expect(icons.length).toBeGreaterThan(0);
    });

    it("shows Sent, not Added, when the only confirmed registration is on a platform that's since been disabled", async () => {
      mockWalletAppleEnabled = false;
      mockLoad(
        baseDetail({
          wallet_pass: walletPass({ status: "active", apple_active_registrations: 1, google_active_registrations: 0 }),
        }),
      );
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      expect(screen.getByText("Sent")).toBeTruthy();
      expect(screen.queryByText("Added")).toBeNull();
    });
  });

  describe("First downloaded (formatFirstDownloadedAt)", () => {
    it("formats a well-shaped provider timestamp in UTC", async () => {
      mockLoad(baseDetail({ wallet_pass: walletPass({ first_downloaded_at: "2026-08-01 10:00:00" }) }));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      const row = screen.getByText("First downloaded").closest(".attendee-detail-row");
      expect(row?.textContent).toContain("2026");
    });

    it("falls back to the raw provider string when it doesn't match the expected shape", async () => {
      mockLoad(baseDetail({ wallet_pass: walletPass({ first_downloaded_at: "not-a-timestamp" }) }));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      const row = screen.getByText("First downloaded").closest(".attendee-detail-row");
      expect(row?.textContent).toContain("not-a-timestamp");
    });
  });

  describe("Wallet pass links menu", () => {
    it("renders nothing when neither an Apple nor a Google Wallet link exists yet", async () => {
      mockLoad(baseDetail({ wallet_apple_link: null, wallet_google_link: null }));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      expect(screen.queryByRole("button", { name: "Wallet pass links" })).toBeNull();
    });

    it("copies the Apple Wallet link to the clipboard", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
      mockLoad(
        baseDetail({
          wallet_apple_link: "https://example.com/apple",
          wallet_google_link: "https://example.com/android",
        }),
      );
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      fireEvent.click(screen.getByRole("button", { name: "Wallet pass links" }));
      fireEvent.click(screen.getByRole("menuitem", { name: /Copy Apple Wallet link/ }));

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith("https://example.com/apple");
        expect(screen.getByTestId("at-toast").textContent).toMatch(/Apple Wallet link copied to clipboard/);
      });
    });

    it("copies the Google Wallet link to the clipboard", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
      mockLoad(
        baseDetail({
          wallet_apple_link: "https://example.com/apple",
          wallet_google_link: "https://example.com/android",
        }),
      );
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      fireEvent.click(screen.getByRole("button", { name: "Wallet pass links" }));
      fireEvent.click(screen.getByRole("menuitem", { name: /Copy Google Wallet link/ }));

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith("https://example.com/android");
        expect(screen.getByTestId("at-toast").textContent).toMatch(/Google Wallet link copied to clipboard/);
      });
    });

    it("toasts an error when the clipboard write is blocked", async () => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      });
      mockLoad(baseDetail({ wallet_apple_link: "https://example.com/apple", wallet_google_link: null }));
      renderPage();
      await screen.findByRole("heading", { name: "Anna" });

      fireEvent.click(screen.getByRole("button", { name: "Wallet pass links" }));
      fireEvent.click(screen.getByRole("menuitem", { name: /Copy Apple Wallet link/ }));

      await waitFor(() => {
        expect(screen.getByTestId("at-toast").textContent).toMatch(/Could not copy\. Clipboard access was blocked\./);
      });
      // Only the Apple link menu item renders once wallet_google_link is null.
      expect(screen.queryByRole("menuitem", { name: /Copy Google Wallet link/ })).toBeNull();
    });
  });

  it("shows Voided, Last updated, Last system status update, and Last error rows once the pass has that data", async () => {
    mockLoad(
      baseDetail({
        wallet_pass: walletPass({
          voided_at: "2026-02-01T00:00:00.000Z",
          last_synced_at: "2026-02-02T00:00:00.000Z",
          registration_checked_at: "2026-02-03T00:00:00.000Z",
          last_error_code: "wallet_provider_unauthorized",
        }),
      }),
    );
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    expect(screen.getByText("Voided")).toBeTruthy();
    expect(screen.getByText("Last updated")).toBeTruthy();
    expect(screen.getByText("Last system status update")).toBeTruthy();
    expect(screen.getByText("Last error")).toBeTruthy();
    expect(screen.getByText("wallet_provider_unauthorized")).toBeTruthy();
  });
});

describe("AttendeeDetailPage — Wallet card gated by the event's platform toggles", () => {
  it("hides the Wallet card entirely when the event's master wallet switch is off", async () => {
    mockWalletEnabled = false;
    mockLoad(baseDetail({ wallet_pass: walletPass() }));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    // Selector disambiguates from the Wallet status chip elsewhere on the page (see the identical
    // comment on "Wallet status chip tone" above) - a plain getByText("Wallet") matches both.
    expect(screen.queryByText("Wallet", { selector: ".at-card__title" })).toBeNull();
    expect(screen.queryByLabelText("Apple Wallet: Registered")).toBeNull();
  });

  it("hides the Wallet card when the master switch is on but both individual platforms are off", async () => {
    mockWalletAppleEnabled = false;
    mockWalletGoogleEnabled = false;
    mockLoad(baseDetail({ wallet_pass: walletPass() }));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    expect(screen.queryByText("Wallet", { selector: ".at-card__title" })).toBeNull();
  });

  it.each([
    [() => { mockWalletGoogleEnabled = false; }, "Apple Wallet", "Google Wallet"],
    [() => { mockWalletAppleEnabled = false; }, "Google Wallet", "Apple Wallet"],
  ] as const)("shows only the enabled platform's row when just one toggle is on", async (disableOne, shownLabel, hiddenLabel) => {
    disableOne();
    mockLoad(
      baseDetail({
        wallet_pass: walletPass({ apple_active_registrations: 1, google_active_registrations: 1 }),
      }),
    );
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    expect(screen.getByText("Wallet", { selector: ".at-card__title" })).toBeTruthy();
    expect(screen.getByText(shownLabel)).toBeTruthy();
    expect(screen.queryByText(hiddenLabel)).toBeNull();
  });

  it("omits Copy Apple Wallet link from the wallet links menu when Apple Wallet is disabled, even with a stored apple link", async () => {
    mockWalletAppleEnabled = false;
    mockLoad(
      baseDetail({
        wallet_pass: walletPass(),
        wallet_apple_link: "https://example.com/apple",
        wallet_google_link: "https://example.com/android",
      }),
    );
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    fireEvent.click(screen.getByRole("button", { name: "Wallet pass links" }));
    expect(screen.queryByRole("menuitem", { name: /Copy Apple Wallet link/ })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /Copy Google Wallet link/ })).toBeTruthy();
  });

  it("shows a reserved Samsung Wallet row when Samsung Wallet is enabled, alongside Apple/Google", async () => {
    mockWalletSamsungEnabled = true;
    mockLoad(
      baseDetail({
        wallet_pass: walletPass({ apple_active_registrations: 1, google_active_registrations: 1 }),
      }),
    );
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    expect(screen.getByText("Samsung Wallet")).toBeTruthy();
    // No samsung_active_registrations field exists anywhere (no PassCreator API support yet) - the
    // row can only ever say this, unlike Apple/Google's real registration status above it.
    expect(screen.getByText("Not supported yet")).toBeTruthy();
  });

  it("omits the Samsung Wallet row when Samsung Wallet is disabled, even with Apple/Google both on", async () => {
    mockWalletSamsungEnabled = false;
    mockLoad(baseDetail({ wallet_pass: walletPass() }));
    renderPage();
    await screen.findByRole("heading", { name: "Anna" });

    expect(screen.getByText("Wallet", { selector: ".at-card__title" })).toBeTruthy();
    expect(screen.queryByText("Samsung Wallet")).toBeNull();
  });
});
