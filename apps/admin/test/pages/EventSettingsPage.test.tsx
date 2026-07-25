// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider } from "react-router/dom";
import { createMemoryRouter, MemoryRouter, Route, Routes } from "react-router";
import { EventSettingsPage } from "../../src/pages/EventSettingsPage.js";
import { renderWithToast } from "../test-utils.js";
import type { RoleAssignment, TicketTypeDto } from "../../src/api/types.js";

const superadminAssignments: RoleAssignment[] = [
  { role: "superadmin", scope_type: "instance", scope_id: null },
];
const orgAdminAssignments: RoleAssignment[] = [
  { role: "admin", scope_type: "organization", scope_id: "org-1" },
];
let mockAssignments: RoleAssignment[] = superadminAssignments;
let mockBlocker: {
  state: "unblocked" | "blocked";
  proceed: () => void;
  reset: () => void;
} = { state: "unblocked", proceed: vi.fn(), reset: vi.fn() };

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: mockAssignments }),
}));

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ reportApiError: vi.fn() }),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useBlocker: () => mockBlocker,
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
    deleteEvent: vi.fn(),
    revokeAllCheckIns: vi.fn(),
    revokeAllItemsIssued: vi.fn(),
    fetchEventImageAssets: vi.fn(),
    createEventImageAsset: vi.fn(),
    deleteEventImageAsset: vi.fn(),
    fetchTicketTypes: vi.fn().mockResolvedValue([]),
    updateTicketType: vi.fn(),
    fetchEventMailSettings: vi.fn(),
  };
});

import {
  archiveEvent,
  deleteEvent,
  fetchEventImageAssets,
  fetchEventMailSettings,
  fetchEventSettings,
  fetchTicketTypes,
  patchEvent,
  revokeAllCheckIns,
  revokeAllItemsIssued,
  unarchiveEvent,
  updateTicketType,
  uploadEventBrandingFile,
} from "../../src/api/client.js";
import type { EventMailSettingsResponse, MailSettingsFieldsDto } from "../../src/api/types.js";
import { ARCHIVED_ACTION_TOOLTIP } from "../../src/components/ArchivedGuard.js";
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
  is_deletable: false,
  admitted_count: 0,
  issued_items_count: 0,
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

function plainField<T>(value: T) {
  return { value, source: "db" as const, locked: false };
}

function inheritedMailSettingsResponse(): EventMailSettingsResponse {
  const secret = { set: false, masked: null, source: "db" as const, locked: false };
  const fields: MailSettingsFieldsDto = {
    provider: plainField(null),
    fromAddress: plainField(null),
    fromName: plainField(null),
    replyTo: plainField(null),
    envelopeFrom: plainField(null),
    allowedFromDomain: plainField(null),
    host: plainField(null),
    port: plainField(null),
    secure: plainField(null),
    user: plainField(null),
    requireTls: plainField(null),
    tlsRejectUnauthorized: plainField(null),
    heloName: plainField(null),
    pool: plainField(null),
    maxConnections: plainField(null),
    maxMessages: plainField(null),
    rateLimitPerMinute: plainField(null),
    connectionTimeout: plainField(null),
    greetingTimeout: plainField(null),
    socketTimeout: plainField(null),
    smtpPassword: secret,
    mailbox: plainField(null),
    tenantId: plainField(null),
    clientId: plainField(null),
    saveToSentItems: plainField(null),
    graphClientSecret: secret,
    powerAutomateUrl: secret,
    powerAutomateKey: secret,
  };
  return {
    eventId: "evt-1",
    organizationId: "org-1",
    isProduction: true,
    hasEventOverride: false,
    fields,
  };
}

beforeEach(() => {
  // The ticket-type staleness tests queue one-off mock implementations. Resetting them before
  // every test prevents an unconsumed async response in a failed test from affecting the next one.
  vi.resetAllMocks();
  // The Branding tab also mounts EventImageAssetLibrary, which fetches its own list on mount.
  // Default to an empty library so tests that don't care about it never hit a real network
  // call (jsdom's `fetch` is real, not auto-mocked) or leak an unresolved promise into the
  // next test.
  vi.mocked(fetchEventImageAssets).mockResolvedValue([]);
  vi.mocked(fetchTicketTypes).mockResolvedValue([]);
  vi.mocked(fetchEventMailSettings).mockResolvedValue(inheritedMailSettingsResponse());
  mockBlocker = { state: "unblocked", proceed: vi.fn(), reset: vi.fn() };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mockAssignments = superadminAssignments;
});

function renderSettings(entry = "/admin/events/evt-1/settings") {
  renderWithToast(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/admin" element={<div>events picker</div>} />
        <Route path="/admin/events/:eventId/overview" element={<div>event overview</div>} />
        <Route path="/admin/events/:eventId/settings" element={<EventSettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("EventSettingsPage subtitle", () => {
  const SUBTITLE = "Manage this event's details, branding, and access controls.";

  it("shows the stable purpose subtitle while loading, before the event title is known", () => {
    vi.mocked(fetchEventSettings).mockImplementation(() => new Promise(() => {}));
    // useDelayedLoading only shows the placeholder once the fetch has stayed pending past its
    // 200ms grace window (avoids flashing it for a near-instant response) — fake timers must
    // be installed before render so the hook's setTimeout is one of ours.
    vi.useFakeTimers();
    renderSettings();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText(SUBTITLE)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/Loading event settings/);
    vi.useRealTimers();
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

describe("EventSettingsPage unavailable event", () => {
  it("shows the safe unavailable state for a missing event and returns to its overview", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    vi.mocked(fetchEventSettings).mockRejectedValueOnce(new ApiError(404, "event_not_found"));

    renderSettings();

    expect(await screen.findByText("Event not found")).toBeTruthy();
    expect(
      screen.getByText("The event could not be found or you do not have access."),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("event overview")).toBeTruthy();
  });
});

describe("EventSettingsPage navigation guard", () => {
  it("delegates both confirmation choices to the router blocker", async () => {
    const proceed = vi.fn();
    const reset = vi.fn();
    mockBlocker = { state: "blocked" as const, proceed, reset };
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();

    const dialog = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(reset).toHaveBeenCalledTimes(1);

    fireEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
    expect(proceed).toHaveBeenCalledTimes(1);
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

  it("switches to the Branding tab and shows event logo + image library", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Branding" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("tab", { name: "Branding" }));
    expect(await screen.findByText("Event branding")).toBeTruthy();
    expect(screen.getByText("Drop logo here or click to browse")).toBeTruthy();
    expect(screen.getByText("Upload images")).toBeTruthy();
    expect(screen.getByText("Your images")).toBeTruthy();
    expect(await screen.findByText(/No image assets yet/)).toBeTruthy();
    expect(
      screen.getByText(/leave it blank to use the organization's logo/),
    ).toBeTruthy();
  });

  it("shows an inline error with Retry on the Ticket types tab when the catalog fails to load, and Retry recovers (CodeRabbit review)", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    vi.mocked(fetchTicketTypes).mockRejectedValueOnce(new Error("network down"));
    renderSettings();
    await screen.findByRole("tab", { name: "Ticket types" });
    fireEvent.click(screen.getByRole("tab", { name: "Ticket types" }));

    expect(await screen.findByText("Could not load ticket types")).toBeTruthy();

    vi.mocked(fetchTicketTypes).mockResolvedValueOnce([
      {
        id: "tt-1",
        key: "vip",
        label: "VIP",
        color: "purple",
        sort_order: 0,
        attendee_count: 0,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("VIP")).toBeTruthy();
    expect(screen.queryByText("Could not load ticket types")).toBeNull();
  });

  it("never claims 'No ticket types yet' during the no-flash grace window of the very first load (Sonar/PO review)", async () => {
    // Regression test: TicketTypesCard must be gated on the raw ticketTypesLoading flag, not the
    // delayed showTicketTypesLoading flag alone — otherwise the pre-delay window (real fetch still
    // in flight, ticketTypes still its initial []) falls straight through to the confirmed-empty
    // message below. Deliberately no fake timers / advancing here: the assertion only needs the
    // real elapsed time since mount to stay under the 200ms grace window, same as production.
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    vi.mocked(fetchTicketTypes).mockImplementationOnce(() => new Promise(() => {}));
    renderSettings();
    await screen.findByRole("tab", { name: "Ticket types" });
    fireEvent.click(screen.getByRole("tab", { name: "Ticket types" }));

    expect(
      screen.queryByText("No ticket types yet. Add at least one before sending tickets."),
    ).toBeNull();
  });

  it("shows a superadmin-only notice instead of the image asset library for a non-superadmin org admin", async () => {
    mockAssignments = orgAdminAssignments;
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Branding" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("tab", { name: "Branding" }));
    expect(await screen.findByText("Event branding")).toBeTruthy();
    // Event logo stays available to any event admin...
    expect(screen.getByText("Drop logo here or click to browse")).toBeTruthy();
    // ...but the image asset library (upload/list/delete routes require superadmin) does not
    // mount at all for a non-superadmin, so it never fires the 403 fetch it otherwise would.
    expect(screen.queryByText("Upload images")).toBeNull();
    expect(screen.getByText("Superadmin only")).toBeTruthy();
    expect(fetchEventImageAssets).not.toHaveBeenCalled();
  });

  it("uploads a branding file through the event-scoped upload endpoint", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    vi.mocked(uploadEventBrandingFile).mockResolvedValueOnce({ url: "/uploads/default/logo.png" });
    renderSettings();
    await screen.findByRole("tab", { name: "Branding" });
    fireEvent.click(screen.getByRole("tab", { name: "Branding" }));
    await screen.findByText("Event branding");

    const fileInputs = document.querySelectorAll('.logo-upload input[type="file"]');
    expect(fileInputs).toHaveLength(1);
    const file = new File(["x"], "logo.png", { type: "image/png" });
    fireEvent.change(fileInputs[0]!, { target: { files: [file] } });

    await waitFor(() => {
      expect(uploadEventBrandingFile).toHaveBeenCalledWith("evt-1", expect.any(FormData));
    });
  });

  it("disables Save while a branding upload is in flight, even if another field is already dirty", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    let resolveLogo!: (result: { url: string }) => void;
    vi.mocked(uploadEventBrandingFile).mockReturnValueOnce(
      new Promise((resolve) => (resolveLogo = resolve)),
    );
    renderSettings();
    await screen.findByLabelText("Event title");

    // Dirty the page via an unrelated field first — this is what makes the button
    // enabled-except-for-upload-state observable (it isn't just `!dirty` gating it).
    fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "Summit 2027" } });
    expect(screen.getByRole("button", { name: "Save changes" }).hasAttribute("disabled")).toBe(
      false,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Branding" }));
    await screen.findByText("Event branding");
    const [logoInput] = document.querySelectorAll('.logo-upload input[type="file"]');
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

  it("saves the logo field after uploading, sending the patch payload", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    vi.mocked(uploadEventBrandingFile).mockResolvedValueOnce({ url: "/uploads/default/logo.png" });
    vi.mocked(patchEvent).mockResolvedValueOnce({
      event: {
        ...activeEvent,
        logo_url: "/uploads/default/logo.png",
      },
    });
    renderSettings();
    await screen.findByRole("tab", { name: "Branding" });
    fireEvent.click(screen.getByRole("tab", { name: "Branding" }));
    await screen.findByText("Event branding");

    const [logoInput] = document.querySelectorAll('.logo-upload input[type="file"]');
    fireEvent.change(logoInput!, {
      target: { files: [new File(["x"], "logo.png", { type: "image/png" })] },
    });
    await screen.findByAltText("Event logo preview");

    // The alt-text preview and the Save button's label flip in separate React commits
    // (the button label only updates once LogoUploadZone's onUploadingChange effect fires
    // one tick later) — wait for the button itself rather than assuming it's already there.
    const saveButton = await screen.findByRole("button", { name: "Save changes" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(patchEvent).toHaveBeenCalledWith("evt-1", {
        logo_url: "/uploads/default/logo.png",
      });
    });
  });

  it("disables branding upload zones when the event is archived", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(archivedEvent);
    renderSettings("/admin/events/evt-2/settings");
    await screen.findByRole("tab", { name: "Branding" });
    fireEvent.click(screen.getByRole("tab", { name: "Branding" }));
    await screen.findByText("Event branding");

    const fileInputs = document.querySelectorAll('.logo-upload input[type="file"]');
    expect(fileInputs).toHaveLength(1);
    for (const input of fileInputs) {
      expect((input as HTMLInputElement).disabled).toBe(true);
    }
    expect(screen.getByText("This event is archived - branding cannot be changed.")).toBeTruthy();

    await screen.findByText(/No image assets yet/);
    const assetFileInput = document.querySelector(
      ".image-asset-library__file-input",
    ) as HTMLInputElement;
    expect(assetFileInput.disabled).toBe(true);
    expect(
      screen.getByText("This event is archived - the asset library cannot be changed."),
    ).toBeTruthy();
  });

  it("switches to the Wallet tab and shows the roadmap placeholder", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();
    await screen.findByRole("tab", { name: "Wallet" });
    fireEvent.click(screen.getByRole("tab", { name: "Wallet" }));
    expect(await screen.findByText("Wallet passes are on the roadmap")).toBeTruthy();
  });

  it("switches to the Danger zone tab and shows Archive + Export personal data actions", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();
    await screen.findByRole("tab", { name: "Danger zone" });
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
    await screen.findByRole("tab", { name: "Danger zone" });
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

  it("discards the Mail tab's dirty draft after archiving (CodeRabbit review)", async () => {
    // The archive confirm dialog warns "you also have unsaved changes elsewhere on this
    // page — they'll be lost when this finishes" — this proves that promise is kept for
    // the Mail tab specifically, by remounting EventMailSettingsCard on archive success.
    vi.mocked(fetchEventSettings).mockResolvedValue(activeEvent);
    vi.mocked(fetchEventMailSettings).mockResolvedValue(inheritedMailSettingsResponse());
    vi.mocked(archiveEvent).mockResolvedValueOnce(undefined);
    renderSettings();

    await screen.findByRole("tab", { name: "Mailing" });
    fireEvent.click(screen.getByRole("tab", { name: "Mailing" }));
    await waitFor(() => expect(fetchEventMailSettings).toHaveBeenCalledTimes(1));
    await screen.findByRole("radio", { name: "Organization mail" });

    // Dirty the mail draft without saving it.
    fireEvent.click(screen.getByRole("radio", { name: "Dedicated for this event" }));
    expect(
      screen.getByRole("radio", { name: "Dedicated for this event" }).getAttribute("aria-checked"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("tab", { name: "Danger zone" }));
    fireEvent.click(await screen.findByRole("button", { name: /Archive event/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive event" }));

    await waitFor(() => expect(archiveEvent).toHaveBeenCalledWith("evt-1"));
    // The card remounted and re-fetched — proof its old in-memory draft was discarded
    // rather than silently surviving the "this will be lost" warning.
    await waitFor(() => expect(fetchEventMailSettings).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("tab", { name: "Mailing" }));
    await waitFor(() => {
      expect(
        screen.getByRole("radio", { name: "Organization mail" }).getAttribute("aria-checked"),
      ).toBe("true");
    });
  });

  it("keeps the Danger zone header title-only and shows the impact notice outside the panel", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();
    await screen.findByRole("tab", { name: "Danger zone" });
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
    await screen.findByRole("tab", { name: "Integrations" });
    fireEvent.click(screen.getByRole("tab", { name: "Integrations" }));
    expect(
      await screen.findByText("Ingest and RSVP API tokens are on the roadmap"),
    ).toBeTruthy();
  });

  it("hides the Integrations tab entirely for a non-superadmin org admin", async () => {
    mockAssignments = orgAdminAssignments;
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();
    await screen.findByRole("tab", { name: "General" });
    expect(screen.queryByRole("tab", { name: "Integrations" })).toBeNull();
  });

  it("falls back to General when a non-superadmin deep-links ?tab=integrations directly", async () => {
    mockAssignments = orgAdminAssignments;
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings("/admin/events/evt-1/settings?tab=integrations");
    await screen.findByLabelText("Event title");
    expect(screen.getByRole("tab", { name: "General" }).getAttribute("aria-selected")).toBe("true");
    expect(
      screen.queryByText("Ingest and RSVP API tokens are on the roadmap"),
    ).toBeNull();
  });
});

describe("EventSettingsPage Mailing tab (superadmin-only)", () => {
  it("shows the Mailing tab for superadmin", async () => {
    mockAssignments = superadminAssignments;
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();
    await screen.findByRole("tab", { name: "Mailing" });
    fireEvent.click(screen.getByRole("tab", { name: "Mailing" }));
    expect(await screen.findByRole("radio", { name: "Organization mail" })).toBeTruthy();
  });

  it("hides the Mailing tab entirely for a non-superadmin org admin", async () => {
    mockAssignments = orgAdminAssignments;
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();
    await screen.findByRole("tab", { name: "General" });
    expect(screen.queryByRole("tab", { name: "Mailing" })).toBeNull();
  });

  it("falls back to General when a non-superadmin deep-links ?tab=mail directly", async () => {
    mockAssignments = orgAdminAssignments;
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings("/admin/events/evt-1/settings?tab=mail");
    await screen.findByLabelText("Event title");
    expect(screen.getByRole("tab", { name: "General" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("radio", { name: "Organization mail" })).toBeNull();
  });
});

describe("EventSettingsPage — delete event (#395)", () => {
  async function openDangerZone() {
    await screen.findByRole("tab", { name: "Danger zone" });
    fireEvent.click(screen.getByRole("tab", { name: "Danger zone" }));
  }

  it("renders Delete event disabled for an active event with activity (archiving is not required)", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      is_deletable: false,
    });
    renderSettings();
    await openDangerZone();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Delete event/ })).toBeTruthy();
    });
    const button = screen.getByRole("button", { name: /Delete event/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const describedBy = button.getAttribute("aria-describedby");
    expect(document.getElementById(describedBy!)?.textContent).toBe(
      "This event has data and cannot be deleted",
    );
    expect(
      screen.getByText(
        /Only events with no attendees, custom items, custom ticket types, contacts, resources, pinned note, event-specific mail template, or recorded activity can be permanently deleted/,
      ),
    ).toBeTruthy();
  });

  it("renders Delete event enabled for a superadmin on an active, empty event", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      is_deletable: true,
    });
    renderSettings();
    await openDangerZone();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Delete event/ })).toBeTruthy();
    });
    const button = screen.getByRole("button", { name: /Delete event/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(
      screen.getByText(
        /Permanently deletes this event and everything in it\. This can't be undone\./,
      ),
    ).toBeTruthy();
  });

  it("renders Delete event disabled for an archived event that still has activity", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...archivedEvent,
      is_deletable: false,
    });
    renderSettings("/admin/events/evt-2/settings");
    await openDangerZone();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Delete event/ })).toBeTruthy();
    });
    const button = screen.getByRole("button", { name: /Delete event/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const describedBy = button.getAttribute("aria-describedby");
    expect(document.getElementById(describedBy!)?.textContent).toBe(
      "This event has data and cannot be deleted",
    );
    expect(
      screen.getByText(
        /Only events with no attendees, custom items, custom ticket types, contacts, resources, pinned note, event-specific mail template, or recorded activity can be permanently deleted/,
      ),
    ).toBeTruthy();
  });

  it("renders Delete event enabled for a superadmin on an archived, empty event", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...archivedEvent,
      is_deletable: true,
    });
    renderSettings("/admin/events/evt-2/settings");
    await openDangerZone();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Delete event/ })).toBeTruthy();
    });
    const button = screen.getByRole("button", { name: /Delete event/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(
      screen.getByText(
        /Permanently deletes this event and everything in it\. This can't be undone\./,
      ),
    ).toBeTruthy();
  });

  it("disables Delete event for a non-superadmin org admin, even on a deletable archived event", async () => {
    mockAssignments = orgAdminAssignments;
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...archivedEvent,
      is_deletable: true,
    });
    renderSettings("/admin/events/evt-2/settings");
    await openDangerZone();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Delete event/ })).toBeTruthy();
    });
    const button = screen.getByRole("button", { name: /Delete event/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const describedBy = button.getAttribute("aria-describedby");
    expect(document.getElementById(describedBy!)?.textContent).toBe("Superadmin only");
  });

  it("gates the confirm button on typing the exact event title, then deletes and navigates to /admin", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...archivedEvent,
      title: "Summit 2026",
      is_deletable: true,
    });
    vi.mocked(deleteEvent).mockResolvedValueOnce(undefined);
    renderSettings("/admin/events/evt-2/settings");
    await openDangerZone();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Delete event/ })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Delete event/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Permanently delete this event/)).toBeTruthy();

    const confirmButton = within(dialog).getByRole("button", {
      name: "Delete event",
    }) as HTMLButtonElement;
    const input = within(dialog).getByLabelText('Type the event title to confirm: "Summit 2026"');
    expect(confirmButton.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "Summit" } });
    expect(confirmButton.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "Summit 2026" } });
    expect(confirmButton.disabled).toBe(false);

    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(deleteEvent).toHaveBeenCalledWith("evt-2");
    });
    await waitFor(() => {
      expect(screen.getByText("events picker")).toBeTruthy();
    });
  });

  it("keeps the dialog open and shows the failure reason inline, not just as a toast", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...archivedEvent,
      title: "Summit 2026",
      is_deletable: true,
    });
    const { ApiError } = await import("../../src/api/client.js");
    vi.mocked(deleteEvent).mockRejectedValueOnce(new ApiError(409, "event_not_deletable"));
    renderSettings("/admin/events/evt-2/settings");
    await openDangerZone();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Delete event/ })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Delete event/ }));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText('Type the event title to confirm: "Summit 2026"');
    fireEvent.change(input, { target: { value: "Summit 2026" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete event" }));

    await waitFor(() => {
      expect(deleteEvent).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByText("events picker")).toBeNull();
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toBeTruthy();
  });

  it("clears the delete error when the dialog is cancelled and reopened", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...archivedEvent,
      title: "Summit 2026",
      is_deletable: true,
    });
    const { ApiError } = await import("../../src/api/client.js");
    vi.mocked(deleteEvent).mockRejectedValueOnce(new ApiError(409, "event_not_deletable"));
    renderSettings("/admin/events/evt-2/settings");
    await openDangerZone();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Delete event/ })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Delete event/ }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText('Type the event title to confirm: "Summit 2026"'), {
      target: { value: "Summit 2026" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete event" }));
    await waitFor(() => {
      expect(within(screen.getByRole("dialog")).getByRole("alert")).toBeTruthy();
    });

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Delete event/ }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });
});

describe("EventSettingsPage — revoke all check-ins / items issued (Danger Zone follow-up)", () => {
  async function openDangerZone() {
    await screen.findByRole("tab", { name: "Danger zone" });
    fireEvent.click(screen.getByRole("tab", { name: "Danger zone" }));
  }

  // The Revoke dialogs' confirm buttons stay disabled for 10s after opening (see
  // ConfirmDialog's confirmDelaySeconds — an "arm before confirming" pause). Fake-timers a
  // tightly scoped window around just the open+arm step so tests don't wait 10 real seconds
  // each, while everything before/after (fetch mocks, toasts) still runs on real timers.
  async function openAndArmRevokeDialog(triggerName: string) {
    const triggerButton = await screen.findByRole("button", { name: triggerName });
    vi.useFakeTimers();
    fireEvent.click(triggerButton);
    const dialog = screen.getByRole("dialog");
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    vi.useRealTimers();
    return dialog;
  }

  it("disables Revoke all check-ins with a zero-activity message when admitted_count is 0", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({ ...activeEvent, admitted_count: 0 });
    renderSettings();
    await openDangerZone();
    const button = (await screen.findByRole("button", {
      name: "Revoke all check-ins",
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText("No attendees are currently checked in.")).toBeTruthy();
    const describedBy = button.getAttribute("aria-describedby");
    expect(document.getElementById(describedBy!)?.textContent).toBe("No check-ins to revoke");
  });

  it("enables Revoke all check-ins for a superadmin with admitted attendees", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({ ...activeEvent, admitted_count: 1 });
    renderSettings();
    await openDangerZone();
    const button = (await screen.findByRole("button", {
      name: "Revoke all check-ins",
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(
      screen.getByText(
        "Reverses check-in for all 1 currently checked-in attendee. They can check in again afterwards.",
      ),
    ).toBeTruthy();
  });

  // Regression: bulk revoke actions reload this page's data on success (to refresh their own
  // live counts), which silently discards unsaved edits elsewhere on the page - warn about that
  // inline in the confirm dialog rather than let it vanish with no trace (bot review; PO: leave
  // the underlying discard-on-reload behavior as-is, consistent with Archive/Unarchive, but add
  // the warning so it's not silent).
  it("warns in the Revoke all check-ins dialog when the page has unsaved changes elsewhere", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({ ...activeEvent, admitted_count: 1 });
    renderSettings();
    await screen.findByLabelText("Event title");
    fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "Summit 2027" } });

    fireEvent.click(screen.getByRole("tab", { name: "Danger zone" }));
    fireEvent.click(await screen.findByRole("button", { name: "Revoke all check-ins" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/You also have unsaved changes elsewhere on this page/),
    ).toBeTruthy();
  });

  it("does not warn in the Revoke all check-ins dialog when the page has no unsaved changes", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({ ...activeEvent, admitted_count: 1 });
    renderSettings();
    await openDangerZone();
    fireEvent.click(await screen.findByRole("button", { name: "Revoke all check-ins" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText(/unsaved changes/)).toBeNull();
  });

  it("disables Revoke all check-ins for a non-superadmin org admin despite admitted attendees", async () => {
    mockAssignments = orgAdminAssignments;
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({ ...activeEvent, admitted_count: 3 });
    renderSettings();
    await openDangerZone();
    const button = (await screen.findByRole("button", {
      name: "Revoke all check-ins",
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const describedBy = button.getAttribute("aria-describedby");
    expect(document.getElementById(describedBy!)?.textContent).toBe("Superadmin only");
  });

  it("disables Revoke all items issued with a zero-activity message when issued_items_count is 0", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({ ...activeEvent, issued_items_count: 0 });
    renderSettings();
    await openDangerZone();
    const button = (await screen.findByRole("button", {
      name: "Revoke all items issued",
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText("No items have been issued yet.")).toBeTruthy();
  });

  it("enables Revoke all items issued for a superadmin with issued items", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({ ...activeEvent, issued_items_count: 4 });
    renderSettings();
    await openDangerZone();
    const button = (await screen.findByRole("button", {
      name: "Revoke all items issued",
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(
      screen.getByText(
        "Resets all 4 issued items back to pending, for every attendee. They can be handed out again afterwards.",
      ),
    ).toBeTruthy();
  });

  it("disables both revoke rows once the event is archived, even with real counts", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...archivedEvent,
      admitted_count: 2,
      issued_items_count: 4,
    });
    renderSettings("/admin/events/evt-2/settings");
    await openDangerZone();
    const checkinsButton = (await screen.findByRole("button", {
      name: "Revoke all check-ins",
    })) as HTMLButtonElement;
    const itemsButton = screen.getByRole("button", {
      name: "Revoke all items issued",
    }) as HTMLButtonElement;
    expect(checkinsButton.disabled).toBe(true);
    expect(itemsButton.disabled).toBe(true);
    for (const button of [checkinsButton, itemsButton]) {
      const describedBy = button.getAttribute("aria-describedby");
      expect(document.getElementById(describedBy!)?.textContent).toBe(ARCHIVED_ACTION_TOOLTIP);
    }
  });

  it("confirms and revokes all check-ins, showing a pluralized success toast and reloading", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({ ...activeEvent, admitted_count: 3 });
    vi.mocked(revokeAllCheckIns).mockResolvedValueOnce({ revokedCount: 3 });
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({ ...activeEvent, admitted_count: 0 });
    renderSettings();
    await openDangerZone();
    const dialog = await openAndArmRevokeDialog("Revoke all check-ins");

    expect(
      within(dialog).getByText(
        "This will revoke check-in for 3 attendees. They can check in again afterwards.",
      ),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke all check-ins" }));

    await waitFor(() => {
      expect(revokeAllCheckIns).toHaveBeenCalledWith("evt-1");
    });
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Revoked check-in for 3 attendees/);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => {
      expect(screen.getByText("No attendees are currently checked in.")).toBeTruthy();
    });
  });

  it("closes archive confirmation without changing the event", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();
    await openDangerZone();
    fireEvent.click(await screen.findByRole("button", { name: "Archive event" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(archiveEvent).not.toHaveBeenCalled();
  });

  it("shows a 'No check-ins to revoke' toast when the server resolves a zero count", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({ ...activeEvent, admitted_count: 1 });
    vi.mocked(revokeAllCheckIns).mockResolvedValueOnce({ revokedCount: 0 });
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({ ...activeEvent, admitted_count: 0 });
    renderSettings();
    await openDangerZone();
    const dialog = await openAndArmRevokeDialog("Revoke all check-ins");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke all check-ins" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/No check-ins to revoke/);
    });
  });

  it("keeps the dialog open and shows an error toast when revoking check-ins fails", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({ ...activeEvent, admitted_count: 2 });
    const { ApiError } = await import("../../src/api/client.js");
    vi.mocked(revokeAllCheckIns).mockRejectedValueOnce(new ApiError(500, "server_error"));
    renderSettings();
    await openDangerZone();
    const dialog = await openAndArmRevokeDialog("Revoke all check-ins");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke all check-ins" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Failed to revoke check-ins/);
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("confirms and revokes all issued items, showing a pluralized success toast and reloading", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({ ...activeEvent, issued_items_count: 5 });
    vi.mocked(revokeAllItemsIssued).mockResolvedValueOnce({ revokedCount: 5 });
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({ ...activeEvent, issued_items_count: 0 });
    renderSettings();
    await openDangerZone();
    const dialog = await openAndArmRevokeDialog("Revoke all items issued");

    expect(
      within(dialog).getByText(
        "This will reset 5 issued items back to pending. They can be handed out again afterwards.",
      ),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke all items issued" }));

    await waitFor(() => {
      expect(revokeAllItemsIssued).toHaveBeenCalledWith("evt-1");
    });
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(
        /Reset 5 issued items back to pending/,
      );
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the dialog open and shows an error toast when revoking items fails", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({ ...activeEvent, issued_items_count: 2 });
    const { ApiError } = await import("../../src/api/client.js");
    vi.mocked(revokeAllItemsIssued).mockRejectedValueOnce(new ApiError(500, "server_error"));
    renderSettings();
    await openDangerZone();
    const dialog = await openAndArmRevokeDialog("Revoke all items issued");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke all items issued" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Failed to revoke items/);
    });
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("always shows Revoke all Wallet passes as a disabled roadmap placeholder with no dialog", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      admitted_count: 5,
      issued_items_count: 5,
    });
    renderSettings();
    await openDangerZone();
    const button = (await screen.findByRole("button", {
      name: "Revoke all Wallet passes",
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const describedBy = button.getAttribute("aria-describedby");
    expect(document.getElementById(describedBy!)?.textContent).toBe("Not built yet");
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("EventSettingsPage — ticket types cross-event staleness", () => {
  const eventB = { ...activeEvent, id: "evt-2", title: "Gala Dinner" };

  const vipType: TicketTypeDto = {
    id: "tt-vip",
    key: "vip",
    label: "VIP",
    color: "purple",
    sort_order: 0,
    attendee_count: 2,
    created_at: "2026-01-01T00:00:00.000Z",
  };
  const staffType: TicketTypeDto = {
    id: "tt-staff",
    key: "staff",
    label: "Staff",
    color: "blue",
    sort_order: 0,
    attendee_count: 1,
    created_at: "2026-01-01T00:00:00.000Z",
  };

  // createMemoryRouter + RouterProvider (not the plain <MemoryRouter> the rest of this file
  // uses) so router.navigate() can change the :eventId param in place, the same way a real
  // in-app navigation from one event's settings to another's does.
  function renderSettingsRouter(entry: string) {
    return createMemoryRouter(
      [
        { path: "/admin", element: <div>events picker</div> },
        { path: "/admin/events/:eventId/settings", element: <EventSettingsPage /> },
      ],
      { initialEntries: [entry] },
    );
  }

  it("shows the loading placeholder and drops event A's ticket types while navigating to event B", async () => {
    vi.mocked(fetchEventSettings).mockImplementation((eventId: string) =>
      Promise.resolve(eventId === "evt-1" ? activeEvent : eventB),
    );
    let resolveEventBTypes!: (types: TicketTypeDto[]) => void;
    const eventBTypes = new Promise<TicketTypeDto[]>((resolve) => {
      resolveEventBTypes = resolve;
    });
    vi.mocked(fetchTicketTypes).mockImplementation((eventId: string) =>
      eventId === "evt-1" ? Promise.resolve([vipType]) : eventBTypes,
    );

    const router = renderSettingsRouter("/admin/events/evt-1/settings?tab=ticket-types");
    renderWithToast(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("VIP")).toBeTruthy();
    });

    await router.navigate("/admin/events/evt-2/settings?tab=ticket-types");

    // The card must fall back to its first-load "Loading…" placeholder and drop event A's
    // stale row immediately on navigation, before event B's fetch has resolved.
    await waitFor(() => {
      expect(screen.getByText("Loading…")).toBeTruthy();
    });
    expect(screen.queryByDisplayValue("VIP")).toBeNull();

    resolveEventBTypes([staffType]);
    await waitFor(() => {
      expect(screen.getByDisplayValue("Staff")).toBeTruthy();
    });
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("does not show the loading placeholder or hide existing rows during a same-event background refresh (no flicker)", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    vi.mocked(fetchTicketTypes).mockResolvedValueOnce([vipType]);
    vi.mocked(updateTicketType).mockResolvedValueOnce({ ...vipType, label: "VIP Gold" });
    let resolveRefresh!: (types: TicketTypeDto[]) => void;
    const refreshPromise = new Promise<TicketTypeDto[]>((resolve) => {
      resolveRefresh = resolve;
    });

    renderSettings("/admin/events/evt-1/settings?tab=ticket-types");
    await waitFor(() => {
      expect(screen.getByDisplayValue("VIP")).toBeTruthy();
    });
    // TicketTypeRow synchronizes its local draft from the fetched type in a passive effect.
    // Let that effect settle before changing + blurring the controlled input, otherwise a busy
    // CI worker can commit the old label between those two events.
    await act(async () => {
      await Promise.resolve();
    });

    // A background refresh only ever follows a successful color/label edit (TicketTypesCard's
    // onChanged) — queue it as the next fetchTicketTypes resolution before triggering that edit.
    vi.mocked(fetchTicketTypes).mockImplementationOnce(() => refreshPromise);

    const input = screen.getByDisplayValue("VIP") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "VIP Gold" } });
    await waitFor(() => {
      expect(input.value).toBe("VIP Gold");
    });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(updateTicketType).toHaveBeenCalledWith("evt-1", "tt-vip", { label: "VIP Gold" });
    });
    await waitFor(() => {
      expect(vi.mocked(fetchTicketTypes).mock.calls).toHaveLength(2);
    });

    // The background refresh must not blank the card out while it's in flight.
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(screen.getByDisplayValue("VIP Gold")).toBeTruthy();

    resolveRefresh([{ ...vipType, label: "VIP Gold" }]);
    await waitFor(() => {
      expect(screen.getByDisplayValue("VIP Gold")).toBeTruthy();
    });
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("clears the previous event's stale ticket types when the new event's fetch fails", async () => {
    vi.mocked(fetchEventSettings).mockImplementation((eventId: string) =>
      Promise.resolve(eventId === "evt-1" ? activeEvent : eventB),
    );
    vi.mocked(fetchTicketTypes).mockImplementation((eventId: string) =>
      eventId === "evt-1" ? Promise.resolve([vipType]) : Promise.reject(new Error("network error")),
    );

    const router = renderSettingsRouter("/admin/events/evt-1/settings?tab=ticket-types");
    renderWithToast(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("VIP")).toBeTruthy();
    });

    await router.navigate("/admin/events/evt-2/settings?tab=ticket-types");

    expect(await screen.findByText("Could not load ticket types")).toBeTruthy();
    expect(screen.queryByDisplayValue("VIP")).toBeNull();
  });
});
