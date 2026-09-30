// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { ToastProvider } from "@admitto/ui";
import { CheckInPage } from "../../src/pages/CheckInPage.js";

vi.mock("../../src/checkin/CameraScanner.js", () => ({
  CameraScanner: () => <div data-testid="camera-scanner" />,
}));

const fetchCheckInHistory = vi.fn();
const fetchCheckInStats = vi.fn();
const fetchCheckInOpsConfig = vi.fn();
const fetchCheckInEvents = vi.fn();
const fetchAttendeeCard = vi.fn();
const fetchTicketTypes = vi.fn();
const lookupCheckInAttendees = vi.fn();
const submitCheckInAdmit = vi.fn();
const submitCheckInScan = vi.fn();
const submitItemAction = vi.fn();

vi.mock("../../src/hooks/useEventStream.js");

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ deviceLabel: "desk-1", assignments: [] }),
}));

vi.mock("../../src/connection/ConnectionStateProvider.js");

const viewport = vi.hoisted(() => ({ desktop: true }));

vi.mock("../../src/hooks/useIsDesktop.js", () => ({
  useIsDesktop: () => viewport.desktop,
  isDesktopViewport: () => viewport.desktop,
}));

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  fetchTicketTypes: (...args: unknown[]) => fetchTicketTypes(...args),
  fetchCheckInHistory: (...args: unknown[]) => fetchCheckInHistory(...args),
  fetchCheckInStats: (...args: unknown[]) => fetchCheckInStats(...args),
  fetchCheckInOpsConfig: (...args: unknown[]) => fetchCheckInOpsConfig(...args),
  fetchCheckInEvents: (...args: unknown[]) => fetchCheckInEvents(...args),
  fetchAttendeeCard: (...args: unknown[]) => fetchAttendeeCard(...args),
  lookupCheckInAttendees: (...args: unknown[]) => lookupCheckInAttendees(...args),
  submitAttendeeNote: vi.fn(),
  submitCheckInAdmit: (...args: unknown[]) => submitCheckInAdmit(...args),
  submitCheckInScan: (...args: unknown[]) => submitCheckInScan(...args),
  submitItemAction: (...args: unknown[]) => submitItemAction(...args),
  undoLastCheckIn: vi.fn(),
}));

const LOAD_ERROR = "Could not load the counts and recent scans.";

function mockBootstrap() {
  fetchCheckInOpsConfig.mockResolvedValue({
    require_confirm_on_scan: false,
    badge_at_entry: true,
    allow_manual_lookup: true,
    auto_advance_on_valid: true,
  });
  fetchCheckInEvents.mockResolvedValue([{ id: "evt-live", timezone: "UTC" }]);
  fetchTicketTypes.mockResolvedValue([]);
  fetchCheckInHistory.mockResolvedValue([]);
  fetchCheckInStats.mockResolvedValue({ admitted_count: 7, total_count: 20 });
}

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

const stats = () => document.querySelector(".ck-stats") as HTMLElement | null;
const recent = () => document.querySelector(".ck-side .ck-recent") as HTMLElement | null;
const placeholders = () => document.querySelectorAll(".ck-side .at-skeleton").length;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function scanInput(): Promise<HTMLInputElement> {
  await waitFor(() => expect(screen.getByLabelText("QR scan or search")).toBeTruthy());
  return screen.getByLabelText("QR scan or search") as HTMLInputElement;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // clearAllMocks leaves queued once-values behind, which would answer the next test's first call.
  for (const fn of [
    fetchCheckInHistory, fetchCheckInStats, fetchCheckInOpsConfig, fetchCheckInEvents, fetchAttendeeCard,
    fetchTicketTypes, lookupCheckInAttendees, submitCheckInAdmit, submitCheckInScan, submitItemAction,
  ]) {
    fn.mockReset();
  }
  localStorage.clear();
  viewport.desktop = true;
});

describe("CheckInPage sidebar: the counts and recent scans are unknown until they arrive", () => {
  it("shows no zeros and no 'No scans yet' while they load, holds the space, draws a placeholder after 200ms, then fades the real numbers in", async () => {
    mockBootstrap();
    let answerStats!: (value: unknown) => void;
    let answerHistory!: (value: unknown) => void;
    fetchCheckInStats.mockReturnValue(new Promise((resolve) => (answerStats = resolve)));
    fetchCheckInHistory.mockReturnValue(new Promise((resolve) => (answerHistory = resolve)));
    renderPage();
    await scanInput();

    // In the page from the first frame, but not painted, and no false facts.
    expect(stats()?.className).toContain("at-loading-hold");
    expect(stats()?.getAttribute("aria-busy")).toBe("true");
    expect(recent()?.className).toContain("at-loading-hold");
    expect(screen.queryByText("No scans yet")).toBeNull();
    expect(stats()?.textContent).not.toMatch(/0%/);

    await waitFor(() => expect(stats()?.className).not.toContain("at-loading-hold"), { timeout: 3000 });
    expect(recent()?.className).not.toContain("at-loading-hold");
    expect(placeholders()).toBeGreaterThan(0);
    expect(screen.queryByText("No scans yet")).toBeNull();

    answerStats({ admitted_count: 7, total_count: 20 });
    answerHistory([]);
    // The placeholder stays for at least 400ms once drawn, then the real content replaces it.
    await waitFor(() => expect(screen.getByText("No scans yet")).toBeTruthy(), { timeout: 2000 });
    expect(stats()?.textContent).toContain("7");
    expect(stats()?.textContent).toContain("20");
    expect(stats()?.getAttribute("aria-busy")).toBeNull();
    expect(placeholders()).toBe(0);
    expect(document.querySelector(".ck-side .at-fade-in")).toBeTruthy();
  });

  it("never draws a placeholder when the numbers arrive at once", async () => {
    mockBootstrap();
    renderPage();
    await waitFor(() => expect(stats()?.textContent).toContain("20"));
    expect(placeholders()).toBe(0);
    expect(stats()?.getAttribute("aria-busy")).toBeNull();
    expect(screen.getByText("No scans yet")).toBeTruthy();
  });

  it("says the first load failed, with Retry, instead of leaving '0 admitted' and 'No scans yet' standing", async () => {
    mockBootstrap();
    fetchCheckInStats.mockRejectedValueOnce(new Error("network down"));
    renderPage();

    expect(await screen.findByText(LOAD_ERROR)).toBeTruthy();
    expect(screen.queryByText("No scans yet")).toBeNull();
    expect(stats()).toBeNull();

    fetchCheckInStats.mockResolvedValue({ admitted_count: 7, total_count: 20 });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    // The error stays, with a busy Retry, until the answer is in.
    expect(screen.getByRole("button", { name: "Retry" }).getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText(LOAD_ERROR)).toBeTruthy();

    await waitFor(() => expect(stats()?.textContent).toContain("20"), { timeout: 2000 });
    expect(screen.queryByText(LOAD_ERROR)).toBeNull();
    expect(screen.getByText("No scans yet")).toBeTruthy();
  });

  it("keeps the numbers on screen when a later refresh fails, instead of swapping them for an error", async () => {
    mockBootstrap();
    submitCheckInScan.mockResolvedValue({ status: "ALREADY_CHECKED_IN", confirmed: true });
    renderPage();
    await waitFor(() => expect(stats()?.textContent).toContain("20"));
    const callsBefore = fetchCheckInStats.mock.calls.length;

    fetchCheckInStats.mockRejectedValue(new Error("network down"));
    const input = await scanInput();
    const token = "QRTOKEN-ALREADY-CHECKED-IN-000";
    for (let i = 1; i <= token.length; i++) {
      fireEvent.change(input, { target: { value: token.slice(0, i) } });
    }
    await wait(60);
    await waitFor(() => expect(fetchCheckInStats.mock.calls.length).toBeGreaterThan(callsBefore));
    await wait(20);

    expect(screen.queryByText(LOAD_ERROR)).toBeNull();
    expect(stats()?.textContent).toContain("20");
  });

  it("starts from 'not loaded yet' again for another event, instead of showing the last one's numbers", async () => {
    mockBootstrap();
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/admin/events/evt-live/checkin"]}>
          <Link to="/admin/events/evt-other/checkin">other event</Link>
          <Routes>
            <Route path="/admin/events/:eventId/checkin" element={<CheckInPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );
    await waitFor(() => expect(stats()?.textContent).toContain("20"));
    expect(stats()?.getAttribute("aria-busy")).toBeNull();

    fetchCheckInStats.mockReturnValue(new Promise(() => {}));
    fetchCheckInHistory.mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByText("other event"));
    await waitFor(() => expect(stats()?.getAttribute("aria-busy")).toBe("true"));
    expect(screen.queryByText("No scans yet")).toBeNull();
  });
});

describe("CheckInPage door actions show they are working at once", () => {
  const baseCard = {
    id: "att-1",
    name: "Anna Alpha",
    company: null,
    department: null,
    ticket_type: "vip",
    check_in_status: "not_admitted" as const,
    admitted_at: null,
    items: [],
    notes: [],
    blocked: false,
  };
  const annaHit = { ...baseCard, check_in_status: "not_admitted" as const };

  it("shows 'Checking…' with a spinner in the scan bar the moment a search is sent, and takes it away when it answers", async () => {
    mockBootstrap();
    let answer!: (rows: unknown[]) => void;
    lookupCheckInAttendees.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    renderPage();
    const input = await scanInput();
    expect(screen.queryByText("Checking…")).toBeNull();

    fireEvent.change(input, { target: { value: "filip" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    // No delay of its own (the page queues door actions one after the other, so it is the next render, not the same one).
    await waitFor(() => expect(screen.getByText("Checking…")).toBeTruthy());
    expect(screen.getByRole("status", { name: "Checking" })).toBeTruthy();
    expect((screen.getByLabelText("QR scan or search") as HTMLInputElement).getAttribute("aria-busy")).toBe("true");

    answer([]);
    await waitFor(() => expect(screen.queryByText("Checking…")).toBeNull());
    expect(screen.queryByRole("status", { name: "Checking" })).toBeNull();
  });

  it("puts a spinner on Confirm check-in while that request is in flight", async () => {
    mockBootstrap();
    lookupCheckInAttendees.mockResolvedValue([annaHit]);
    fetchAttendeeCard.mockResolvedValue(baseCard);
    let admit!: (value: unknown) => void;
    submitCheckInAdmit.mockReturnValue(new Promise((resolve) => (admit = resolve)));
    renderPage();
    const input = await scanInput();
    fireEvent.change(input, { target: { value: "anna" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const confirm = await screen.findByRole("button", { name: "Confirm check-in" });
    expect(confirm.getAttribute("aria-busy")).toBeNull();

    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByRole("button", { name: /Confirm check-in|Checking in/ }).getAttribute("aria-busy")).toBe("true"));
    expect((screen.getByRole("button", { name: /Confirm check-in|Checking in/ }) as HTMLButtonElement).disabled).toBe(true);

    admit({
      status: "VALID",
      confirmed: true,
      admittedAt: "2026-09-01T09:44:00.000Z",
      attendeeId: "att-1",
      card: { ...baseCard, check_in_status: "admitted", admitted_at: "2026-09-01T09:44:00.000Z" },
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Confirm check-in" })).toBeNull());
  });

  it("puts a spinner on the item being handed out, not on the other items", async () => {
    mockBootstrap();
    lookupCheckInAttendees.mockResolvedValue([{ ...annaHit, check_in_status: "admitted" as const }]);
    const items = [
      { key: "badge", label: "Badge", icon: null, detail: null, description: null, state: "pending", actions: ["issued"] },
      { key: "lanyard", label: "Lanyard", icon: null, detail: null, description: null, state: "pending", actions: ["issued"] },
    ];
    fetchAttendeeCard.mockResolvedValue({
      ...baseCard,
      check_in_status: "admitted",
      admitted_at: "2026-09-01T09:44:00.000Z",
      items,
    });
    let issue!: (value: unknown) => void;
    submitItemAction.mockReturnValue(new Promise((resolve) => (issue = resolve)));
    renderPage();
    const input = await scanInput();
    fireEvent.change(input, { target: { value: "anna" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const badge = await screen.findByRole("button", { name: "Mark badge issued" });
    const lanyard = screen.getByRole("button", { name: "Mark lanyard issued" });

    fireEvent.click(badge);
    await waitFor(() => expect(badge.getAttribute("aria-busy")).toBe("true"));
    expect(lanyard.getAttribute("aria-busy")).toBeNull();

    issue({ ...items[0], state: "issued", actions: [] });
  });
});

describe("CheckInPage door actions: what is busy is what was asked", () => {
  const baseCard = {
    id: "att-1",
    name: "Anna Alpha",
    company: null,
    department: null,
    ticket_type: "vip",
    check_in_status: "not_admitted" as const,
    admitted_at: null,
    items: [] as unknown[],
    notes: [],
    blocked: false,
  };
  const annaHit = { ...baseCard };

  async function openCard(card: unknown) {
    lookupCheckInAttendees.mockResolvedValue([annaHit]);
    fetchAttendeeCard.mockResolvedValue(card);
    renderPage();
    const input = await scanInput();
    fireEvent.change(input, { target: { value: "anna" } });
    fireEvent.keyDown(input, { key: "Enter" });
  }

  it("Confirm check-in goes back to normal when the request fails, instead of staying busy", async () => {
    mockBootstrap();
    submitCheckInAdmit.mockRejectedValue(new Error("network down"));
    await openCard(baseCard);
    const confirm = await screen.findByRole("button", { name: "Confirm check-in" });

    fireEvent.click(confirm);
    await waitFor(() => expect(submitCheckInAdmit).toHaveBeenCalled());
    await waitFor(() => {
      const button = screen.getByRole("button", { name: "Confirm check-in" }) as HTMLButtonElement;
      expect(button.getAttribute("aria-busy")).toBeNull();
      expect(button.disabled).toBe(false);
    });
  });

  it("an item being handed out is not a scan: no 'Checking…' in the scan bar, and Confirm check-in is not the busy button", async () => {
    mockBootstrap();
    const withBadge = {
      ...baseCard,
      items: [
        { key: "badge", label: "Badge", icon: null, detail: null, description: null, state: "pending", actions: ["issued"] },
      ],
    };
    let issue!: (value: unknown) => void;
    submitItemAction.mockReturnValue(new Promise((resolve) => (issue = resolve)));
    await openCard(withBadge);
    const badge = await screen.findByRole("button", { name: "Mark badge issued" });

    fireEvent.click(badge);
    await waitFor(() => expect(badge.getAttribute("aria-busy")).toBe("true"));
    // Whole page is busy (nothing else can be sent), but only the pressed control says so.
    expect((screen.getByRole("button", { name: "Confirm check-in" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Confirm check-in" }).getAttribute("aria-busy")).toBeNull();
    expect(screen.queryByText("Checking…")).toBeNull();
    expect(screen.queryByRole("status", { name: "Checking" })).toBeNull();

    issue({ ...withBadge.items[0], state: "issued", actions: [] });
  });
});

describe("CheckInPage sidebar Retry", () => {
  it("stops being busy when the retry fails too, and keeps the error", async () => {
    mockBootstrap();
    fetchCheckInStats.mockRejectedValue(new Error("network down"));
    renderPage();
    await screen.findByText(LOAD_ERROR);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(fetchCheckInStats.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" }).getAttribute("aria-busy")).toBeNull(), {
      timeout: 3000,
    });
    expect(screen.getByText(LOAD_ERROR)).toBeTruthy();
  });

  it("is not needed any more once the server answers again: a check-in's stats refresh brings the numbers back", async () => {
    mockBootstrap();
    fetchCheckInStats.mockRejectedValueOnce(new Error("network down"));
    const annaHit = { id: "att-1", name: "Anna Alpha", ticket_type: "vip", company: null, department: null, check_in_status: "not_admitted" as const };
    const card = { id: "att-1", name: "Anna Alpha", company: null, department: null, ticket_type: "vip", check_in_status: "not_admitted" as const, admitted_at: null, items: [], notes: [], blocked: false };
    lookupCheckInAttendees.mockResolvedValue([annaHit]);
    fetchAttendeeCard.mockResolvedValue(card);
    submitCheckInAdmit.mockResolvedValue({
      status: "VALID",
      confirmed: true,
      admittedAt: "2026-09-01T09:44:00.000Z",
      attendeeId: "att-1",
      card: { ...card, check_in_status: "admitted", admitted_at: "2026-09-01T09:44:00.000Z" },
    });
    renderPage();
    await screen.findByText(LOAD_ERROR);

    const input = await scanInput();
    fireEvent.change(input, { target: { value: "anna" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(await screen.findByRole("button", { name: "Confirm check-in" }));

    await waitFor(() => expect(screen.queryByText(LOAD_ERROR)).toBeNull(), { timeout: 3000 });
    expect(stats()?.textContent).toContain("20");
  });
});

describe("CheckInPage on a phone: the camera overlay shows the same first-load states", () => {
  const overlayBar = () => document.querySelector(".ck-overlay__admitted") as HTMLElement | null;
  const overlayList = () => document.querySelector(".ck-overlay__aside") as HTMLElement | null;
  // The sidebar is still in the page underneath the full-screen overlay, so look inside the overlay only.
  const overlay = () => within(screen.getByLabelText("Camera check-in"));

  it("shows no '0 checked in' and no 'No scans yet' while loading, then the real count", async () => {
    viewport.desktop = false;
    mockBootstrap();
    let answerStats!: (value: unknown) => void;
    let answerHistory!: (value: unknown) => void;
    fetchCheckInStats.mockReturnValue(new Promise((resolve) => (answerStats = resolve)));
    fetchCheckInHistory.mockReturnValue(new Promise((resolve) => (answerHistory = resolve)));
    renderPage();
    await screen.findByLabelText("Camera check-in");

    expect(overlayBar()?.textContent).toBe(" checked in");
    expect(overlayList()?.querySelector(".ck-recent")?.className).toContain("at-loading-hold");
    expect(overlay().queryByText("No scans yet")).toBeNull();

    answerStats({ admitted_count: 7, total_count: 20 });
    answerHistory([]);
    await waitFor(() => expect(overlayBar()?.textContent).toBe("7 checked in"), { timeout: 3000 });
    expect(overlay().getByText("No scans yet")).toBeTruthy();
  });

  it("says it could not load, with a Retry that brings the count back", async () => {
    viewport.desktop = false;
    mockBootstrap();
    fetchCheckInStats.mockRejectedValueOnce(new Error("network down"));
    renderPage();
    await screen.findByLabelText("Camera check-in");

    await waitFor(() => expect(overlayBar()?.textContent).toBe("Count unavailable"));
    expect(overlay().queryByText("No scans yet")).toBeNull();
    expect(overlay().getByText(LOAD_ERROR)).toBeTruthy();

    fireEvent.click(overlay().getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(overlayBar()?.textContent).toBe("7 checked in"), { timeout: 3000 });
    expect(overlay().queryByText(LOAD_ERROR)).toBeNull();
  });

  it("Confirm check-in in the overlay is busy while that request is in flight", async () => {
    viewport.desktop = false;
    mockBootstrap();
    const annaHit = { id: "att-1", name: "Anna Alpha", ticket_type: "vip", company: null, department: null, check_in_status: "not_admitted" as const };
    lookupCheckInAttendees.mockResolvedValue([annaHit]);
    fetchAttendeeCard.mockResolvedValue({ id: "att-1", name: "Anna Alpha", company: null, department: null, ticket_type: "vip", check_in_status: "not_admitted", admitted_at: null, items: [], notes: [], blocked: false });
    let admit!: (value: unknown) => void;
    submitCheckInAdmit.mockReturnValue(new Promise((resolve) => (admit = resolve)));
    renderPage();
    await screen.findByLabelText("Camera check-in");

    fireEvent.click(overlay().getByText("Manual search"));
    const input = await screen.findByLabelText("Search by name or email");
    fireEvent.change(input, { target: { value: "anna" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const confirm = await overlay().findByRole("button", { name: "Confirm check-in" });
    expect(confirm.getAttribute("aria-busy")).toBeNull();

    fireEvent.click(confirm);
    await waitFor(() =>
      expect(overlay().getByRole("button", { name: /Confirm check-in|Checking in/ }).getAttribute("aria-busy")).toBe("true"),
    );
    admit({ status: "VALID", confirmed: true, admittedAt: "2026-09-01T09:44:00.000Z", attendeeId: "att-1" });
  });
});
