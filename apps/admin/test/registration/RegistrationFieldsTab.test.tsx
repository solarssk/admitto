// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, MemoryRouter, Outlet, Route, RouterProvider, Routes } from "react-router";
import { ToastProvider } from "@admitto/ui";
import { ApiError } from "../../src/api/client.js";
import type { EventCustomFieldDto, EventDto } from "../../src/api/types.js";
import { reportApiError } from "../../src/connection/ConnectionStateProvider.js";
import { RegistrationPage } from "../../src/pages/RegistrationPage.js";
import { RequirementsPage } from "../../src/pages/RequirementsPage.js";
import { LOAD_TIMEOUT_MESSAGE, SLOW_NOTICE_TEXT } from "../../src/utils/loading-timing.js";
import { advanceTimers, deferred, hangUntilAborted } from "../test-utils.js";

const fetchEventCustomFields = vi.fn();
const fetchEventItems = vi.fn();
const updateEventCustomField = vi.fn();
const reorderEventCustomFields = vi.fn();
const deleteEventCustomField = vi.fn();
const createEventCustomField = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  fetchEventCustomFields: (...args: unknown[]) => fetchEventCustomFields(...args),
  fetchEventItems: (...args: unknown[]) => fetchEventItems(...args),
  updateEventCustomField: (...args: unknown[]) => updateEventCustomField(...args),
  reorderEventCustomFields: (...args: unknown[]) => reorderEventCustomFields(...args),
  deleteEventCustomField: (...args: unknown[]) => deleteEventCustomField(...args),
  createEventCustomField: (...args: unknown[]) => createEventCustomField(...args),
  fetchEventCustomFieldOptionUsage: vi.fn(async () => ({})),
}));

vi.mock("../../src/connection/ConnectionStateProvider.js");

const addToast = vi.fn();
vi.mock("@admitto/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/ui")>();
  return { ...actual, useToast: () => ({ addToast }) };
});

const event = { id: "evt-1", title: "Demo", archived_at: null } as EventDto;

function field(id: string, label: string, extra: Partial<EventCustomFieldDto> = {}): EventCustomFieldDto {
  return {
    id,
    source_field: id.replace("field-", ""),
    label,
    description: null,
    type: "text",
    required: false,
    show_on_form: false,
    display_order: null,
    options: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

const dietary = field("field-dietary", "Dietary requirements", { description: "Allergies and meal preferences", show_on_form: true, display_order: 0 });
const shirt = field("field-shirt", "Shirt size", { type: "select", options: ["S", "M"], required: true, show_on_form: true, display_order: 1 });
const parking = field("field-parking", "Needs parking", { type: "boolean", display_order: 2 });

/** What the event frame gives every page of an event: the event, in the outlet context. */
function EventFrame() {
  return <Outlet context={{ event }} />;
}

function renderTab() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={["/admin/events/evt-1/registration?tab=fields"]}>
        <Routes>
          <Route element={<EventFrame />}>
            <Route path="/admin/events/:eventId/registration" element={<RegistrationPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

const placeholder = () => screen.queryByRole("status", { name: "Loading attendee fields" });
const fieldsPanel = () => screen.getByRole("tabpanel", { name: "Fields" });
const rowNames = () =>
  within(fieldsPanel())
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.querySelector(".requirements-item-name")?.textContent);

/** Waits until the card is on screen: the placeholder draws the same title and headings, so a title alone is not the answer. */
async function cardLoaded() {
  await waitFor(() => expect(placeholder()).toBeNull());
}

beforeEach(() => {
  fetchEventItems.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("RegistrationFieldsTab: a route without an event", () => {
  it("says there is no event, without reading anything", () => {
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/admin/registration?tab=fields"]}>
          <Routes>
            <Route path="/admin/registration" element={<RegistrationPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );

    expect(screen.getByText("Missing event.")).toBeTruthy();
    expect(fetchEventCustomFields).not.toHaveBeenCalled();
  });
});

describe("RegistrationFieldsTab: the first read", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // A read that a test has not set up hangs, instead of answering with nothing.
    fetchEventCustomFields.mockImplementation(hangUntilAborted as never);
  });

  it("holds the room of the card invisibly for 200ms, then draws it grey with its real title and headings, and says it is taking longer after 8 seconds", async () => {
    renderTab();
    await advanceTimers(0);

    const held = placeholder() as HTMLElement;
    expect(held.classList.contains("at-loading-hold")).toBe(true);
    for (const text of ["Attendee fields", "Field", "Description", "Required", "On the form"]) {
      expect(within(held).getByText(text)).toBeTruthy();
    }
    // The shapes are decoration; nothing claims that there is nothing yet, and there is nothing to add to before the read.
    expect(held.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    expect(held.querySelector(".requirements-section--registration")).not.toBeNull();
    expect(screen.queryByText(/No attendee fields yet/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Add field" })).toBeNull();
    // The page's own header and tabs stay.
    expect(screen.getByRole("heading", { name: "Registration" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Fields", selected: true })).toBeTruthy();

    await advanceTimers(200);
    expect((placeholder() as HTMLElement).classList.contains("at-loading-hold")).toBe(false);
    await advanceTimers(7_799);
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
    await advanceTimers(1);
    expect(screen.getByText(SLOW_NOTICE_TEXT)).toBeTruthy();
  });

  it("fades the card in where the placeholder was once the read has answered", async () => {
    const answer = deferred<EventCustomFieldDto[]>();
    fetchEventCustomFields.mockReturnValueOnce(answer.promise);
    renderTab();
    await advanceTimers(0);
    expect((placeholder() as HTMLElement).closest(".at-fade-in")).toBeNull();

    await act(async () => answer.resolve([dietary]));
    await advanceTimers(500);

    expect(placeholder()).toBeNull();
    expect(screen.getByText("Attendee fields").closest(".at-fade-in")).not.toBeNull();
  });

  it("never draws the placeholder for an answer that comes within 200ms", async () => {
    fetchEventCustomFields.mockResolvedValueOnce([dietary]);
    renderTab();
    await advanceTimers(0);

    expect(placeholder()).toBeNull();
    expect(screen.getByRole("switch", { name: "Dietary requirements on the form" })).toBeTruthy();
  });

  it("ends in an error after 30 seconds, with a Retry that stays on screen, busy, with its focus, and hands the focus to the tab when it works", async () => {
    renderTab();
    await advanceTimers(0);
    await advanceTimers(30_000);
    await advanceTimers(0);
    expect(screen.getByRole("alert").textContent).toContain(LOAD_TIMEOUT_MESSAGE);
    expect(screen.getByRole("alert").textContent).toContain("Could not load attendee fields");

    const answer = deferred<EventCustomFieldDto[]>();
    fetchEventCustomFields.mockReturnValueOnce(answer.promise);
    const retry = screen.getByRole("button", { name: "Retry" });
    retry.focus();
    fireEvent.click(retry);
    await advanceTimers(500);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(retry.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(retry);
    expect(screen.getByRole("alert").textContent).toContain(LOAD_TIMEOUT_MESSAGE);
    expect(placeholder()).toBeNull();

    await act(async () => answer.resolve([dietary]));
    await advanceTimers(500);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("switch", { name: "Dietary requirements on the form" })).toBeTruthy();
    expect(document.activeElement).toBe(fieldsPanel());
  });

  it("announces a Retry that fails again with the same message: the message is mounted afresh in its live region", async () => {
    fetchEventCustomFields.mockReset();
    fetchEventCustomFields.mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline"));
    renderTab();
    await advanceTimers(0);

    const first = screen.getByText("Could not load attendee fields.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await advanceTimers(500);
    // The 400ms minimum of the busy Retry ends in a timer that is set when the answer is in.
    await advanceTimers(400);

    expect(screen.getByText("Could not load attendee fields.")).not.toBe(first);
  });

  it("reads the fields of the event once, with a signal that stops the request when the tab goes", async () => {
    const { unmount } = renderTab();
    await advanceTimers(0);

    expect(fetchEventCustomFields).toHaveBeenCalledTimes(1);
    const [eventId, signal] = fetchEventCustomFields.mock.calls[0] as [string, AbortSignal];
    expect(eventId).toBe("evt-1");
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it("is a fresh tab for another event, with a placeholder instead of the previous event's fields", async () => {
    fetchEventCustomFields.mockImplementation(async (eventId: string) => {
      if (eventId === "evt-b") return new Promise<never>(() => {});
      return [dietary];
    });
    const router = createMemoryRouter(
      [{ element: <EventFrame />, children: [{ path: "/admin/events/:eventId/registration", element: <RegistrationPage /> }] }],
      { initialEntries: ["/admin/events/evt-a/registration?tab=fields"] },
    );
    render(
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>,
    );
    await advanceTimers(0);
    expect(screen.getByRole("switch", { name: "Dietary requirements on the form" })).toBeTruthy();

    await act(async () => {
      await router.navigate("/admin/events/evt-b/registration?tab=fields");
    });
    await advanceTimers(0);

    expect(placeholder()).not.toBeNull();
    expect(screen.queryByRole("switch", { name: "Dietary requirements on the form" })).toBeNull();
  });
});

describe("RegistrationFieldsTab: what the read answers", () => {
  it("shows the card with the fields in the order the server gave them", async () => {
    fetchEventCustomFields.mockResolvedValueOnce([parking, dietary, shirt]);
    renderTab();
    await cardLoaded();

    expect(screen.getByText("Attendee fields")).toBeTruthy();
    expect(rowNames()).toEqual(["Needs parking", "Dietary requirements", "Shirt size"]);
    expect((screen.getByRole("switch", { name: "Needs parking on the form" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("switch", { name: "Shirt size on the form" }) as HTMLInputElement).checked).toBe(true);
  });

  it("says there are no fields yet as a plain empty list, not a failure, with the card's Add field", async () => {
    fetchEventCustomFields.mockResolvedValueOnce([]);
    renderTab();
    await cardLoaded();

    expect(screen.getByText("No attendee fields yet")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Add field" })).toBeTruthy();
  });

  it("shows the same fields as the Requirements page, read the same way", async () => {
    const answer = [dietary, shirt, parking];
    fetchEventCustomFields.mockResolvedValue(answer);
    const requirements = render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/admin/events/evt-1/requirements"]}>
          <Routes>
            <Route element={<EventFrame />}>
              <Route path="/admin/events/:eventId/requirements" element={<RequirementsPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );
    await screen.findByText("Custom attendee fields");
    await waitFor(() => expect(screen.queryByRole("status", { name: "Loading requirements" })).toBeNull());
    const onRequirements = within(screen.getByText("Custom attendee fields").closest("section")!)
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.querySelector(".requirements-item-name")?.textContent);
    const requirementsCall = fetchEventCustomFields.mock.calls[0] as [string, AbortSignal];
    requirements.unmount();
    fetchEventCustomFields.mockClear();

    renderTab();
    await cardLoaded();
    const registrationCall = fetchEventCustomFields.mock.calls[0] as [string, AbortSignal];

    expect(rowNames()).toEqual(onRequirements);
    expect(rowNames()).toEqual(["Dietary requirements", "Shirt size", "Needs parking"]);
    expect(registrationCall[0]).toBe(requirementsCall[0]);
    expect(registrationCall[1]).toBeInstanceOf(AbortSignal);
  });
});

describe("RegistrationFieldsTab: a load that failed", () => {
  it("shows a retry EmptyState on a failed load, and recovers when Retry succeeds", async () => {
    fetchEventCustomFields.mockRejectedValueOnce(new ApiError(500, "server error")).mockResolvedValueOnce([dietary]);

    renderTab();

    await screen.findByText("Could not load attendee fields");
    expect(screen.getByText("Something went wrong. Try again.")).toBeTruthy();
    expect(reportApiError).toHaveBeenCalledWith(500);
    // A failure is an alert in the tab, never a toast and never an empty list.
    expect(within(fieldsPanel()).getByRole("alert")).toBeTruthy();
    expect(addToast).not.toHaveBeenCalled();
    expect(screen.queryByText("No attendee fields yet")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("switch", { name: "Dietary requirements on the form" })).toBeTruthy();
    expect(screen.queryByText("Could not load attendee fields")).toBeNull();
  });

  it("shows the generic error when loading fails outside the API layer", async () => {
    fetchEventCustomFields.mockRejectedValueOnce(new Error("network unavailable"));

    renderTab();

    await screen.findByText("Could not load attendee fields");
    expect(screen.getByText("Could not load attendee fields.")).toBeTruthy();
    expect(reportApiError).not.toHaveBeenCalled();
  });

  it("redirects to login when the load returns 401", async () => {
    fetchEventCustomFields.mockRejectedValueOnce(new ApiError(401, "authentication_required"));
    const assignSpy = vi.fn();
    const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/admin/events/evt-1/registration", assign: assignSpy },
    });
    try {
      renderTab();
      await waitFor(() => expect(assignSpy).toHaveBeenCalledWith("/login?next=%2Fadmin%2Fevents%2Fevt-1%2Fregistration"));
      expect(reportApiError).toHaveBeenCalledWith(401);
      // The browser is on its way to the login page: no error flashes up first.
      expect(screen.queryByRole("alert")).toBeNull();
    } finally {
      if (locationDescriptor) Object.defineProperty(window, "location", locationDescriptor);
    }
  });
});

describe("RegistrationFieldsTab: a change", () => {
  it("reads the list again after a field is deleted, keeping the card meanwhile", async () => {
    const again = deferred<EventCustomFieldDto[]>();
    fetchEventCustomFields.mockResolvedValueOnce([dietary, shirt]).mockReturnValueOnce(again.promise);
    deleteEventCustomField.mockResolvedValueOnce(undefined);
    renderTab();
    await cardLoaded();

    fireEvent.click(screen.getAllByRole("button", { name: "Delete field" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteEventCustomField).toHaveBeenCalledWith("evt-1", "field-dietary"));
    await waitFor(() => expect(fetchEventCustomFields).toHaveBeenCalledTimes(2));

    // The card stays, blocked, until the answer is in.
    expect(rowNames()).toEqual(["Dietary requirements", "Shirt size"]);
    await act(async () => again.resolve([shirt]));
    expect(rowNames()).toEqual(["Shirt size"]);
  });

  it("replaces the card with the error when the read after a change fails, since the card may be wrong", async () => {
    fetchEventCustomFields.mockResolvedValueOnce([dietary]).mockRejectedValueOnce(new ApiError(500, "server error"));
    deleteEventCustomField.mockResolvedValueOnce(undefined);
    renderTab();
    await cardLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Delete field" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await screen.findByText("Could not load attendee fields");
    expect(screen.queryByText("Attendee fields")).toBeNull();
  });

  it("adds a field that is on the form, then reads the list again", async () => {
    const added = field("field-plate", "Plate number", { show_on_form: true });
    fetchEventCustomFields.mockResolvedValueOnce([dietary]).mockResolvedValueOnce([dietary, added]);
    createEventCustomField.mockResolvedValueOnce(added);
    renderTab();
    await cardLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    fireEvent.change(screen.getByLabelText("Display label"), { target: { value: "Plate number" } });
    fireEvent.click(screen.getByRole("button", { name: "Create field" }));

    await waitFor(() => expect(rowNames()).toEqual(["Dietary requirements", "Plate number"]));
    expect(createEventCustomField).toHaveBeenCalledWith("evt-1", expect.objectContaining({ source_field: "plate_number", show_on_form: true }));
    expect((screen.getByRole("switch", { name: "Plate number on the form" }) as HTMLInputElement).checked).toBe(true);
  });

  it("shows a switch that was saved at once, from the answer, without reading the list again", async () => {
    fetchEventCustomFields.mockResolvedValueOnce([dietary, parking]);
    updateEventCustomField.mockResolvedValueOnce({ ...parking, show_on_form: true });
    renderTab();
    await cardLoaded();

    fireEvent.click(screen.getByRole("switch", { name: "Needs parking on the form" }));

    await waitFor(() => expect((screen.getByRole("switch", { name: "Needs parking on the form" }) as HTMLInputElement).checked).toBe(true));
    expect(updateEventCustomField).toHaveBeenCalledWith("evt-1", "field-parking", { show_on_form: true });
    expect(fetchEventCustomFields).toHaveBeenCalledTimes(1);
  });

  it("shows the order that a move saved at once, from the answer, without reading the list again", async () => {
    fetchEventCustomFields.mockResolvedValueOnce([dietary, shirt, parking]);
    reorderEventCustomFields.mockResolvedValueOnce([dietary, parking, shirt]);
    renderTab();
    await cardLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Move Needs parking up" }));

    await waitFor(() => expect(rowNames()).toEqual(["Dietary requirements", "Needs parking", "Shirt size"]));
    expect(reorderEventCustomFields).toHaveBeenCalledWith("evt-1", ["field-dietary", "field-parking", "field-shirt"]);
    expect(fetchEventCustomFields).toHaveBeenCalledTimes(1);
  });

  it("reads the list again when a move finds that it changed, and shows what the server has", async () => {
    const other = field("field-other", "Added meanwhile", { display_order: 3 });
    fetchEventCustomFields.mockResolvedValueOnce([dietary, shirt]).mockResolvedValueOnce([dietary, shirt, other]);
    reorderEventCustomFields.mockRejectedValueOnce(new ApiError(409, "stale_write", "stale_write"));
    renderTab();
    await cardLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Move Dietary requirements down" }));

    await waitFor(() => expect(rowNames()).toEqual(["Dietary requirements", "Shirt size", "Added meanwhile"]));
    expect(fetchEventCustomFields).toHaveBeenCalledTimes(2);
    expect(addToast).toHaveBeenCalledWith(expect.stringMatching(/Move the field again\./), "warning");
  });
});
