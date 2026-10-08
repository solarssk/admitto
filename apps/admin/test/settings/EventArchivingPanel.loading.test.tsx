// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventArchivingPanel } from "../../src/settings/EventArchivingPanel.js";
import type { EventDto } from "../../src/api/types.js";
import { deferred, mockMatchMedia, renderWithToastAndRouter } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return { ...actual, fetchAdminEvents: vi.fn(), archiveEvent: vi.fn(), unarchiveEvent: vi.fn() };
});
// One function for every render, as the provider gives: a new one each time would be a new query each time.
const reportApiError = vi.fn();
vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => ({ reportApiError }),
}));

import { archiveEvent, fetchAdminEvents, unarchiveEvent } from "../../src/api/client.js";

const event = (id: string, title: string, archivedAt: string | null = null): EventDto => ({
  id,
  title,
  slug: id,
  date: "2026-07-01",
  timezone: "Europe/Warsaw",
  location: null,
  organization_id: "org-1",
  archived_at: archivedAt,
});

beforeEach(() => {
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

async function archiveFirstEvent() {
  fireEvent.click((await screen.findAllByRole("button", { name: "Archive" }))[0]!);
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Archive" }));
}

describe("EventArchivingPanel after an action", () => {
  it("moves the archived event to the other view at once, keeps the rows while the refresh is on its way, and refreshes", async () => {
    const refresh = deferred<EventDto[]>();
    vi.mocked(fetchAdminEvents)
      .mockResolvedValueOnce([event("evt-1", "Summer Summit"), event("evt-2", "Winter Gala")])
      .mockReturnValueOnce(refresh.promise);
    vi.mocked(archiveEvent).mockResolvedValue(undefined);
    renderWithToastAndRouter(<EventArchivingPanel />);

    await archiveFirstEvent();
    await waitFor(() => expect(screen.queryByText("Summer Summit")).toBeNull());
    expect(screen.getByText("Winter Gala")).toBeTruthy();
    // The rows are kept, blocked, while the refresh is on its way, and no placeholder took their place.
    expect(screen.queryByLabelText("Loading events")).toBeNull();
    await waitFor(() => expect(document.querySelectorAll(".refetch-card--busy")).toHaveLength(1));

    await act(async () => refresh.resolve([event("evt-1", "Summer Summit", "2026-10-01T10:00:00.000Z"), event("evt-2", "Winter Gala")]));
    await waitFor(() => expect(document.querySelectorAll(".refetch-card")).toHaveLength(0));
    fireEvent.click(screen.getByRole("radio", { name: "Archived" }));
    expect(await screen.findByText("Summer Summit")).toBeTruthy();
  });

  it("shows the archive when the refresh after it fails: a warning with a Retry, and not an error in place of the list", async () => {
    vi.mocked(fetchAdminEvents)
      .mockResolvedValueOnce([event("evt-1", "Summer Summit"), event("evt-2", "Winter Gala")])
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce([event("evt-1", "Summer Summit", "2026-10-01T10:00:00.000Z"), event("evt-2", "Winter Gala")]);
    vi.mocked(archiveEvent).mockResolvedValue(undefined);
    renderWithToastAndRouter(<EventArchivingPanel />);

    await archiveFirstEvent();
    expect(await screen.findByText(/Could not refresh this list, so it may show older details/)).toBeTruthy();
    expect(screen.queryByText("Summer Summit")).toBeNull();
    expect(screen.getByText("Winter Gala")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByText(/Could not refresh this list/)).toBeNull());
  });

  it("ends the confirmation's busy state with the archive itself, not with the refresh behind it", async () => {
    const refresh = deferred<EventDto[]>();
    vi.mocked(fetchAdminEvents).mockResolvedValueOnce([event("evt-1", "Summer Summit")]).mockReturnValueOnce(refresh.promise);
    vi.mocked(archiveEvent).mockResolvedValue(undefined);
    renderWithToastAndRouter(<EventArchivingPanel />);

    await archiveFirstEvent();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.querySelectorAll(".refetch-card--busy")).toHaveLength(1);
    await act(async () => refresh.resolve([event("evt-1", "Summer Summit", "2026-10-01T10:00:00.000Z")]));
  });

  it("moves a restored event back to the active view at once", async () => {
    vi.mocked(fetchAdminEvents)
      .mockResolvedValueOnce([event("evt-1", "Summer Summit", "2026-09-01T10:00:00.000Z")])
      .mockResolvedValueOnce([event("evt-1", "Summer Summit")]);
    vi.mocked(unarchiveEvent).mockResolvedValue(undefined);
    renderWithToastAndRouter(<EventArchivingPanel />);

    fireEvent.click(await screen.findByRole("radio", { name: "Archived" }));
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(screen.getByText("No archived events")).toBeTruthy());
  });
});

describe("EventArchivingPanel first load failing", () => {
  it("is an error with a Retry that loads it again, and the list takes the error's place", async () => {
    vi.mocked(fetchAdminEvents).mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce([event("evt-1", "Summer Summit")]);
    renderWithToastAndRouter(<EventArchivingPanel />);

    expect(await screen.findByText("Could not load events")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Summer Summit")).toBeTruthy();
    expect(screen.queryByText("Could not load events")).toBeNull();
  });

  it("keeps the error with a busy Retry, whose focus it keeps, while a retry runs: no placeholder or empty list takes its place, and the card gets the focus when it works", async () => {
    vi.mocked(fetchAdminEvents).mockRejectedValueOnce(new Error("network down"));
    renderWithToastAndRouter(<EventArchivingPanel />);
    const title = await screen.findByText("Could not load events");
    const retry = screen.getByRole("button", { name: "Retry" });
    // A failure that shows with its Retry is not busy: only a click makes it so. It fades in with what it replaces.
    expect(retry.getAttribute("aria-busy")).toBeNull();
    const fade = retry.closest(".at-fade-in");
    expect(fade).not.toBeNull();
    const card = retry.closest(".at-card");

    const second = deferred<EventDto[]>();
    vi.mocked(fetchAdminEvents).mockReturnValueOnce(second.promise);
    retry.focus();
    fireEvent.click(retry);

    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(retry.closest(".at-fade-in")).toBe(fade);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(retry);
    expect(screen.getByText("Could not load events")).toBe(title);
    expect(screen.queryByLabelText("Loading events")).toBeNull();
    expect(screen.queryByText("No active events")).toBeNull();

    await act(async () => second.resolve([event("evt-1", "Summer Summit")]));
    expect(await screen.findByText("Summer Summit")).toBeTruthy();
    expect(screen.queryByText("Could not load events")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(card));
  });

  it("says the failure again, on the same Retry, when a retry fails again", async () => {
    vi.mocked(fetchAdminEvents).mockRejectedValueOnce(new Error("network down"));
    renderWithToastAndRouter(<EventArchivingPanel />);
    await screen.findByText("Could not load events");
    const retry = screen.getByRole("button", { name: "Retry" });
    const message = screen.getByText("Could not load events.");

    const second = deferred<EventDto[]>();
    vi.mocked(fetchAdminEvents).mockReturnValueOnce(second.promise);
    retry.focus();
    fireEvent.click(retry);
    await act(async () => second.reject(new Error("still down")));
    await waitFor(() => expect(retry.getAttribute("aria-busy")).toBeNull(), { timeout: 3000 });

    expect(screen.getByText("Could not load events.")).not.toBe(message);
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(document.activeElement).toBe(retry);
  });
});
