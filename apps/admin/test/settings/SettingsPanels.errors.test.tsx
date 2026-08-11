// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import { SecurityPanel } from "../../src/settings/SecurityPanel.js";
import { AuditLogPanel } from "../../src/settings/AuditLogPanel.js";
import { BrandingSettingsPanel } from "../../src/settings/BrandingSettingsPanel.js";
import { EventArchivingPanel } from "../../src/settings/EventArchivingPanel.js";
import { mockMatchMedia, renderWithToast, renderWithToastAndRouter } from "../test-utils.js";

// AuditLogPanel picks table vs. mobile cards via useIsDesktop() - default to desktop so
// its tests exercise the <table> markup they assert against.
beforeEach(() => {
  mockMatchMedia(true);
  vi.mocked(fetchSystemLogs).mockResolvedValue({ entries: [], cursor: 0 });
});

const emptySettings = {
  session_ttl_ms: { value: 86_400_000, source: "default" as const },
  operator_session_ttl_ms: { value: 43_200_000, source: "default" as const },
  session_idle_timeout_ms: { value: 1_800_000, source: "default" as const },
  operator_session_idle_timeout_ms: { value: 7_200_000, source: "default" as const },
  trusted_device_days: { value: 30, source: "default" as const },
  mfa_required_roles: { value: ["superadmin"], source: "default" as const },
  instance_url: { value: null as string | null, source: "default" as const },
  csp_trusted_origins: { value: [] as string[], source: "default" as const },
};

const sampleEvent = {
  id: "evt-1",
  title: "Summit",
  slug: "summit",
  date: "2026-06-01",
  timezone: "Europe/Warsaw",
  archived_at: null as string | null,
};

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchAdminEvents: vi.fn(),
    fetchSecuritySettings: vi.fn(),
    patchSecuritySettings: vi.fn(),
    fetchAuditLog: vi.fn(),
    fetchSystemLogs: vi.fn(),
    fetchStaffTheme: vi.fn(),
    saveStaffTheme: vi.fn(),
    fetchOrgBranding: vi.fn(),
    patchOrgBranding: vi.fn(),
    archiveEvent: vi.fn(),
    unarchiveEvent: vi.fn(),
  };
});

import {
  archiveEvent,
  fetchAdminEvents,
  fetchAuditLog,
  fetchOrgBranding,
  fetchSecuritySettings,
  fetchStaffTheme,
  fetchSystemLogs,
  patchOrgBranding,
  patchSecuritySettings,
  saveStaffTheme,
  unarchiveEvent,
} from "../../src/api/client.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Settings panels delayed loading", () => {
  it("BrandingSettingsPanel shows the loading placeholder once the fetch has genuinely taken a moment", () => {
    vi.mocked(fetchOrgBranding).mockResolvedValueOnce({
      org_name: "Acme",
      logo_url: null,
      logo_original_url: null,
      logo_crop: null,
    });
    vi.mocked(fetchStaffTheme).mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    renderWithToast(<BrandingSettingsPanel />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText("Loading branding settings…")).toBeTruthy();
  });

  it("EventArchivingPanel shows the loading placeholder once the fetch has genuinely taken a moment", () => {
    vi.mocked(fetchAdminEvents).mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    renderWithToastAndRouter(<EventArchivingPanel />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText("Loading…")).toBeTruthy();
  });
});

describe("SecurityPanel operator errors", () => {
  it("shows operator-safe load failure", async () => {
    vi.mocked(fetchSecuritySettings).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToastAndRouter(<SecurityPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    });
    expect(document.querySelector(".sessions-status p")?.textContent).toMatch(
      /Failed to load security settings/,
    );
  });

  it("toasts on save failure", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValueOnce(emptySettings);
    vi.mocked(patchSecuritySettings).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToastAndRouter(<SecurityPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("Admin session maximum lifetime (hours)")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Admin session maximum lifetime (hours)"), {
      target: { value: "48" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Failed to save settings/);
    });
  });

  it("discards unsaved edits on reset", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValueOnce(emptySettings);
    renderWithToastAndRouter(<SecurityPanel />);
    const input = await screen.findByLabelText<HTMLInputElement>(
      "Admin session maximum lifetime (hours)",
    );
    fireEvent.change(input, { target: { value: "48" } });
    expect(input.value).toBe("48");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(input.value).toBe("24");
  });
});

describe("AuditLogPanel operator errors", () => {
  it("shows operator-safe load failure", async () => {
    vi.mocked(fetchAuditLog).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([]);
    renderWithToast(<AuditLogPanel />);
    // AuditLogPanel now opens on the System view by default - switch to Audit to see this.
    fireEvent.click(screen.getByRole("radio", { name: "Audit" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    });
    expect(screen.getByText(/Failed to load audit log/)).toBeTruthy();
    expect(screen.queryByText("secret_internal")).toBeNull();
  });
});

describe("BrandingSettingsPanel operator errors", () => {
  it("toasts operator-safe save failure when both org branding and theme fail to save", async () => {
    vi.mocked(fetchOrgBranding).mockResolvedValueOnce({
      org_name: "Acme",
      logo_url: null,
      logo_original_url: null,
      logo_crop: null,
    });
    vi.mocked(fetchStaffTheme).mockResolvedValueOnce({ theme: { primary: "#112233" } });
    vi.mocked(patchOrgBranding).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    vi.mocked(saveStaffTheme).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Failed to save branding/);
    });
    expect(screen.queryByText("secret_internal")).toBeNull();
  });

  it("toasts a partial-failure message when only the theme save fails", async () => {
    vi.mocked(fetchOrgBranding).mockResolvedValueOnce({
      org_name: "Acme",
      logo_url: null,
      logo_original_url: null,
      logo_crop: null,
    });
    vi.mocked(fetchStaffTheme).mockResolvedValueOnce({ theme: { primary: "#112233" } });
    vi.mocked(patchOrgBranding).mockResolvedValueOnce({
      org_name: "Acme",
      logo_url: null,
      logo_original_url: null,
      logo_crop: null,
    });
    vi.mocked(saveStaffTheme).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<BrandingSettingsPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/the rest was saved/);
    });
    expect(screen.queryByText("secret_internal")).toBeNull();
  });
});

describe("EventArchivingPanel operator errors", () => {
  it("shows operator-safe load failure, and retries the load on demand", async () => {
    vi.mocked(fetchAdminEvents).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToastAndRouter(<EventArchivingPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    });
    expect(screen.getByText(/Failed to load events/)).toBeTruthy();

    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([sampleEvent]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Summit");
    expect(screen.queryByText(/Failed to load events/)).toBeNull();
  });

  it("shows operator-safe action failure in confirm dialog", async () => {
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([sampleEvent]);
    vi.mocked(archiveEvent).mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToastAndRouter(<EventArchivingPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Archive" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));
    await waitFor(() => {
      expect(screen.getByText(/Action failed/)).toBeTruthy();
    });
  });

  it("archives an event on confirm, toasts, and reloads the list", async () => {
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([sampleEvent]);
    vi.mocked(archiveEvent).mockResolvedValueOnce(undefined);
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([{ ...sampleEvent, archived_at: "2026-06-02T00:00:00.000Z" }]);
    renderWithToastAndRouter(<EventArchivingPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Archive" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));

    await waitFor(() => {
      expect(archiveEvent).toHaveBeenCalledWith("evt-1");
    });
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Event archived/);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchAdminEvents).toHaveBeenCalledTimes(2);
  });

  it("keeps the remaining rows visible after archiving the only event on the current page", async () => {
    const many = Array.from({ length: 26 }, (_, i) => ({ ...sampleEvent, id: `evt-${i}`, title: `Event ${i}`, slug: `event-${i}` }));
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce(many);
    vi.mocked(archiveEvent).mockResolvedValueOnce(undefined);
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([
      ...many.slice(0, 25),
      { ...many[25], archived_at: "2026-06-02T00:00:00.000Z" },
    ]);
    renderWithToastAndRouter(<EventArchivingPanel />);

    await screen.findByText("Showing 1–25 of 26");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Event 25");

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));

    await waitFor(() => {
      expect(archiveEvent).toHaveBeenCalledWith("evt-25");
    });
    await screen.findByText("Event 0");
    expect(screen.queryByText("No active events")).toBeNull();
  });

  it("unarchives an event on confirm, toasts, and reloads the list", async () => {
    const archived = { ...sampleEvent, archived_at: "2026-06-02T00:00:00.000Z" };
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([archived]);
    vi.mocked(unarchiveEvent).mockResolvedValueOnce(undefined);
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([{ ...sampleEvent, archived_at: null }]);
    renderWithToastAndRouter(<EventArchivingPanel />);
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "Archived" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("radio", { name: "Archived" }));
    fireEvent.click(await screen.findByRole("button", { name: "Unarchive" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Unarchive" }));

    await waitFor(() => {
      expect(unarchiveEvent).toHaveBeenCalledWith("evt-1");
    });
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Event unarchived/);
    });
    expect(fetchAdminEvents).toHaveBeenCalledTimes(2);
  });

  it("cancels the confirm dialog without calling the API", async () => {
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([sampleEvent]);
    renderWithToastAndRouter(<EventArchivingPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(archiveEvent).not.toHaveBeenCalled();
  });

  it("keeps the confirm dialog open on Escape while an action is in flight", async () => {
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([sampleEvent]);
    vi.mocked(archiveEvent).mockImplementationOnce(() => new Promise(() => {}));
    renderWithToastAndRouter(<EventArchivingPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));

    await within(dialog).findByRole("button", { name: "Working…" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
