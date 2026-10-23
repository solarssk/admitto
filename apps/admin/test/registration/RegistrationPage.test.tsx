// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes, useLocation } from "react-router";
import { ApiError } from "../../src/api/client.js";
import type { RegistrationCountsDto } from "../../src/api/types.js";
import { reportApiError } from "../../src/connection/ConnectionStateProvider.js";
import { RegistrationPage } from "../../src/pages/RegistrationPage.js";
import { deferred } from "../test-utils.js";

const fetchRegistrationCounts = vi.fn();
const goToLogin = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  fetchRegistrationCounts: (...args: unknown[]) => fetchRegistrationCounts(...args),
}));

vi.mock("../../src/connection/ConnectionStateProvider.js");
vi.mock("../../src/auth/login-navigation.js", () => ({ goToLogin: (...args: unknown[]) => goToLogin(...args) }));

// The Requests tab reads the requests: RegistrationRequestsTab.test.tsx has it. The page is tested around it.
vi.mock("../../src/registration/RegistrationRequestsTab.js", () => ({
  RegistrationRequestsTab: () => <p>The requests of the event</p>,
}));

// The Fields tab reads and edits the event's fields: RegistrationFieldsTab.test.tsx has it. The page is tested around it.
vi.mock("../../src/registration/RegistrationFieldsTab.js", () => ({
  RegistrationFieldsTab: () => <p>The attendee fields card</p>,
}));

// The Legal tab reads and edits the event's legal texts: RegistrationLegalTab.test.tsx has it. The page is tested around it.
vi.mock("../../src/registration/RegistrationLegalTab.js", () => ({
  RegistrationLegalTab: () => <p>The legal texts of the event</p>,
}));

/** The tabs that have nothing to show yet: a plain empty state that says what will be there. */
const TABS_TO_BUILD = [["access", "Access", "The registration mode and the ways guests can sign up will be set here."]] as const;

/** Shows the query string of the address, so a test can read what a click wrote to it. */
function SearchProbe() {
  return <div data-testid="search">{useLocation().search}</div>;
}

function renderAt(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/admin/events/evt-1/registration${search}`]}>
      <RegistrationPage />
      <SearchProbe />
    </MemoryRouter>,
  );
}

/** The page on the route of an event, as the app has it: the numbers of the requests are read for the event in the address. */
function renderForEvent(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/admin/events/evt-1/registration${search}`]}>
      <Routes>
        <Route path="/admin/events/:eventId/registration" element={<RegistrationPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function openTab(): HTMLElement {
  return screen.getByRole("tab", { selected: true });
}

const requestsTab = () => screen.getByRole("tab", { name: /Requests/ });

function counts(pending: number): RegistrationCountsDto {
  return {
    mode: "approval",
    by_status: { awaiting_email: 0, pending, waitlist: 2, accepted: 5, rejected: 1 },
    needs_decision: pending,
  };
}

beforeEach(() => {
  fetchRegistrationCounts.mockReset();
  fetchRegistrationCounts.mockResolvedValue(counts(3));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RegistrationPage", () => {
  it("has the page heading and the four tabs, with no number on Requests, and reads no numbers without an event", () => {
    renderAt();

    expect(screen.getByRole("heading", { level: 1, name: "Registration" })).toBeTruthy();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Requests", "Fields", "Access", "Legal"]);
    expect(fetchRegistrationCounts).not.toHaveBeenCalled();
  });

  it.each([
    ["", "Requests"],
    ["?tab=requests", "Requests"],
    ["?tab=fields", "Fields"],
    ["?tab=access", "Access"],
    ["?tab=legal", "Legal"],
    ["?tab=nope", "Requests"],
    ["?tab=", "Requests"],
  ])("opens the tab for the address %j: %s", (search, label) => {
    renderAt(search);

    expect(openTab().textContent).toBe(label);
    expect(screen.getByRole("tabpanel").getAttribute("aria-label")).toBe(label);
  });

  it.each(TABS_TO_BUILD)("shows the %s tab as a plain empty state that says what will be there", (id, label, sentence) => {
    renderAt(`?tab=${id}`);

    const panel = screen.getByRole("tabpanel", { name: label });
    expect(within(panel).getByRole("status").textContent).toBe(sentence);
    // A tab that has nothing to show yet is an empty list, not a failed load.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  });

  it("shows the requests in the Requests tab, and nothing of the placeholders", () => {
    renderAt("?tab=requests");

    const panel = screen.getByRole("tabpanel", { name: "Requests" });
    expect(within(panel).getByText("The requests of the event")).toBeTruthy();
    expect(within(panel).queryByRole("status")).toBeNull();
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  });

  it("shows the attendee fields in the Fields tab, and nothing of the placeholders", () => {
    renderAt("?tab=fields");

    const panel = screen.getByRole("tabpanel", { name: "Fields" });
    expect(within(panel).getByText("The attendee fields card")).toBeTruthy();
    expect(within(panel).queryByRole("status")).toBeNull();
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  });

  it("shows the legal texts in the Legal tab, and nothing of the placeholders", () => {
    renderAt("?tab=legal");

    const panel = screen.getByRole("tabpanel", { name: "Legal" });
    expect(within(panel).getByText("The legal texts of the event")).toBeTruthy();
    expect(within(panel).queryByRole("status")).toBeNull();
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  });

  it("builds the fields again each time its tab is opened, so it never shows what an earlier visit read", () => {
    renderAt("?tab=fields");
    const first = screen.getByText("The attendee fields card");

    fireEvent.click(screen.getByRole("tab", { name: "Access" }));
    expect(screen.queryByText("The attendee fields card")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Fields" }));

    expect(screen.getByText("The attendee fields card")).not.toBe(first);
  });

  it("opens the tab that is clicked and writes it to the address", () => {
    renderAt();

    fireEvent.click(screen.getByRole("tab", { name: "Access" }));

    expect(openTab().textContent).toBe("Access");
    expect(screen.getByRole("tabpanel", { name: "Access" })).toBeTruthy();
    expect(screen.getByTestId("search").textContent).toBe("?tab=access");
  });

  it("keeps only the open tab in the tab order and moves with the arrow, Home and End keys", () => {
    renderAt();
    const tabIndexes = () => screen.getAllByRole("tab").map((tab) => tab.tabIndex);
    expect(tabIndexes()).toEqual([0, -1, -1, -1]);

    fireEvent.keyDown(openTab(), { key: "ArrowRight" });
    expect(openTab().textContent).toBe("Fields");
    expect(document.activeElement).toBe(openTab());
    expect(tabIndexes()).toEqual([-1, 0, -1, -1]);

    fireEvent.keyDown(openTab(), { key: "End" });
    expect(openTab().textContent).toBe("Legal");

    fireEvent.keyDown(openTab(), { key: "ArrowRight" });
    expect(openTab().textContent).toBe("Requests");

    fireEvent.keyDown(openTab(), { key: "ArrowLeft" });
    expect(openTab().textContent).toBe("Legal");

    fireEvent.keyDown(openTab(), { key: "Home" });
    expect(openTab().textContent).toBe("Requests");
    expect(screen.getByTestId("search").textContent).toBe("?tab=requests");
  });
});

describe("RegistrationPage: the number on the Requests tab", () => {
  it("is the number of requests that wait for a decision (D-B11), whichever tab is open", async () => {
    renderForEvent("?tab=fields");

    await waitFor(() => expect(requestsTab().textContent).toBe("Requests3"));
    expect(fetchRegistrationCounts).toHaveBeenCalledWith("evt-1", expect.any(AbortSignal));
    expect(openTab().textContent).toBe("Fields");
  });

  it("is not there while the number is unknown, and is not there when no request waits", async () => {
    const read = deferred<RegistrationCountsDto>();
    fetchRegistrationCounts.mockReturnValueOnce(read.promise);
    renderForEvent();
    expect(requestsTab().textContent).toBe("Requests");

    await act(async () => read.resolve(counts(0)));

    expect(fetchRegistrationCounts).toHaveBeenCalledTimes(1);
    expect(requestsTab().textContent).toBe("Requests");
  });

  it("is left out, without a word, when the numbers cannot be read: the tab has the error and its Retry", async () => {
    const read = deferred<RegistrationCountsDto>();
    fetchRegistrationCounts.mockReturnValueOnce(read.promise);
    renderForEvent();

    await act(async () => read.reject(new ApiError(500, "internal_error", "internal_error")));

    expect(requestsTab().textContent).toBe("Requests");
    expect(screen.queryByRole("alert")).toBeNull();
    // The page says nothing, but the connection state hears that the server failed.
    expect(reportApiError).toHaveBeenCalledWith(500);
    expect(goToLogin).not.toHaveBeenCalled();
  });

  it("hands the browser to the login page when the session has ended, and shows nothing first", async () => {
    fetchRegistrationCounts.mockRejectedValue(new ApiError(401, "authentication_required"));
    renderForEvent();

    await waitFor(() => expect(goToLogin).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?next=/)));
    expect(reportApiError).toHaveBeenCalledWith(401);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("belongs to the event in the address, not to the one before it", async () => {
    const view = render(
      <MemoryRouter initialEntries={["/admin/events/evt-1/registration"]}>
        <Routes>
          <Route path="/admin/events/:eventId/registration" element={<RegistrationPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(requestsTab().textContent).toBe("Requests3"));
    view.unmount();

    fetchRegistrationCounts.mockResolvedValue(counts(0));
    render(
      <MemoryRouter initialEntries={["/admin/events/evt-2/registration"]}>
        <Routes>
          <Route path="/admin/events/:eventId/registration" element={<RegistrationPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(fetchRegistrationCounts).toHaveBeenLastCalledWith("evt-2", expect.any(AbortSignal)));
    expect(requestsTab().textContent).toBe("Requests");
  });

  it("is the number of the other event, never the one before it, when the address changes under the page that is open", async () => {
    const router = createMemoryRouter([{ path: "/admin/events/:eventId/registration", element: <RegistrationPage /> }], {
      initialEntries: ["/admin/events/evt-1/registration"],
    });
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(requestsTab().textContent).toBe("Requests3"));

    const read = deferred<RegistrationCountsDto>();
    fetchRegistrationCounts.mockReturnValueOnce(read.promise);
    await act(async () => {
      await router.navigate("/admin/events/evt-2/registration");
    });

    expect(fetchRegistrationCounts).toHaveBeenLastCalledWith("evt-2", expect.any(AbortSignal));
    // While the other event's numbers are on their way the tab has none: the three requests are not its own.
    expect(requestsTab().textContent).toBe("Requests");
    await act(async () => read.resolve(counts(7)));
    expect(requestsTab().textContent).toBe("Requests7");
  });
});
