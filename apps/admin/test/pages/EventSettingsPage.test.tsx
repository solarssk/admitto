// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider } from "react-router/dom";
import { createMemoryRouter, MemoryRouter, Outlet, Route, Routes } from "react-router";
import { resolveAppleMapsUrl, resolveGoogleMapsUrl } from "@admitto/location";
import { EventSettingsPage } from "../../src/pages/EventSettingsPage.js";
import { mockMatchMedia, renderWithToast } from "../test-utils.js";
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
    fetchEventBounceIngestSettings: vi.fn(),
    saveEventBounceIngestSettings: vi.fn(),
    fetchEventLocation: vi.fn(),
    fetchMapTileConfig: vi.fn(),
    saveEventLocation: vi.fn(),
    searchGeocoding: vi.fn(),
    reverseGeocoding: vi.fn(),
    fetchTimezoneForCoordinates: vi.fn(),
    testWalletConnection: vi.fn(),
    fetchWalletPushHistory: vi.fn(),
  };
});

vi.mock("../../src/settings/MapPicker.js", () => ({
  MapPicker: () => <div data-testid="map-picker" />,
}));

vi.mock("../../src/components/crop/CropImageModal.js", () => ({
  CropImageModal: ({
    open,
    onApply,
    onCancel,
  }: {
    open: boolean;
    onApply: (
      blob: Blob,
      meta: { crop: { unit: "%"; x: number; y: number; width: number; height: number }; zoom: number },
    ) => void | Promise<void>;
    onCancel: () => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="Adjust image">
        <button
          type="button"
          onClick={() =>
            void onApply(new Blob(["x"], { type: "image/png" }), {
              crop: { unit: "%", x: 4, y: 4, width: 92, height: 92 },
              zoom: 1.25,
            })
          }
        >
          Apply changes
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    ) : null,
}));

import {
  archiveEvent,
  deleteEvent,
  fetchEventImageAssets,
  fetchEventMailSettings,
  fetchEventBounceIngestSettings,
  saveEventBounceIngestSettings,
  fetchEventLocation,
  fetchEventSettings,
  fetchTicketTypes,
  fetchMapTileConfig,
  fetchTimezoneForCoordinates,
  patchEvent,
  revokeAllCheckIns,
  revokeAllItemsIssued,
  reverseGeocoding,
  saveEventLocation,
  searchGeocoding,
  testWalletConnection,
  unarchiveEvent,
  updateTicketType,
  uploadEventBrandingFile,
  fetchWalletPushHistory,
} from "../../src/api/client.js";
import type {
  EventBounceIngestSettingsResponse,
  EventLocationDto,
  EventMailSettingsResponse,
  MailSettingsFieldsDto,
  MapTileConfigDto,
} from "../../src/api/types.js";
import { ARCHIVED_ACTION_TOOLTIP } from "../../src/components/ArchivedGuard.js";
import { formatUtcDateTime } from "../../src/utils/event-dates.js";

const activeEvent = {
  id: "evt-1",
  title: "Summit",
  slug: "summit",
  date: "2026-06-01",
  timezone: "Europe/Warsaw",
  capacity: 100,
  status: "active" as const,
  archived_at: null as string | null,
  created_at: "2026-01-15T00:00:00.000Z",
  is_deletable: false,
  deletion_blockers: ["attendees"] as string[],
  admitted_count: 0,
  issued_items_count: 0,
  organization_name: "Org",
  active_items: [] as Array<{ id: string; name: string; enabled: boolean }>,
  logo_url: null,
  logo_original_url: null,
  logo_crop: null,
  header_image_url: null,
  resolved_logo_url: null,
  resolved_header_image_url: null,
  wallet_enabled: false,
  wallet_template_id: null as string | null,
  wallet_api_key: { configured: false },
  wallet_apple_enabled: false,
  wallet_google_enabled: false,
  wallet_semantic_tags_enabled: false,
  wallet_field_mapping: null as Record<string, string> | null,
};

const archivedEvent = {
  ...activeEvent,
  id: "evt-2",
  status: "archived" as const,
  archived_at: "2026-01-01T00:00:00.000Z",
  capacity: null,
};

const emptyLocation: EventLocationDto = {
  venue_name: null,
  formatted_address: null,
  latitude: null,
  longitude: null,
  map_zoom: 15,
  directions_text: null,
  accessibility_text: null,
  geocoding_provider: null,
  geocoded_at: null,
  address_components: null,
  google_maps_url_override: null,
  apple_maps_url_override: null,
};

const mapTileConfig: MapTileConfigDto = {
  enabled: true,
  tile_url: "https://tile.example/{z}/{x}/{y}.png",
  attribution: "© OpenStreetMap contributors",
  max_zoom: 19,
  contact_configured: true,
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

/** Same fixture but already saved as this event's own dedicated override, so the Mailing
 * tab's toggle opens on "Dedicated" — used to dirty the draft by switching
 * back to "Organization" without having to fill out a full SMTP/Graph form. */
function dedicatedMailSettingsResponse(): EventMailSettingsResponse {
  return { ...inheritedMailSettingsResponse(), hasEventOverride: true };
}

function emptyBounceIngestSettingsResponse(): EventBounceIngestSettingsResponse {
  return {
    eventId: "evt-1",
    organizationId: "org-1",
    configured: false,
    enabled: false,
    imap_host: null,
    imap_port: null,
    imap_username: null,
    imap_password: { set: false, masked: null },
    reuse_smtp_credentials: false,
    smtp_reuse_available: false,
    folders: ["INBOX", "Junk Email"],
    poll_interval_minutes: 5,
    lastRun: null,
    recentRuns: [],
  };
}

beforeEach(() => {
  // The ticket-type staleness tests queue one-off mock implementations. Resetting them before
  // every test prevents an unconsumed async response in a failed test from affecting the next one.
  vi.resetAllMocks();
  // ScrollFadeTabs (wrapping this page's own tab strip) scrolls its active tab into view on
  // mount/change - jsdom does not implement scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
  // The Images tab also mounts EventImageAssetLibrary, which fetches its own list on mount.
  // Default to an empty library so tests that don't care about it never hit a real network
  // call (jsdom's `fetch` is real, not auto-mocked) or leak an unresolved promise into the
  // next test.
  vi.mocked(fetchEventImageAssets).mockResolvedValue([]);
  vi.mocked(fetchTicketTypes).mockResolvedValue([]);
  vi.mocked(fetchEventMailSettings).mockResolvedValue(inheritedMailSettingsResponse());
  vi.mocked(fetchEventBounceIngestSettings).mockResolvedValue(emptyBounceIngestSettingsResponse());
  vi.mocked(saveEventBounceIngestSettings).mockImplementation(async (_eventId, body) => ({
    ...emptyBounceIngestSettingsResponse(),
    ...body,
    configured: Boolean(body.imap_host),
    imap_password: { set: Boolean(body.imap_password), masked: body.imap_password ? "••••" : null },
    folders: body.folders ?? ["INBOX", "Junk Email"],
    poll_interval_minutes: body.poll_interval_minutes ?? 5,
    enabled: body.enabled ?? false,
    imap_host: body.imap_host ?? null,
    imap_port: body.imap_port ?? 993,
    imap_username: body.imap_username ?? null,
    reuse_smtp_credentials: body.reuse_smtp_credentials ?? false,
  }));
  vi.mocked(fetchEventLocation).mockResolvedValue(emptyLocation);
  vi.mocked(fetchMapTileConfig).mockResolvedValue(mapTileConfig);
  vi.mocked(saveEventLocation).mockResolvedValue(emptyLocation);
  vi.mocked(searchGeocoding).mockResolvedValue({ results: [], contact_configured: true });
  vi.mocked(reverseGeocoding).mockResolvedValue({ result: null, contact_configured: true });
  vi.mocked(fetchTimezoneForCoordinates).mockResolvedValue({ timezone: null });
  vi.mocked(fetchWalletPushHistory).mockResolvedValue([]);
  mockBlocker = { state: "unblocked", proceed: vi.fn(), reset: vi.fn() };
  // window.matchMedia isn't implemented by jsdom; default to desktop so any component on
  // this page relying on useIsDesktop() (elsewhere in the app, not this page's Save button)
  // gets a stable result instead of throwing.
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  mockAssignments = superadminAssignments;
});

function renderSettings(
  entry = "/admin/events/evt-1/settings",
  outletContext?: { refreshEvent?: () => Promise<void> },
) {
  function SettingsWithOutlet() {
    return (
      <Outlet context={outletContext} />
    );
  }
  renderWithToast(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/admin" element={<div>events picker</div>} />
        <Route path="/admin/events/:eventId/overview" element={<div>event overview</div>} />
        {outletContext ? (
          <Route path="/admin/events/:eventId" element={<SettingsWithOutlet />}>
            <Route path="settings" element={<EventSettingsPage />} />
          </Route>
        ) : (
          <Route path="/admin/events/:eventId/settings" element={<EventSettingsPage />} />
        )}
      </Routes>
    </MemoryRouter>,
  );
}

describe("EventSettingsPage save label", () => {
  it("uses the same Save label regardless of viewport", async () => {
    mockMatchMedia(false);
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();

    expect(await screen.findByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
  });

  it("shows Missing event when the route has no eventId param", () => {
    renderWithToast(
      <MemoryRouter initialEntries={["/admin/events/settings"]}>
        <Routes>
          <Route path="/admin/events/settings" element={<EventSettingsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Missing event.")).toBeTruthy();
  });
});

describe("EventSettingsPage subtitle", () => {
  const SUBTITLE = "Manage event details, images, and access.";

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
    expect(
      screen.getByText("When the event takes place. Times and reports use the timezone below."),
    ).toBeTruthy();
    const schedule = screen.getByText("Event hours (start)").closest(".settings-event-schedule");
    expect(schedule).not.toBeNull();
    expect(screen.getByText("Event timezone").closest(".settings-event-schedule")).toBe(schedule);
    expect(screen.getByLabelText("Event hours (end)").closest(".time-input")?.classList).toContain(
      "time-input--picker-end",
    );
    const titleInput = screen.getByLabelText("Event title") as HTMLInputElement;
    expect(titleInput.getAttribute("data-bwignore")).toBe("true");
    expect(titleInput.getAttribute("data-1p-ignore")).toBe("true");
    expect(titleInput.getAttribute("autocomplete")).toBe("off");
  });

  it("saves the event hours range through the event patch", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    vi.mocked(patchEvent).mockResolvedValueOnce({
      event: { ...activeEvent, event_hours_start: "18:00", event_hours_end: "22:00" },
    });
    renderSettings();
    await screen.findByLabelText("Event title");

    fireEvent.change(screen.getByLabelText("Event hours (start)"), {
      target: { value: "18:00" },
    });
    fireEvent.blur(screen.getByLabelText("Event hours (start)"));
    fireEvent.change(screen.getByLabelText("Event hours (end)"), {
      target: { value: "22:00" },
    });
    fireEvent.blur(screen.getByLabelText("Event hours (end)"));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(patchEvent).toHaveBeenCalledWith("evt-1", {
        event_hours_start: "18:00",
        event_hours_end: "22:00",
      });
    });
  });

  it("clears a previously-set event hours range to null", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      event_hours_start: "18:00",
      event_hours_end: "22:00",
    });
    vi.mocked(patchEvent).mockResolvedValueOnce({
      event: { ...activeEvent, event_hours_start: null, event_hours_end: null },
    });
    renderSettings();
    await screen.findByLabelText("Event title");

    fireEvent.change(screen.getByLabelText("Event hours (start)"), { target: { value: "" } });
    fireEvent.blur(screen.getByLabelText("Event hours (start)"));
    fireEvent.change(screen.getByLabelText("Event hours (end)"), { target: { value: "" } });
    fireEvent.blur(screen.getByLabelText("Event hours (end)"));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(patchEvent).toHaveBeenCalledWith("evt-1", {
        event_hours_start: null,
        event_hours_end: null,
      });
    });
  });

  it("deep links to Location and keeps venue guidance out of Basic information", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings("/admin/events/evt-1/settings?tab=location");

    expect(await screen.findByLabelText("Address details")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Location" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.queryByRole("button", { name: "Find on map" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "General" }));
    await screen.findByText("Basic information");
    const basicInformationHint = screen.getByText("Basic information").closest(".at-tooltip-trigger");
    fireEvent.mouseEnter(basicInformationHint!);
    expect(screen.getByRole("tooltip").textContent).toBe(
      "Title, date, capacity, and timezone.",
    );
  });

  it("applies the suggested location timezone through the event patch", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    vi.mocked(fetchEventLocation).mockResolvedValueOnce({
      ...emptyLocation,
      latitude: 40.7128,
      longitude: -74.006,
      venue_name: "New York Hall",
    });
    vi.mocked(fetchTimezoneForCoordinates).mockResolvedValueOnce({ timezone: "America/New_York" });
    vi.mocked(patchEvent).mockResolvedValueOnce({
      event: { ...activeEvent, timezone: "America/New_York" },
    });
    const refreshEvent = vi.fn().mockResolvedValue(undefined);
    renderSettings("/admin/events/evt-1/settings?tab=location", { refreshEvent });

    fireEvent.click(await screen.findByRole("button", { name: "Use" }));

    await waitFor(() =>
      expect(patchEvent).toHaveBeenCalledWith("evt-1", { timezone: "America/New_York" }),
    );
    expect(await screen.findByText("Event timezone set to America/New_York.")).toBeTruthy();
    await waitFor(() => expect(refreshEvent).toHaveBeenCalled());
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

  it("switches to the Images tab and shows event logo + image library", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Images" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("tab", { name: "Images" }));
    expect(await screen.findByText("Event logo")).toBeTruthy();
    expect(screen.getByText("Drop logo here or click to browse")).toBeTruthy();
    expect(screen.getByText("Upload images")).toBeTruthy();
    expect(screen.getByText("Your images")).toBeTruthy();
    expect(await screen.findByText("No images yet")).toBeTruthy();
    expect(
      screen.getByText(/leave blank to use the organization's logo/),
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

  it("shows the image asset library for a non-superadmin org admin", async () => {
    mockAssignments = orgAdminAssignments;
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Images" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("tab", { name: "Images" }));
    expect(await screen.findByText("Event logo")).toBeTruthy();
    expect(screen.getByText("Drop logo here or click to browse")).toBeTruthy();
    expect(screen.getByText("Upload images")).toBeTruthy();
    expect(screen.queryByText("Superadmin only")).toBeNull();
    await waitFor(() => {
      expect(fetchEventImageAssets).toHaveBeenCalledWith("evt-1", expect.any(AbortSignal));
    });
  });

  it("uploads a branding file through the event-scoped upload endpoint", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    vi.mocked(uploadEventBrandingFile)
      .mockResolvedValueOnce({ url: "/uploads/default/logo-original.png" })
      .mockResolvedValueOnce({ url: "/uploads/default/logo.png" });
    renderSettings();
    await screen.findByRole("tab", { name: "Images" });
    fireEvent.click(screen.getByRole("tab", { name: "Images" }));
    await screen.findByText("Event logo");

    const fileInputs = document.querySelectorAll('.logo-upload input[type="file"]');
    expect(fileInputs).toHaveLength(1);
    const file = new File(["x"], "logo.png", { type: "image/png" });
    fireEvent.change(fileInputs[0]!, { target: { files: [file] } });
    fireEvent.click(await screen.findByRole("button", { name: "Apply changes" }));

    await waitFor(() => {
      expect(uploadEventBrandingFile).toHaveBeenCalledTimes(2);
      expect(uploadEventBrandingFile).toHaveBeenCalledWith("evt-1", expect.any(FormData));
    });
  });

  it("disables Save while a branding upload is in flight, even if another field is already dirty", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    let resolveOriginal!: (result: { url: string }) => void;
    vi.mocked(uploadEventBrandingFile)
      .mockReturnValueOnce(new Promise((resolve) => (resolveOriginal = resolve)))
      .mockResolvedValueOnce({ url: "/uploads/default/logo.png" });
    renderSettings();
    await screen.findByLabelText("Event title");

    // Dirty the page via an unrelated field first — this is what makes the button
    // enabled-except-for-upload-state observable (it isn't just `!dirty` gating it).
    fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "Summit 2027" } });
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(
      false,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Images" }));
    await screen.findByText("Event logo");
    const [logoInput] = document.querySelectorAll('.logo-upload input[type="file"]');
    fireEvent.change(logoInput!, {
      target: { files: [new File(["x"], "logo.png", { type: "image/png" })] },
    });

    // Pre-crop original upload is in flight before the modal opens.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Uploading…" }).hasAttribute("disabled")).toBe(
        true,
      );
    });

    resolveOriginal({ url: "/uploads/default/logo-original.png" });
    fireEvent.click(await screen.findByRole("button", { name: "Apply changes" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(
        false,
      );
    });
  });

  it("saves the logo field after uploading, sending the patch payload", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    vi.mocked(uploadEventBrandingFile)
      .mockResolvedValueOnce({ url: "/uploads/default/logo-original.png" })
      .mockResolvedValueOnce({ url: "/uploads/default/logo.png" });
    vi.mocked(patchEvent).mockResolvedValueOnce({
      event: {
        ...activeEvent,
        logo_url: "/uploads/default/logo.png",
        logo_original_url: "/uploads/default/logo-original.png",
        logo_crop: { unit: "%", x: 4, y: 4, width: 92, height: 92, zoom: 1.25 },
      },
    });
    renderSettings();
    await screen.findByRole("tab", { name: "Images" });
    fireEvent.click(screen.getByRole("tab", { name: "Images" }));
    await screen.findByText("Event logo");

    const [logoInput] = document.querySelectorAll('.logo-upload input[type="file"]');
    fireEvent.change(logoInput!, {
      target: { files: [new File(["x"], "logo.png", { type: "image/png" })] },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Apply changes" }));
    await screen.findByAltText("Event logo preview");

    // The alt-text preview and the Save button's label flip in separate React commits
    // (the button label only updates once LogoUploadZone's onUploadingChange effect fires
    // one tick later) — wait for the button itself rather than assuming it's already there.
    const saveButton = await screen.findByRole("button", { name: "Save" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(patchEvent).toHaveBeenCalledWith("evt-1", {
        logo_url: "/uploads/default/logo.png",
        logo_original_url: "/uploads/default/logo-original.png",
        logo_crop: { unit: "%", x: 4, y: 4, width: 92, height: 92, zoom: 1.25 },
      });
    });
  });

  it("disables branding upload zones when the event is archived", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(archivedEvent);
    renderSettings("/admin/events/evt-2/settings");
    await screen.findByRole("tab", { name: "Images" });
    fireEvent.click(screen.getByRole("tab", { name: "Images" }));
    await screen.findByText("Event logo");

    const fileInputs = document.querySelectorAll('.logo-upload input[type="file"]');
    expect(fileInputs).toHaveLength(1);
    for (const input of fileInputs) {
      expect((input as HTMLInputElement).disabled).toBe(true);
    }
    expect(screen.getByText("This event is archived - images cannot be changed.")).toBeTruthy();

    await screen.findByText("No images yet");
    const assetFileInput = document.querySelector(
      ".image-asset-library__file-input",
    ) as HTMLInputElement;
    expect(assetFileInput.disabled).toBe(true);
    expect(
      screen.getByText("This event is archived - the image library cannot be changed."),
    ).toBeTruthy();
  });

  it("switches to the Wallet tab and shows the Template ID field", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();
    await screen.findByRole("tab", { name: "Wallet" });
    fireEvent.click(screen.getByRole("tab", { name: "Wallet" }));
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });
  });

  it("shows wallet push history rows once fetched", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    vi.mocked(fetchWalletPushHistory).mockResolvedValueOnce([
      {
        id: "job-1",
        created_at: "2026-06-07T10:00:00.000Z",
        reissued: 3,
        skipped: 1,
        errored: 0,
        status: "succeeded",
        error: null,
      },
      {
        id: "job-2",
        created_at: "2026-06-06T10:00:00.000Z",
        reissued: 0,
        skipped: 0,
        errored: 2,
        status: "failed",
        error: "provider outage",
      },
    ]);
    renderSettings("/admin/events/evt-1/settings?tab=wallet");

    expect(await screen.findByText("Succeeded")).toBeTruthy();
    expect(screen.getByText("provider outage")).toBeTruthy();
    expect(fetchWalletPushHistory).toHaveBeenCalledWith("evt-1", expect.anything());
  });

  it("shows an error and retries wallet push history on demand", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    vi.mocked(fetchWalletPushHistory).mockRejectedValueOnce(new Error("network down"));
    renderSettings("/admin/events/evt-1/settings?tab=wallet");

    expect(await screen.findByText("Could not load wallet push history")).toBeTruthy();

    vi.mocked(fetchWalletPushHistory).mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.queryByText("Could not load wallet push history")).toBeNull();
    });
    expect(await screen.findByText("No wallet pushes yet")).toBeTruthy();
  });

  it("re-fetches wallet push history every time the admin returns to the Wallet tab (bot review)", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    vi.mocked(fetchWalletPushHistory)
      .mockResolvedValueOnce([
        {
          id: "job-1",
          created_at: "2026-06-07T10:00:00.000Z",
          reissued: 1,
          skipped: 0,
          errored: 0,
          status: "succeeded",
          error: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "job-2",
          created_at: "2026-06-08T10:00:00.000Z",
          reissued: 2,
          skipped: 0,
          errored: 0,
          status: "succeeded",
          error: null,
        },
      ]);
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => expect(fetchWalletPushHistory).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("tab", { name: "General" }));
    fireEvent.click(screen.getByRole("tab", { name: "Wallet" }));

    // Proves the effect is keyed on the active tab (re-fetches on every visit), not on mount
    // alone - a future simplification that drops that dependency would leave the list stale
    // after a background push runs elsewhere, and this is the only test that would catch it.
    await waitFor(() => expect(fetchWalletPushHistory).toHaveBeenCalledTimes(2));
  });

  it("shows Loading… while wallet push history is in flight, then clears it", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    let resolveHistory!: (items: never[]) => void;
    vi.mocked(fetchWalletPushHistory).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveHistory = resolve;
      }),
    );
    renderSettings("/admin/events/evt-1/settings?tab=wallet");

    expect(await screen.findByText("Loading…")).toBeTruthy();

    resolveHistory([]);

    await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
    expect(await screen.findByText("No wallet pushes yet")).toBeTruthy();
  });

  it("saves the wallet Template ID through the event patch", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    vi.mocked(patchEvent).mockResolvedValueOnce({
      event: { ...activeEvent, wallet_template_id: "tmpl-1" },
    });
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });

    fireEvent.change(document.getElementById("event-wallet-template-id") as HTMLInputElement, {
      target: { value: "tmpl-1" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(patchEvent).toHaveBeenCalledWith("evt-1", { wallet_template_id: "tmpl-1" });
    });
  });

  it("clears the wallet Template ID through the event patch", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      wallet_template_id: "tmpl-existing",
    });
    vi.mocked(patchEvent).mockResolvedValueOnce({
      event: { ...activeEvent, wallet_template_id: null },
    });
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });

    fireEvent.change(document.getElementById("event-wallet-template-id") as HTMLInputElement, {
      target: { value: "" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(patchEvent).toHaveBeenCalledWith("evt-1", { wallet_template_id: null });
    });
  });

  it("shows the provider selector and Apple/Google toggles on the Wallet tab", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });

    expect(screen.getByText("PassCreator")).toBeTruthy();
    expect(screen.getByLabelText("Apple Wallet")).toBeTruthy();
    expect(screen.getByLabelText("Google Wallet")).toBeTruthy();
    expect(screen.getByLabelText("Semantic tags")).toBeTruthy();
    expect((screen.getByLabelText("Samsung Wallet") as HTMLInputElement).disabled).toBe(true);
  });

  it("disables the Semantic tags switch while Apple Wallet is off, and enables it once Apple Wallet is on", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({ ...activeEvent, wallet_apple_enabled: false });
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });

    expect((screen.getByLabelText("Semantic tags") as HTMLInputElement).disabled).toBe(true);

    fireEvent.click(screen.getByLabelText("Apple Wallet"));
    expect((screen.getByLabelText("Semantic tags") as HTMLInputElement).disabled).toBe(false);
  });

  it("saves the semantic tags toggle through the event patch", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      wallet_apple_enabled: true,
      wallet_semantic_tags_enabled: false,
    });
    vi.mocked(patchEvent).mockResolvedValueOnce({
      event: { ...activeEvent, wallet_apple_enabled: true, wallet_semantic_tags_enabled: true },
    });
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText("Semantic tags"));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(patchEvent).toHaveBeenCalledWith("evt-1", { wallet_semantic_tags_enabled: true });
    });
  });

  it("saves the wallet API key and platform toggles through the event patch", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      wallet_apple_enabled: true,
      wallet_google_enabled: true,
    });
    vi.mocked(patchEvent).mockResolvedValueOnce({
      event: { ...activeEvent, wallet_api_key: { configured: true }, wallet_apple_enabled: false },
    });
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "pc-secret" } });
    fireEvent.click(screen.getByLabelText("Apple Wallet"));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(patchEvent).toHaveBeenCalledWith("evt-1", {
        wallet_api_key: "pc-secret",
        wallet_apple_enabled: false,
      });
    });
  });

  it("saves the master Wallet toggle, Google Wallet toggle, and a cleared API key", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      wallet_enabled: true,
      wallet_google_enabled: true,
      wallet_api_key: { configured: true },
    });
    vi.mocked(patchEvent).mockResolvedValueOnce({
      event: { ...activeEvent, wallet_enabled: false, wallet_google_enabled: false },
    });
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });

    fireEvent.click(document.getElementById("event-wallet-enabled") as HTMLInputElement);
    fireEvent.click(screen.getByLabelText("Google Wallet"));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(patchEvent).toHaveBeenCalledWith("evt-1", {
        wallet_enabled: false,
        wallet_google_enabled: false,
        wallet_api_key: null,
      });
    });
  });

  it("adds, edits, and removes a field mapping row, saving the resulting mapping", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    vi.mocked(patchEvent).mockResolvedValueOnce({
      event: { ...activeEvent, wallet_field_mapping: { attendeeFullName: "full_name" } },
    });
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    const twoKeyInputs = screen.getAllByLabelText("PassCreator field key");
    expect(twoKeyInputs).toHaveLength(2);

    // Editing the first row's key and value while a second row exists confirms the second row
    // stays untouched (the update targets its own index, not every row in the mapping array).
    fireEvent.click(screen.getAllByRole("button", { name: "Value, none selected" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Attendee full name" }));
    expect(screen.getAllByRole("button", { name: "Value, none selected" })).toHaveLength(1);

    fireEvent.change(twoKeyInputs[0]!, { target: { value: "attendeeFullName" } });
    expect((twoKeyInputs[1] as HTMLInputElement).value).toBe("");

    fireEvent.click(screen.getAllByRole("button", { name: "Remove field" })[1]!);
    const keyInputs = screen.getAllByLabelText("PassCreator field key");
    expect(keyInputs).toHaveLength(1);
    expect((keyInputs[0] as HTMLInputElement).value).toBe("attendeeFullName");

    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(patchEvent).toHaveBeenCalledWith("evt-1", {
        wallet_field_mapping: { attendeeFullName: "full_name" },
      });
    });
  });

  it("shows the returned message on a successful Test connection", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      wallet_template_id: "tmpl-1",
    });
    vi.mocked(testWalletConnection).mockResolvedValueOnce({
      ok: true,
      message: 'Connected - template "Gala Pass".',
    });
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => {
      expect(testWalletConnection).toHaveBeenCalledWith("evt-1", { templateId: "tmpl-1" });
    });
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Gala Pass/);
    });
  });

  it("saves a newly added field mapping row last, regardless of where it displays", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      wallet_template_id: "tmpl-1",
      wallet_field_mapping: {
        name: "full_name",
        company: "company",
        ticketQR: "ticket_url",
        eventDate: "event_date",
        eventHours: "event_hours",
        ticketType: "ticket_type",
        eventLocation: "event_location",
      },
    });
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    const valueButtons = screen.getAllByRole("button", { name: "Value, none selected" });
    expect(valueButtons).toHaveLength(1);
    fireEvent.click(valueButtons[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Event name" }));

    // Rows display grouped by category (event_name sorts among the other event fields, not at
    // the DOM's tail), so the new row's own key input is found by proximity to its now-selected
    // "Event name" trigger, not by raw position.
    const eventNameTrigger = screen.getByRole("button", { name: "Value, Event name" });
    const newRow = eventNameTrigger.closest(".wallet-field-mapping__row") as HTMLElement;
    const newRowKeyInput = within(newRow).getByLabelText("PassCreator field key");
    fireEvent.change(newRowKeyInput, { target: { value: "test" } });

    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(patchEvent).toHaveBeenCalled();
    });
    const call = vi.mocked(patchEvent).mock.calls[0]![1] as { wallet_field_mapping?: Record<string, string> };
    expect(Object.keys(call.wallet_field_mapping ?? {})).toEqual([
      "name",
      "company",
      "ticketQR",
      "eventDate",
      "eventHours",
      "ticketType",
      "eventLocation",
      "test",
    ]);
  });

  it("displays field mapping rows grouped by category, not insertion order", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      wallet_template_id: "tmpl-1",
      // Inserted ticket type, then attendee name, then event date - category order puts
      // attendee first, then event, then ticket, regardless of this insertion order.
      wallet_field_mapping: { ticketType: "ticket_type", name: "full_name", eventDate: "event_date" },
    });
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });

    const triggers = screen.getAllByRole("button", { name: /^Value, / });
    expect(triggers.map((el) => el.getAttribute("aria-label"))).toEqual([
      "Value, Attendee full name",
      "Value, Event date",
      "Value, Ticket type",
    ]);
  });

  it("excludes a value already picked by another field mapping row from the Value dropdown", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      wallet_template_id: "tmpl-1",
      wallet_field_mapping: { name: "full_name", company: "company" },
    });
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    const valueButtons = screen.getAllByRole("button", { name: "Value, none selected" });
    fireEvent.click(valueButtons[0]!);

    expect(screen.queryByRole("button", { name: "Attendee full name" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Attendee company" })).toBeNull();
    expect(screen.getByRole("button", { name: "Event name" })).toBeTruthy();
  });

  it("still shows a row's own already-selected value in its own dropdown", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      wallet_template_id: "tmpl-1",
      wallet_field_mapping: { name: "full_name", company: "company" },
    });
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Value, Attendee full name" }));
    const options = within(screen.getByRole("list", { name: "Value" })).getAllByRole("button", {
      name: "Attendee full name",
    });
    expect(options).toHaveLength(1);
  });

  it("shows a hover tooltip explaining what a field mapping row's selected value sends", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      wallet_template_id: "tmpl-1",
      wallet_field_mapping: { name: "full_name" },
    });
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });

    const trigger = screen.getByRole("button", { name: "Value, Attendee full name" });
    const row = trigger.closest(".wallet-field-mapping__row") as HTMLElement;
    const hintTrigger = row.querySelector(".wallet-field-mapping__hint") as HTMLElement;
    fireEvent.mouseEnter(hintTrigger);

    expect(screen.getByRole("tooltip").textContent).toBe("e.g. Jan Kowalski");
  });

  it("shows the event's own real value in a field mapping row's hover tooltip", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      wallet_template_id: "tmpl-1",
      wallet_field_mapping: { name: "event_name" },
    });
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });

    const trigger = screen.getByRole("button", { name: "Value, Event name" });
    const row = trigger.closest(".wallet-field-mapping__row") as HTMLElement;
    const hintTrigger = row.querySelector(".wallet-field-mapping__hint") as HTMLElement;
    fireEvent.mouseEnter(hintTrigger);

    expect(screen.getByRole("tooltip").textContent).toBe(activeEvent.title);
  });

  it("shows the event's real Location-tab values in field mapping row tooltips", async () => {
    vi.mocked(fetchEventLocation).mockResolvedValueOnce({
      ...emptyLocation,
      venue_name: "Congress Hall",
      directions_text: "Enter via the north gate.",
      accessibility_text: "Step-free access from the car park.",
      address_components: {
        object_name: "Congress Hall",
        street: "Main Street 1",
        postcode: "00-001",
        city: "Warsaw",
        region: "Mazowieckie",
        country: "Poland",
      },
    });
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      wallet_template_id: "tmpl-1",
      wallet_field_mapping: { directions: "directions_text", access: "accessibility_text", city: "city" },
    });
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });

    const hoverTooltipOf = (label: string): HTMLElement => {
      // Leave every other row's hint first - a previous hover in this same waitFor loop (or an
      // earlier hoverTooltipOf call) never got a matching mouseLeave, so without this two
      // tooltips can be open at once and getByRole("tooltip") finds more than one match.
      document
        .querySelectorAll(".wallet-field-mapping__hint")
        .forEach((el) => fireEvent.mouseLeave(el));
      const trigger = screen.getByRole("button", { name: `Value, ${label}` });
      const row = trigger.closest(".wallet-field-mapping__row") as HTMLElement;
      const hintTrigger = row.querySelector(".wallet-field-mapping__hint") as HTMLElement;
      fireEvent.mouseEnter(hintTrigger);
      return screen.getByRole("tooltip");
    };

    await waitFor(() => {
      expect(hoverTooltipOf("Directions").textContent).toBe("Enter via the north gate.");
    });
    await waitFor(() => {
      expect(hoverTooltipOf("Accessibility notes").textContent).toBe(
        "Step-free access from the car park.",
      );
    });
    await waitFor(() => {
      expect(hoverTooltipOf("City").textContent).toBe("Warsaw");
    });
  });

  it("shows a not-set fallback for location tooltips before the Location tab has anything saved", async () => {
    vi.mocked(fetchEventLocation).mockResolvedValueOnce(emptyLocation);
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      wallet_template_id: "tmpl-1",
      wallet_field_mapping: { directions: "directions_text" },
    });
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });

    const trigger = screen.getByRole("button", { name: "Value, Directions" });
    const row = trigger.closest(".wallet-field-mapping__row") as HTMLElement;
    const hintTrigger = row.querySelector(".wallet-field-mapping__hint") as HTMLElement;
    fireEvent.mouseEnter(hintTrigger);

    await waitFor(() => {
      expect(screen.getByRole("tooltip").textContent).toBe(
        "Not set for this event - this field won't be sent.",
      );
    });
  });

  it("shows the real Google/Apple Maps links in field mapping row tooltips", async () => {
    vi.mocked(fetchEventLocation).mockResolvedValueOnce({
      ...emptyLocation,
      venue_name: "Congress Hall",
      latitude: 52.2297,
      longitude: 21.0122,
    });
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      wallet_template_id: "tmpl-1",
      wallet_field_mapping: { gmaps: "google_maps_url", amaps: "apple_maps_url" },
    });
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });

    const hoverTooltipOf = (label: string): HTMLElement => {
      // Leave every other row's hint first - a previous hover in this same waitFor loop (or an
      // earlier hoverTooltipOf call) never got a matching mouseLeave, so without this two
      // tooltips can be open at once and getByRole("tooltip") finds more than one match.
      document
        .querySelectorAll(".wallet-field-mapping__hint")
        .forEach((el) => fireEvent.mouseLeave(el));
      const trigger = screen.getByRole("button", { name: `Value, ${label}` });
      const row = trigger.closest(".wallet-field-mapping__row") as HTMLElement;
      const hintTrigger = row.querySelector(".wallet-field-mapping__hint") as HTMLElement;
      fireEvent.mouseEnter(hintTrigger);
      return screen.getByRole("tooltip");
    };

    await waitFor(() => {
      expect(hoverTooltipOf("Google Maps URL").textContent).toBe(
        resolveGoogleMapsUrl(52.2297, 21.0122, "Congress Hall", null),
      );
    });
    await waitFor(() => {
      expect(hoverTooltipOf("Apple Maps URL").textContent).toBe(
        resolveAppleMapsUrl(52.2297, 21.0122, "Congress Hall", null),
      );
    });
  });

  it("falls back to the raw mapping value in the incomplete-row warning when it matches no known placeholder", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      wallet_template_id: "tmpl-1",
      // "stale_placeholder" doesn't exist in WALLET_MAPPING_PLACEHOLDERS (e.g. left over from an
      // older vocabulary) - the key is blank, so this row triggers the incomplete-row warning.
      wallet_field_mapping: { "": "stale_placeholder" } as unknown as Record<string, string>,
    });
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });

    expect(
      screen.getByText('"stale_placeholder" has no PassCreator field key - this row won\'t be saved.'),
    ).toBeTruthy();
  });

  it("warns when two field mapping rows share the same PassCreator field key", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      wallet_template_id: "tmpl-1",
      wallet_field_mapping: { company: "company", " company ": "department" },
    });
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });

    expect(
      screen.getByText('The key "company" is used by more than one row - only the last one will be saved.'),
    ).toBeTruthy();
  });

  it("keeps a field mapping row's hint icon decorative until a value is picked", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      wallet_template_id: "tmpl-1",
    });
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    const trigger = screen.getByRole("button", { name: "Value, none selected" });
    const row = trigger.closest(".wallet-field-mapping__row") as HTMLElement;
    const icon = row.querySelector(".wallet-field-mapping__hint i") as HTMLElement;

    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.hasAttribute("aria-label")).toBe(false);
  });

  it("falls back to a generic success toast when Test connection reports no message", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      wallet_template_id: "tmpl-1",
    });
    vi.mocked(testWalletConnection).mockResolvedValueOnce({ ok: true });
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Connected\./);
    });
  });

  it("falls back to a generic error toast when Test connection reports no error message", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      wallet_template_id: "tmpl-1",
    });
    vi.mocked(testWalletConnection).mockResolvedValueOnce({ ok: false });
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Could not reach PassCreator\./);
    });
  });

  it("shows the API's error message on a failed Test connection, including a replaced key", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      wallet_template_id: "tmpl-1",
    });
    vi.mocked(testWalletConnection).mockResolvedValueOnce({
      ok: false,
      error: "Invalid API key.",
    });
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "new-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => {
      expect(testWalletConnection).toHaveBeenCalledWith("evt-1", {
        templateId: "tmpl-1",
        apiKey: "new-key",
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Invalid API key/);
    });
  });

  it("shows a fallback toast when Test connection throws, and Cancel discards an in-progress key edit", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      wallet_template_id: "tmpl-1",
    });
    vi.mocked(testWalletConnection).mockRejectedValueOnce(new Error("network down"));
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(
        /Could not test the wallet connection/,
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "abandoned" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Set" })).toBeTruthy();
  });

  it("does not flag unsaved changes from clicking Set on the API key alone (no value typed)", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    expect(screen.queryByText("Unsaved changes")).toBeNull();

    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "real-value" } });
    expect(await screen.findByText("Unsaved changes")).toBeTruthy();
  });

  it("blocks Test connection with a clear message while the API key is queued for clearing", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      wallet_template_id: "tmpl-1",
      wallet_api_key: { configured: true },
    });
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(
        /API key will be cleared on save/,
      );
    });
    expect(testWalletConnection).not.toHaveBeenCalled();
  });

  it("disables Test connection on an archived event", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...archivedEvent,
      wallet_template_id: "tmpl-1",
    });
    renderSettings("/admin/events/evt-2/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });

    expect(screen.getByRole("button", { name: "Test connection" }).hasAttribute("disabled")).toBe(
      true,
    );
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
    fireEvent.click(within(dialog).getByRole("button", { name: "Unarchive" }));

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
    await screen.findByRole("radio", { name: "Organization" });

    // Dirty the mail draft without saving it.
    fireEvent.click(screen.getByRole("radio", { name: "Dedicated" }));
    expect(
      screen.getByRole("radio", { name: "Dedicated" }).getAttribute("aria-checked"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("tab", { name: "Danger zone" }));
    fireEvent.click(await screen.findByRole("button", { name: /Archive event/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(archiveEvent).toHaveBeenCalledWith("evt-1"));
    // The card remounted and re-fetched — proof its old in-memory draft was discarded
    // rather than silently surviving the "this will be lost" warning.
    await waitFor(() => expect(fetchEventMailSettings).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("tab", { name: "Mailing" }));
    await waitFor(() => {
      expect(
        screen.getByRole("radio", { name: "Organization" }).getAttribute("aria-checked"),
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
    expect(notice?.classList.contains("at-notice--error")).toBe(true);
    expect(notice?.textContent).toMatch(/These actions can affect this event's data/);
    expect(document.querySelector(".danger-zone-panel")?.contains(notice)).toBe(false);
  });

  it("deep links directly into a non-default tab via ?tab=", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings("/admin/events/evt-1/settings?tab=wallet");
    await waitFor(() => {
      expect(document.getElementById("event-wallet-template-id")).toBeTruthy();
    });
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
      await screen.findByText("Event API connections are on the roadmap"),
    ).toBeTruthy();
    expect(
      screen.getByText(/Connect external systems to push attendee data into this event automatically/),
    ).toBeTruthy();
    expect(screen.queryByText(/Maps and weather/)).toBeNull();
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
    expect(screen.queryByText("Event API connections are on the roadmap")).toBeNull();
  });
});

describe("EventSettingsPage Mailing tab (superadmin-only)", () => {
  it("shows the Mailing tab for superadmin", async () => {
    mockAssignments = superadminAssignments;
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();
    await screen.findByRole("tab", { name: "Mailing" });
    fireEvent.click(screen.getByRole("tab", { name: "Mailing" }));
    expect(await screen.findByRole("radio", { name: "Organization" })).toBeTruthy();
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
    expect(screen.queryByRole("radio", { name: "Organization" })).toBeNull();
  });
});

describe("EventSettingsPage Mail tab — one shared Save/Reset for transport + bounce", () => {
  // Regression coverage: the Mail tab used to render a Save/Reset footer inside
  // EventMailSettingsCard *in addition to* a hoisted page-header Save button — two ways to
  // save the same form. Bounce detection later added a second footer. The pair now lives
  // exactly once, at the bottom of the Mail tab (transport + bounce share it) — the page
  // header has no per-tab Save/Reset at all. The "Organization" / "Dedicated" mode toggle
  // lives in the card's header instead (moved there from the card body).
  async function openMailTab() {
    await screen.findByRole("tab", { name: "Mailing" });
    fireEvent.click(screen.getByRole("tab", { name: "Mailing" }));
    await screen.findByRole("radio", { name: "Organization" });
  }

  it("shows exactly one Save button and one Reset button", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();
    await openMailTab();

    expect(screen.getAllByRole("button", { name: "Save" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Reset" })).toHaveLength(1);
  });

  it("shows an Unsaved changes indicator only once the mail draft is dirty", async () => {
    // Matches the instance-level Mail transport panel's own SettingsFooter (shared
    // component) — Save/Reset stay clickable throughout, "Unsaved changes" is the signal.
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();
    await openMailTab();

    expect(screen.queryByText("Unsaved changes")).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Dedicated" }));

    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("clicking the Mail tab Save button drives the mail card's own save flow", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    vi.mocked(fetchEventMailSettings).mockResolvedValue(dedicatedMailSettingsResponse());
    renderSettings();
    await openMailTab();
    expect(
      screen.getByRole("radio", { name: "Dedicated" }).getAttribute("aria-checked"),
    ).toBe("true");

    // Switching back to "Organization" is destructive (drops the dedicated override),
    // so saving it goes through EventMailSettingsCard's own ConfirmDialog rather than an
    // immediate save.
    fireEvent.click(screen.getByRole("radio", { name: "Organization" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/Revert to organization mail/)).toBeTruthy();
  });

  it("does not open Revert when saving bounce-only edits while already on organization mail", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();
    await openMailTab();
    await screen.findByText("Bounce detection");

    fireEvent.change(screen.getByLabelText("IMAP host"), {
      target: { value: "imap.example.com" },
    });
    expect(screen.getByText("Unsaved changes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveEventBounceIngestSettings).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/Revert to organization mail/)).toBeNull();
  });

  it("still saves bounce when mail Save opens Revert confirm", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    vi.mocked(fetchEventMailSettings).mockResolvedValue(dedicatedMailSettingsResponse());
    renderSettings();
    await openMailTab();
    await screen.findByText("Bounce detection");

    fireEvent.click(screen.getByRole("radio", { name: "Organization" }));
    fireEvent.change(screen.getByLabelText("IMAP host"), {
      target: { value: "imap.example.com" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/Revert to organization mail/)).toBeTruthy();
    await waitFor(() => expect(saveEventBounceIngestSettings).toHaveBeenCalled());
  });

  it("does not open Revert when Save is clicked with nothing dirty on organization mail", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();
    await openMailTab();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/Revert to organization mail/)).toBeNull();
    expect(saveEventBounceIngestSettings).not.toHaveBeenCalled();
  });

  it("clicking the Mail tab Reset button reverts the mail draft", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();
    await openMailTab();

    fireEvent.click(screen.getByRole("radio", { name: "Dedicated" }));
    expect(
      screen.getByRole("radio", { name: "Dedicated" }).getAttribute("aria-checked"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(
      screen.getByRole("radio", { name: "Organization" }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("keeps the General tab's own Save/Reset footer unaffected by the Mail draft", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    renderSettings();
    await screen.findByLabelText("Event title");

    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
    expect(screen.queryByText(/Unsaved changes/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "Summit 2" } });
    expect(screen.getByText(/Unsaved changes/)).toBeTruthy();
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
      deletion_blockers: ["attendees", "pinned_note"],
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
      "Still blocking delete: attendees, pinned note.",
    );
    const deleteItem = button.closest(".danger-zone__item");
    expect(deleteItem?.querySelector(".danger-zone__desc")?.textContent).toBe(
      "Still blocking delete: attendees, pinned note.",
    );
  });

  it("renders Delete event enabled for a superadmin on an active, empty event", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      is_deletable: true,
      deletion_blockers: [],
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
      deletion_blockers: ["custom_items", "contacts"],
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
      "Still blocking delete: custom items, contacts.",
    );
    const deleteItem = button.closest(".danger-zone__item");
    expect(deleteItem?.querySelector(".danger-zone__desc")?.textContent).toBe(
      "Still blocking delete: custom items, contacts.",
    );
  });

  it("falls back to generic delete copy when not deletable without named blockers", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      is_deletable: false,
      deletion_blockers: [],
    });
    renderSettings();
    await openDangerZone();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Delete event/ })).toBeTruthy();
    });
    const button = screen.getByRole("button", { name: /Delete event/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const fallback =
      "This event still has content that must be cleared before it can be permanently deleted.";
    const describedBy = button.getAttribute("aria-describedby");
    expect(document.getElementById(describedBy!)?.textContent).toBe(fallback);
    const deleteItem = button.closest(".danger-zone__item");
    expect(deleteItem?.querySelector(".danger-zone__desc")?.textContent).toBe(fallback);
  });

  it("labels unknown deletion blockers with spaced words", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...activeEvent,
      is_deletable: false,
      deletion_blockers: ["future_blocker_type"],
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
      "Still blocking delete: future blocker type.",
    );
  });

  it("renders Delete event enabled for a superadmin on an archived, empty event", async () => {
    vi.mocked(fetchEventSettings).mockResolvedValueOnce({
      ...archivedEvent,
      is_deletable: true,
      deletion_blockers: [],
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
      name: "Delete",
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
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

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
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
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
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

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
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

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
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

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
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

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
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

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

  it("does not let a stale refreshEventDeletionStatus response from event A overwrite event B's Danger Zone after navigating away", async () => {
    const deletableEventB = { ...eventB, is_deletable: true, deletion_blockers: [] as string[] };
    vi.mocked(fetchTicketTypes).mockResolvedValue([vipType]);
    vi.mocked(updateTicketType).mockResolvedValueOnce({ ...vipType, label: "VIP Gold" });

    // Call order: (1) initial load of event A, (2) the background refreshEventDeletionStatus
    // fired by the upcoming ticket-type edit's onChanged - held open so it resolves only after
    // navigating to event B, (3) event B's own load once the router navigates.
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(activeEvent);
    let resolveStaleRefresh!: (event: typeof activeEvent) => void;
    const staleRefresh = new Promise<typeof activeEvent>((resolve) => {
      resolveStaleRefresh = resolve;
    });
    vi.mocked(fetchEventSettings).mockImplementationOnce(() => staleRefresh);
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(deletableEventB);

    const router = renderSettingsRouter("/admin/events/evt-1/settings?tab=ticket-types");
    renderWithToast(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("VIP")).toBeTruthy();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const input = screen.getByDisplayValue("VIP") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "VIP Gold" } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(updateTicketType).toHaveBeenCalled();
    });

    await router.navigate("/admin/events/evt-2/settings?tab=ticket-types");
    await waitFor(() => {
      expect(vi.mocked(fetchEventSettings).mock.calls).toHaveLength(3);
    });

    fireEvent.click(await screen.findByRole("tab", { name: "Danger zone" }));
    await waitFor(() => {
      expect(
        screen.getByText(
          "Permanently deletes this event and everything in it. This can't be undone. Saved in the history log.",
        ),
      ).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Delete event" }).hasAttribute("disabled")).toBe(
      false,
    );

    // Event A's held-open refresh resolves only now, after event B is already showing - it must
    // not overwrite event B's Danger Zone with event A's stale deletable/blockers snapshot.
    resolveStaleRefresh(activeEvent);
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      screen.getByText(
        "Permanently deletes this event and everything in it. This can't be undone. Saved in the history log.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Still blocking delete/)).toBeNull();
    expect(screen.getByRole("button", { name: "Delete event" }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("keeps the later of two overlapping same-event deletion-status refreshes, even if the earlier one resolves last", async () => {
    const blockedSnapshot = { ...activeEvent, is_deletable: false, deletion_blockers: ["attendees"] as string[] };
    const clearedSnapshot = { ...activeEvent, is_deletable: true, deletion_blockers: [] as string[] };
    vi.mocked(fetchTicketTypes).mockResolvedValue([vipType]);
    vi.mocked(updateTicketType).mockResolvedValueOnce({ ...vipType, label: "VIP Gold" });
    vi.mocked(updateTicketType).mockResolvedValueOnce({ ...vipType, label: "VIP Gold 2" });

    // Call order: (1) initial load, (2) the first edit's refresh - held open so it resolves only
    // after the second edit's own refresh has already landed, (3) the second edit's refresh -
    // resolves immediately with the current, correct snapshot.
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(blockedSnapshot);
    let resolveFirstRefresh!: (event: typeof activeEvent) => void;
    const firstRefresh = new Promise<typeof activeEvent>((resolve) => {
      resolveFirstRefresh = resolve;
    });
    vi.mocked(fetchEventSettings).mockImplementationOnce(() => firstRefresh);
    vi.mocked(fetchEventSettings).mockResolvedValueOnce(clearedSnapshot);

    const router = renderSettingsRouter("/admin/events/evt-1/settings?tab=ticket-types");
    renderWithToast(<RouterProvider router={router} />);
    await waitFor(() => {
      expect(screen.getByDisplayValue("VIP")).toBeTruthy();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const firstInput = screen.getByDisplayValue("VIP") as HTMLInputElement;
    fireEvent.change(firstInput, { target: { value: "VIP Gold" } });
    fireEvent.blur(firstInput);
    await waitFor(() => {
      expect(updateTicketType).toHaveBeenCalledTimes(1);
    });

    const secondInput = (await screen.findByDisplayValue("VIP Gold")) as HTMLInputElement;
    fireEvent.change(secondInput, { target: { value: "VIP Gold 2" } });
    fireEvent.blur(secondInput);
    await waitFor(() => {
      expect(updateTicketType).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(vi.mocked(fetchEventSettings).mock.calls).toHaveLength(3);
    });

    fireEvent.click(await screen.findByRole("tab", { name: "Danger zone" }));
    await waitFor(() => {
      expect(
        screen.getByText(
          "Permanently deletes this event and everything in it. This can't be undone. Saved in the history log.",
        ),
      ).toBeTruthy();
    });

    // The first edit's refresh resolves only now, after the second edit's own (fresher) refresh
    // has already landed - its stale is_deletable/deletion_blockers must not win.
    resolveFirstRefresh(blockedSnapshot);
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      screen.getByText(
        "Permanently deletes this event and everything in it. This can't be undone. Saved in the history log.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Still blocking delete/)).toBeNull();
  });
});
