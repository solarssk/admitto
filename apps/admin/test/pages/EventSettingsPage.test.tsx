// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { EventSettingsPage } from "../../src/pages/EventSettingsPage.js";
import { renderWithToast } from "../test-utils.js";
import type { RoleAssignment } from "../../src/api/types.js";

const superadminAssignments: RoleAssignment[] = [
  { role: "superadmin", scope_type: "instance", scope_id: null },
];
const orgAdminAssignments: RoleAssignment[] = [
  { role: "admin", scope_type: "organization", scope_id: "org-1" },
];
let mockAssignments: RoleAssignment[] = superadminAssignments;

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: mockAssignments }),
}));

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ reportApiError: vi.fn() }),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useBlocker: () => ({ state: "unblocked", proceed: vi.fn(), reset: vi.fn() }),
  };
});

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchEventSettings: vi.fn(),
    patchEvent: vi.fn(),
    archiveEvent: vi.fn(),
    unarchiveEvent: vi.fn(),
    exportEventPii: vi.fn(),
    uploadEventBrandingFile: vi.fn(),
  };
});

import {
  fetchEventSettings,
  patchEvent,
  unarchiveEvent,
  uploadEventBrandingFile,
} from "../../src/api/client.js";
import { formatUtcDateTime } from "../../src/utils/event-dates.js";

const activeEvent = {
  id: "evt-1",
  title: "Summit",
  slug: "summit",
  date: "2026-06-01",
  timezone: "Europe/Warsaw",
  location: "Hall A",
  capacity: 100,
  status: "active" as const,
  archived_at: null as string | null,
  created_at: "2026-01-15T00:00:00.000Z",
  organization_name: "Org",
  active_items: [] as Array<{ id: string; name: string; enabled: boolean }>,
  logo_url: null,
  header_image_url: null,
  resolved_logo_url: null,
  resolved_header_image_url: null,
};

const archivedEvent = {
  ...activeEvent,
  id: "evt-2",
  status: "archived" as const,
  archived_at: "2026-01-01T00:00:00.000Z",
  capacity: null,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockAssignments = superadminAssignments;
});

function renderSettings(entry = "/admin/events/evt-1/settings") {
  renderWithToast(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/admin/events/:eventId/settings" element={<EventSettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("EventSettingsPage subtitle", () => {
  const SUBTITLE = "Manage this event's details, branding, and access controls.";

  it("shows the stable purpose subtitle while loading, before the event title is known", () => {
    vi.mocked(fetchEventSettings).mockImplementation(() => new Promise(() => {}));
    renderSettings();
    expect(screen.getByText(SUBTITLE)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/Loading event settings/);
  });

  it("shows the same stable subtitle once loaded, not the event's title", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();
    await waitFor(() => {
      expect(screen.getByLabelText("Event title")).toBeTruthy();
    });
    expect(screen.getByText(SUBTITLE)).toBeTruthy();
    expect(SUBTITLE).not.toContain(activeEvent.title);
    expect(screen.queryByText(activeEvent.title, { selector: "p" })).toBeNull();
  });
});

describe("EventSettingsPage tabs", () => {
  it("shows the General tab by default with Basic information", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();
    await waitFor(() => {
      expect(screen.getByLabelText("Event title")).toBeTruthy();
    });
    expect(screen.getByRole("tab", { name: "General" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByText("Basic information")).toBeTruthy();
    expect(screen.getByText("Status")).toBeTruthy();
  });

  it("shows the created date and an active hint in the Status card", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();
    expect(
      await screen.findByText(formatUtcDateTime(activeEvent.created_at)),
    ).toBeTruthy();
    expect(
      screen.getByText("Active events accept check-ins and allow attendee edits."),
    ).toBeTruthy();
  });

  it("shows an 'Archived on <date>' hint in the Status card for archived events", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(archivedEvent);
    renderSettings("/admin/events/evt-2/settings");
    expect(
      await screen.findByText(`Archived on ${formatUtcDateTime(archivedEvent.archived_at)}.`),
    ).toBeTruthy();
  });

  it("switches to the Branding tab and shows event logo + header image upload zones", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Branding" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("tab", { name: "Branding" }));
    expect(await screen.findByText("Event logo")).toBeTruthy();
    expect(screen.getByText("Event header image")).toBeTruthy();
    expect(
      screen.getByText(/Leave a field blank to keep using the organization's branding/),
    ).toBeTruthy();
  });

  it("uploads a branding file through the event-scoped upload endpoint", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    vi.mocked(uploadEventBrandingFile).mockResolvedValueOnce({ url: "/uploads/default/logo.png" });
    renderSettings();
    await waitFor(() => screen.getByRole("tab", { name: "Branding" }));
    fireEvent.click(screen.getByRole("tab", { name: "Branding" }));
    await screen.findByText("Event logo");

    const fileInputs = document.querySelectorAll('input[type="file"]');
    expect(fileInputs).toHaveLength(2);
    const file = new File(["x"], "logo.png", { type: "image/png" });
    fireEvent.change(fileInputs[0]!, { target: { files: [file] } });

    await waitFor(() => {
      expect(uploadEventBrandingFile).toHaveBeenCalledWith("evt-1", expect.any(FormData));
    });
  });

  it("keeps both uploads when a logo upload and a header-image upload race each other", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    let resolveLogo!: (result: { url: string }) => void;
    let resolveHeader!: (result: { url: string }) => void;
    vi.mocked(uploadEventBrandingFile)
      .mockReturnValueOnce(new Promise((resolve) => (resolveLogo = resolve)))
      .mockReturnValueOnce(new Promise((resolve) => (resolveHeader = resolve)));
    renderSettings();
    await waitFor(() => screen.getByRole("tab", { name: "Branding" }));
    fireEvent.click(screen.getByRole("tab", { name: "Branding" }));
    await screen.findByText("Event logo");

    const [logoInput, headerInput] = document.querySelectorAll('input[type="file"]');
    // Start both uploads before either resolves — both onChange closures capture the same
    // pre-upload form snapshot, which is exactly what makes a non-functional setForm racy.
    fireEvent.change(logoInput!, {
      target: { files: [new File(["x"], "logo.png", { type: "image/png" })] },
    });
    fireEvent.change(headerInput!, {
      target: { files: [new File(["y"], "header.png", { type: "image/png" })] },
    });

    resolveLogo({ url: "/uploads/default/logo.png" });
    await waitFor(() => {
      expect(screen.getByAltText("Event logo preview")).toBeTruthy();
    });

    resolveHeader({ url: "/uploads/default/header.png" });
    await waitFor(() => {
      expect(screen.getByAltText("Event header image preview")).toBeTruthy();
    });

    // The header upload completing later must not revert the logo that already landed.
    expect(screen.getByAltText("Event logo preview")).toBeTruthy();
  });

  it("disables Save while a branding upload is in flight, even if another field is already dirty", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    let resolveLogo!: (result: { url: string }) => void;
    vi.mocked(uploadEventBrandingFile).mockReturnValueOnce(
      new Promise((resolve) => (resolveLogo = resolve)),
    );
    renderSettings();
    await waitFor(() => screen.getByLabelText("Event title"));

    // Dirty the page via an unrelated field first — this is what makes the button
    // enabled-except-for-upload-state observable (it isn't just `!dirty` gating it).
    fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "Summit 2027" } });
    expect(screen.getByRole("button", { name: "Save changes" }).hasAttribute("disabled")).toBe(
      false,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Branding" }));
    await screen.findByText("Event logo");
    const [logoInput] = document.querySelectorAll('input[type="file"]');
    fireEvent.change(logoInput!, {
      target: { files: [new File(["x"], "logo.png", { type: "image/png" })] },
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Uploading…" }).hasAttribute("disabled")).toBe(
        true,
      );
    });

    resolveLogo({ url: "/uploads/default/logo.png" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save changes" }).hasAttribute("disabled")).toBe(
        false,
      );
    });
  });

  it("saves both branding fields after uploading, sending the full patch payload", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    vi.mocked(uploadEventBrandingFile)
      .mockResolvedValueOnce({ url: "/uploads/default/logo.png" })
      .mockResolvedValueOnce({ url: "/uploads/default/header.png" });
    vi.mocked(patchEvent).mockResolvedValueOnce({
      event: {
        ...activeEvent,
        logo_url: "/uploads/default/logo.png",
        header_image_url: "/uploads/default/header.png",
      },
    });
    renderSettings();
    await waitFor(() => screen.getByRole("tab", { name: "Branding" }));
    fireEvent.click(screen.getByRole("tab", { name: "Branding" }));
    await screen.findByText("Event logo");

    const [logoInput, headerInput] = document.querySelectorAll('input[type="file"]');
    fireEvent.change(logoInput!, {
      target: { files: [new File(["x"], "logo.png", { type: "image/png" })] },
    });
    await waitFor(() => screen.getByAltText("Event logo preview"));
    fireEvent.change(headerInput!, {
      target: { files: [new File(["y"], "header.png", { type: "image/png" })] },
    });
    await waitFor(() => screen.getByAltText("Event header image preview"));

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(patchEvent).toHaveBeenCalledWith("evt-1", {
        logo_url: "/uploads/default/logo.png",
        header_image_url: "/uploads/default/header.png",
      });
    });
  });

  it("disables branding upload zones when the event is archived", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(archivedEvent);
    renderSettings("/admin/events/evt-2/settings");
    await waitFor(() => screen.getByRole("tab", { name: "Branding" }));
    fireEvent.click(screen.getByRole("tab", { name: "Branding" }));
    await screen.findByText("Event logo");

    const fileInputs = document.querySelectorAll('input[type="file"]');
    expect(fileInputs).toHaveLength(2);
    for (const input of fileInputs) {
      expect((input as HTMLInputElement).disabled).toBe(true);
    }
    expect(screen.getByText("This event is archived - branding cannot be changed.")).toBeTruthy();
  });

  it("switches to the Wallet tab and shows the roadmap placeholder", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();
    await waitFor(() => screen.getByRole("tab", { name: "Wallet" }));
    fireEvent.click(screen.getByRole("tab", { name: "Wallet" }));
    expect(await screen.findByText("Wallet passes are on the roadmap")).toBeTruthy();
  });

  it("switches to the Danger zone tab and shows Archive + Export personal data actions", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();
    await waitFor(() => screen.getByRole("tab", { name: "Danger zone" }));
    fireEvent.click(screen.getByRole("tab", { name: "Danger zone" }));
    expect(await screen.findByRole("button", { name: /Archive event/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Export personal data/ })).toBeTruthy();
    expect(document.querySelector(".danger-zone-panel")).toBeTruthy();
  });

  it("unarchives the event from the Danger zone tab", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(archivedEvent);
    vi.mocked(unarchiveEvent).mockResolvedValueOnce(undefined);
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({ ...archivedEvent, status: "active" });
    renderSettings("/admin/events/evt-2/settings");
    await waitFor(() => screen.getByRole("tab", { name: "Danger zone" }));
    fireEvent.click(screen.getByRole("tab", { name: "Danger zone" }));
    fireEvent.click(await screen.findByRole("button", { name: /Unarchive event/ }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Unarchive event" }));

    await waitFor(() => {
      expect(unarchiveEvent).toHaveBeenCalledWith("evt-2");
    });
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Event unarchived/);
    });
  });

  it("keeps the Danger zone header title-only and shows the impact notice outside the panel", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();
    await waitFor(() => screen.getByRole("tab", { name: "Danger zone" }));
    fireEvent.click(screen.getByRole("tab", { name: "Danger zone" }));
    await screen.findByRole("button", { name: /Archive event/ });

    const header = document.querySelector(".danger-zone-panel__header");
    expect(header?.textContent?.trim()).toBe("Danger zone");

    const notice = document.querySelector(".danger-zone-notice");
    expect(notice).toBeTruthy();
    expect(notice?.textContent).toMatch(/These actions can affect this event's data/);
    expect(document.querySelector(".danger-zone-panel")?.contains(notice)).toBe(false);
  });

  it("deep links directly into a non-default tab via ?tab=", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    expect(await screen.findByText("Wallet passes are on the roadmap")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Wallet" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("EventSettingsPage Integrations tab (superadmin-only)", () => {
  it("shows the Integrations tab and roadmap placeholder for superadmin", async () => {
    mockAssignments = superadminAssignments;
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();
    await waitFor(() => screen.getByRole("tab", { name: "Integrations" }));
    fireEvent.click(screen.getByRole("tab", { name: "Integrations" }));
    expect(
      await screen.findByText("Ingest and RSVP API tokens are on the roadmap"),
    ).toBeTruthy();
  });

  it("hides the Integrations tab entirely for a non-superadmin org admin", async () => {
    mockAssignments = orgAdminAssignments;
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();
    await waitFor(() => screen.getByRole("tab", { name: "General" }));
    expect(screen.queryByRole("tab", { name: "Integrations" })).toBeNull();
  });

  it("falls back to General when a non-superadmin deep-links ?tab=integrations directly", async () => {
    mockAssignments = orgAdminAssignments;
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings("/admin/events/evt-1/settings?tab=integrations");
    await waitFor(() => screen.getByLabelText("Event title"));
    expect(screen.getByRole("tab", { name: "General" }).getAttribute("aria-selected")).toBe("true");
    expect(
      screen.queryByText("Ingest and RSVP API tokens are on the roadmap"),
    ).toBeNull();
  });
});
