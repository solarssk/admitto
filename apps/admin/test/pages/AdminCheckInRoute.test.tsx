// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AdminCheckInRoute } from "../../src/pages/AdminCheckInRoute.js";

const useConnectionState = vi.fn();

vi.mock("../../src/connection/ConnectionStateProvider.js", () => ({
  useConnectionState: () => useConnectionState(),
}));

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ hasAdmittoSession: true }),
}));

vi.mock("../../src/pages/CheckInPage.js", () => ({
  CheckInPage: (props: { useCamera: boolean }) => (
    <div data-testid="checkin-page" data-camera={props.useCamera} />
  ),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useOutletContext: () => ({
      event: {
        id: "evt-1",
        title: "Demo Event",
        timezone: "UTC",
        date: "2026-07-31",
        location: "Warsaw",
        attendee_count: 0,
        archived_at: null,
      },
    }),
  };
});

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={["/admin/events/evt-1/checkin"]}>
      <Routes>
        <Route path="/admin/events/:eventId/checkin" element={<AdminCheckInRoute />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AdminCheckInRoute header (#378)", () => {
  it("shows purpose copy, not the event context already in the sidebar", () => {
    useConnectionState.mockReturnValue({ state: "connected", reportApiError: vi.fn() });
    renderRoute();

    expect(screen.getByText("Scan QR codes and admit guests on event day")).toBeTruthy();
    expect(screen.queryByText(/Demo Event/)).toBeNull();
    expect(screen.queryByText(/Warsaw/)).toBeNull();
  });

  // The connection badge itself moved to the global StaffShell topbar
  // (rendered once for the whole app, next to MailerStatusBadge) — see
  // ServerConnectionBadge tests in ConnectionBanner.test.tsx.
});

describe("AdminCheckInRoute camera toggle (#381)", () => {
  it("flips between Use camera and Disable camera", () => {
    useConnectionState.mockReturnValue({ state: "connected", reportApiError: vi.fn() });
    renderRoute();

    const toggle = screen.getByRole("button", { name: "Use camera" });
    expect(screen.getByTestId("checkin-page").getAttribute("data-camera")).toBe("false");

    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Disable camera" })).toBeTruthy();
    expect(screen.getByTestId("checkin-page").getAttribute("data-camera")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Disable camera" }));
    expect(screen.getByRole("button", { name: "Use camera" })).toBeTruthy();
    expect(screen.getByTestId("checkin-page").getAttribute("data-camera")).toBe("false");
  });
});
