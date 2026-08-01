// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEvent, fetchAdminEvents, searchGeocoding } from "../../src/api/client.js";
import {
  WizardStep4Event,
  type WizardStep4EventHandle,
} from "../../src/pages/wizard/WizardStep4Event.js";
import { WizardProvider } from "../../src/pages/wizard/WizardContext.js";
import { renderWithToast } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    createEvent: vi.fn(),
    fetchAdminEvents: vi.fn(),
    searchGeocoding: vi.fn(),
  };
});

const mockCreateEvent = vi.mocked(createEvent);
const mockFetchAdminEvents = vi.mocked(fetchAdminEvents);
const mockSearchGeocoding = vi.mocked(searchGeocoding);

afterEach(cleanup);

beforeEach(() => {
  mockCreateEvent.mockReset();
  mockFetchAdminEvents.mockReset();
  mockSearchGeocoding.mockReset();
  mockFetchAdminEvents.mockResolvedValue([]);
  mockSearchGeocoding.mockResolvedValue({ results: [], contact_configured: true });
});

describe("WizardStep4Event", () => {
  it("creates an event with the selected location's geocoding fields", async () => {
    const result = {
      name: "Palace of Culture",
      formatted_address: "1 Parade Square, Warsaw",
      latitude: 52.2319,
      longitude: 21.0067,
      provider: "nominatim",
    };
    mockSearchGeocoding.mockResolvedValueOnce({ results: [result], contact_configured: true });
    mockCreateEvent.mockResolvedValueOnce({
      id: "evt-1",
      title: "Test Event",
      slug: "test-event",
      date: "2026-09-29",
      timezone: "Europe/Warsaw",
      location: "Palace of Culture",
      organization_id: "org-1",
      archived_at: null,
    });
    const ref = createRef<WizardStep4EventHandle>();
    renderWithToast(
      <WizardProvider>
        <WizardStep4Event ref={ref} onCanContinueChange={() => {}} onHasExistingEventsChange={() => {}} />
      </WizardProvider>,
    );

    fireEvent.change(await screen.findByLabelText("Event name"), { target: { value: "Test Event" } });
    const date = screen.getByRole("textbox", { name: "Date" });
    fireEvent.change(date, { target: { value: "09/29/2026" } });
    fireEvent.blur(date);
    const location = screen.getByLabelText("Location (optional)");
    fireEvent.change(location, { target: { value: "Palace of Culture" } });
    fireEvent.click(screen.getByRole("button", { name: "Find on map" }));
    fireEvent.click(await screen.findByRole("button", { name: /Palace of Culture/ }));

    await expect(ref.current?.createAndContinue()).resolves.toBe(true);
    expect(mockCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        venue_name: "Palace of Culture",
        formatted_address: "1 Parade Square, Warsaw",
        latitude: 52.2319,
        longitude: 21.0067,
        geocoding_provider: "nominatim",
      }),
    );
  });

  it("shows the slug-conflict toast when creation returns 409", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockCreateEvent.mockRejectedValueOnce(new ApiError(409, "slug_taken"));
    const ref = createRef<WizardStep4EventHandle>();
    renderWithToast(
      <WizardProvider>
        <WizardStep4Event ref={ref} onCanContinueChange={() => {}} onHasExistingEventsChange={() => {}} />
      </WizardProvider>,
    );
    fireEvent.change(await screen.findByLabelText("Event name"), { target: { value: "Test Event" } });
    const date = screen.getByRole("textbox", { name: "Date" });
    fireEvent.change(date, { target: { value: "09/29/2026" } });
    fireEvent.blur(date);

    await expect(ref.current?.createAndContinue()).resolves.toBe(false);
    expect(await screen.findByText("Slug is already in use. Change the event name and try again.")).toBeTruthy();
  });

  it("shows a safe toast for a generic create failure", async () => {
    mockCreateEvent.mockRejectedValueOnce(new Error("network down"));
    const ref = createRef<WizardStep4EventHandle>();
    renderWithToast(
      <WizardProvider>
        <WizardStep4Event ref={ref} onCanContinueChange={() => {}} onHasExistingEventsChange={() => {}} />
      </WizardProvider>,
    );
    fireEvent.change(await screen.findByLabelText("Event name"), { target: { value: "Test Event" } });
    const date = screen.getByRole("textbox", { name: "Date" });
    fireEvent.change(date, { target: { value: "09/29/2026" } });
    fireEvent.blur(date);

    await expect(ref.current?.createAndContinue()).resolves.toBe(false);
    expect(await screen.findByText("Failed to create event.")).toBeTruthy();
  });

  it("reports no existing events when the initial list fails", async () => {
    const onHasExistingEventsChange = vi.fn();
    mockFetchAdminEvents.mockRejectedValueOnce(new Error("network down"));
    renderWithToast(
      <WizardProvider>
        <WizardStep4Event onCanContinueChange={() => {}} onHasExistingEventsChange={onHasExistingEventsChange} />
      </WizardProvider>,
    );

    await waitFor(() => expect(onHasExistingEventsChange).toHaveBeenCalledWith(false));
  });

  it("marks the step dirty when the timezone changes", async () => {
    const onDirtyChange = vi.fn();
    renderWithToast(
      <WizardProvider>
        <WizardStep4Event
          onCanContinueChange={() => {}}
          onHasExistingEventsChange={() => {}}
          onDirtyChange={onDirtyChange}
        />
      </WizardProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Event timezone|UTC|Europe|Select timezone/ }));
    fireEvent.change(screen.getByLabelText("Search timezones"), { target: { value: "tokyo" } });
    await waitFor(() => {
      expect(screen.getAllByRole("option").some((o) => o.textContent?.includes("Tokyo"))).toBe(true);
    });
    fireEvent.click(
      screen.getAllByRole("option").find((o) => o.textContent?.includes("Asia/Tokyo"))!,
    );
    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });

  it("aborts the event-list request on unmount", async () => {
    let signal: AbortSignal | undefined;
    mockFetchAdminEvents.mockImplementationOnce(({ signal: requestSignal }) => {
      signal = requestSignal;
      return new Promise(() => {});
    });
    const rendered = renderWithToast(
      <WizardProvider>
        <WizardStep4Event onCanContinueChange={() => {}} onHasExistingEventsChange={() => {}} />
      </WizardProvider>,
    );
    await waitFor(() => expect(signal).toBeDefined());

    rendered.unmount();
    expect(signal!.aborted).toBe(true);
  });

  it("drops a selected suggestion's coordinates after manually editing the location", async () => {
    const result = {
      name: "Palace of Culture",
      formatted_address: "1 Parade Square, Warsaw",
      latitude: 52.2319,
      longitude: 21.0067,
      provider: "nominatim",
    };
    mockSearchGeocoding.mockResolvedValueOnce({ results: [result], contact_configured: true });
    mockCreateEvent.mockResolvedValueOnce({
      id: "evt-1",
      title: "Test Event",
      slug: "test-event",
      date: "2026-09-29",
      timezone: "Europe/Warsaw",
      location: null,
      organization_id: "org-1",
      archived_at: null,
    });
    const ref = createRef<WizardStep4EventHandle>();

    renderWithToast(
      <WizardProvider>
        <WizardStep4Event
          ref={ref}
          onCanContinueChange={() => {}}
          onHasExistingEventsChange={() => {}}
        />
      </WizardProvider>,
    );

    fireEvent.change(await screen.findByLabelText("Event name"), {
      target: { value: "Test Event" },
    });
    const date = screen.getByRole("textbox", { name: "Date" });
    fireEvent.change(date, {
      target: { value: "09/29/2026" },
    });
    fireEvent.blur(date);
    const location = screen.getByLabelText("Location (optional)");
    fireEvent.change(location, { target: { value: "Palace of Culture" } });
    fireEvent.click(screen.getByRole("button", { name: "Find on map" }));
    fireEvent.click(await screen.findByRole("button", { name: /Palace of Culture/ }));

    fireEvent.change(location, { target: { value: "Palace of Culture Annex" } });
    await act(async () => {
      await expect(ref.current?.createAndContinue()).resolves.toBe(true);
    });

    await waitFor(() => {
      expect(mockCreateEvent).toHaveBeenCalledWith({
        title: "Test Event",
        slug: "test-event",
        date: "2026-09-29",
        timezone: expect.any(String),
        venue_name: "Palace of Culture Annex",
        formatted_address: undefined,
        latitude: undefined,
        longitude: undefined,
        geocoding_provider: undefined,
      });
    });
  });
});
