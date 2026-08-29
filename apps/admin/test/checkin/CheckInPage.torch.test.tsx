// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { ToastProvider } from "@admitto/ui";
import { CheckInPage } from "../../src/pages/CheckInPage.js";
import { mockCheckInBootstrap } from "./checkInApiMock.js";

// Captures the real onTrackChange callback CameraOverlay/CkInlineCamera wire
// into CameraScanner, so a torch-capable (or torch-less) track can be
// simulated without a working camera/ZXing stack — same technique
// CheckInPage.cameraViewStale.test.tsx already uses for onScan.
let capturedOnTrackChange: ((track: MediaStreamTrack | null) => void) | undefined;
vi.mock("../../src/checkin/CameraScanner.js", () => ({
  CameraScanner: (props: { onTrackChange?: (track: MediaStreamTrack | null) => void }) => {
    capturedOnTrackChange = props.onTrackChange;
    return <div data-testid="camera-scanner" />;
  },
}));

let desktopMatch = false;
vi.mock("../../src/hooks/useIsDesktop.js", () => ({
  useIsDesktop: () => desktopMatch,
  isDesktopViewport: () => desktopMatch,
}));

function mockTrack(torch: boolean) {
  return {
    getCapabilities: () => ({ torch }),
    applyConstraints: vi.fn().mockResolvedValue(undefined),
  } as unknown as MediaStreamTrack;
}

vi.mock("../../src/hooks/useEventStream.js");

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ deviceLabel: "desk-1", assignments: [] }),
}));

vi.mock("../../src/connection/ConnectionStateProvider.js");

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const { buildCheckInApiMock } = await import("./checkInApiMock.js");
  return {
    ...buildCheckInApiMock(await importOriginal<typeof import("../../src/api/client.js")>()),
    fetchAttendeeCard: vi.fn(),
    lookupCheckInAttendees: vi.fn(),
    submitAttendeeNote: vi.fn(),
    submitCheckInAdmit: vi.fn(),
    submitCheckInScan: vi.fn(),
    submitItemAction: vi.fn(),
    undoLastCheckIn: vi.fn(),
  };
});

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={["/admin/events/evt-live/checkin"]}>
        <Routes>
          <Route path="/admin/events/:eventId/checkin" element={<CheckInPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  capturedOnTrackChange = undefined;
  desktopMatch = false;
});

describe("check-in camera torch toggle — mobile overlay", () => {
  it("stays hidden until the active track reports the torch capability, then toggles it", async () => {
    mockCheckInBootstrap();
    renderPage();
    await screen.findByLabelText("Camera check-in");

    expect(screen.queryByRole("button", { name: "Turn on torch" })).toBeNull();

    const track = mockTrack(true);
    await act(async () => {
      capturedOnTrackChange?.(track);
    });

    const torchButton = await screen.findByRole("button", { name: "Turn on torch" });
    fireEvent.click(torchButton);

    await screen.findByRole("button", { name: "Turn off torch" });
    expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
  });

  it("does not render the torch button for a track that doesn't support it (most phones/laptops)", async () => {
    mockCheckInBootstrap();
    renderPage();
    await screen.findByLabelText("Camera check-in");

    await act(async () => {
      capturedOnTrackChange?.(mockTrack(false));
    });

    expect(screen.queryByRole("button", { name: "Turn on torch" })).toBeNull();
  });
});

describe("check-in camera torch toggle — desktop operator action bar", () => {
  it("appears next to the mute toggle only once the camera is on and reports torch support", async () => {
    desktopMatch = true;
    mockCheckInBootstrap();
    renderPage();

    // Desktop starts with the camera off (operatorCamera inits to
    // !isDesktopViewport()) — the action bar itself is already visible, but
    // torch has nothing to report until a track exists.
    await screen.findByRole("button", { name: "Use camera" });
    expect(screen.queryByRole("button", { name: "Turn on torch" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Use camera" }));
    await screen.findByRole("button", { name: "Disable camera" });

    const track = mockTrack(true);
    await act(async () => {
      capturedOnTrackChange?.(track);
    });

    const torchButton = await screen.findByRole("button", { name: "Turn on torch" });
    fireEvent.click(torchButton);

    await screen.findByRole("button", { name: "Turn off torch" });
    expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
  });
});
