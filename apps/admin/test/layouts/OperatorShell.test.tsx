// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventDto } from "../../src/api/types.js";
import { OperatorShell } from "../../src/layouts/OperatorShell.js";

const mockFetchCheckInEvents = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return { ...actual, fetchCheckInEvents: (...args: unknown[]) => mockFetchCheckInEvents(...args) };
});

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ assignments: [{ role: "operator", scope_type: "event", scope_id: "evt-1" }] }),
}));

vi.mock("../../src/layouts/StaffShell.js", () => ({
  StaffShell: ({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) => (
    <div>
      <div data-testid="connection-banner-slot">{children}</div>
      <nav data-testid="sidebar">{sidebar}</nav>
      <main data-testid="main" />
    </div>
  ),
}));

const connectionBanner = vi.fn(() => <div data-testid="connection-banner">offline</div>);

vi.mock("../../src/connection/ConnectionStateProvider.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/connection/ConnectionStateProvider.js")>();
  return {
    ...actual,
    ConnectionBanner: () => connectionBanner(),
  };
});

const sampleEvent: EventDto = {
  id: "evt-1",
  title: "Operator Gala",
  slug: "operator-gala",
  date: "2026-10-01",
  timezone: "Europe/Warsaw",
  location: "Kraków",
  archived_at: null,
};

function renderShell(path = "/operator") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<OperatorShell />}>
          <Route path="/operator" element={<div>picker</div>} />
          <Route path="/operator/events/:eventId/checkin" element={<div>checkin</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OperatorShell", () => {
  it("renders the global connection banner on the operator event picker", () => {
    renderShell("/operator");
    expect(screen.getByTestId("connection-banner")).toBeTruthy();
    expect(connectionBanner).toHaveBeenCalled();
  });

  it("shows event details in the sidebar on check-in routes", async () => {
    mockFetchCheckInEvents.mockResolvedValueOnce([sampleEvent]);
    renderShell("/operator/events/evt-1/checkin");

    await waitFor(() => {
      expect(screen.getByText("Operator Gala")).toBeTruthy();
    });
    expect(screen.getByText("Kraków")).toBeTruthy();
    expect(mockFetchCheckInEvents).toHaveBeenCalled();
    expect(screen.queryByTestId("connection-banner")).toBeNull();
    expect(connectionBanner).not.toHaveBeenCalled();
  });

  it("omits location detail when the event has no location", async () => {
    mockFetchCheckInEvents.mockResolvedValueOnce([{ ...sampleEvent, location: null }]);
    renderShell("/operator/events/evt-1/checkin");

    await waitFor(() => {
      expect(screen.getByText("Operator Gala")).toBeTruthy();
    });
    expect(screen.queryByText("Kraków")).toBeNull();
  });

  it("clears sidebar event details when event lookup fails", async () => {
    mockFetchCheckInEvents.mockRejectedValueOnce(new Error("network"));
    renderShell("/operator/events/evt-1/checkin");

    await waitFor(() => {
      expect(mockFetchCheckInEvents).toHaveBeenCalled();
    });
    expect(screen.queryByText("Operator Gala")).toBeNull();
  });
});
