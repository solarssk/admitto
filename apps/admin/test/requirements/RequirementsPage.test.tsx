// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from "react-router";
import { ToastProvider } from "@admitto/ui";
import { RequirementsPage } from "../../src/pages/RequirementsPage.js";
import type { EventItemDto } from "../../src/api/types.js";
import { reportApiError } from "../../src/connection/ConnectionStateProvider.js";
import { LOAD_TIMEOUT_MESSAGE, SLOW_NOTICE_TEXT } from "../../src/utils/loading-timing.js";
import { advanceTimers, deferred, hangUntilAborted, isOff } from "../test-utils.js";

const fetchEventItems = vi.fn();
const fetchEventCustomFields = vi.fn();
const updateEventItem = vi.fn();
const createEventItem = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  fetchEventItems: (...args: unknown[]) => fetchEventItems(...args),
  fetchEventCustomFields: (...args: unknown[]) => fetchEventCustomFields(...args),
  updateEventItem: (...args: unknown[]) => updateEventItem(...args),
  createEventItem: (...args: unknown[]) => createEventItem(...args),
  deleteEventItem: vi.fn(),
  deleteEventCustomField: vi.fn(),
}));

vi.mock("../../src/connection/ConnectionStateProvider.js");

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useOutletContext: () => ({
      event: { id: "evt-1", title: "Demo", archived_at: null },
    }),
  };
});

const addToast = vi.fn();
vi.mock("@admitto/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/ui")>();
  return { ...actual, useToast: () => ({ addToast }) };
});

const badgeItem: EventItemDto = {
  id: "item-badge",
  key: "badge",
  label: "Badge",
  description: null,
  type: "item",
  enabled: true,
  icon: null,
  config: { issue_on_checkin: true, requires_return: false },
};

const hintField = (source_field: string, label: string, applies_to?: "guest" | "companion") => ({
  id: source_field,
  source_field,
  label,
  description: null,
  type: "text",
  required: false,
  show_on_form: true,
  display_order: null,
  options: null,
  rules: null,
  ...(applies_to ? { applies_to } : {}),
  created_at: "2026-01-01T00:00:00.000Z",
});

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={["/admin/events/evt-1/requirements"]}>
        <Routes>
          <Route path="/admin/events/:eventId/requirements" element={<RequirementsPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

/** The page next to the Registration page, so that a click on the note's link has somewhere to go and the router tells where. */
function renderPageWithRegistration() {
  const router = createMemoryRouter(
    [
      { path: "/admin/events/:eventId/requirements", element: <RequirementsPage /> },
      { path: "/admin/events/:eventId/registration", element: <p>The Registration page</p> },
    ],
    { initialEntries: ["/admin/events/evt-1/requirements"] },
  );
  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  );
  return router;
}

const placeholder = () => screen.queryByRole("status", { name: "Loading requirements" });
const requirementsRegion = () => screen.getByRole("region", { name: "Requirements" });
const FIELDS_LINK = "Fields tab of the Registration page";
const fieldsLink = () => screen.getByRole("link", { name: FIELDS_LINK });

/** Waits until the card is on screen: its placeholder draws the same title and headings, so a title alone is not the answer. */
async function pageLoaded() {
  await waitFor(() => expect(placeholder()).toBeNull());
}

beforeEach(() => {
  // Most tests here don't care about the attendee fields (the page reads them for the hints of its items); give every test a
  // working default so Promise.all in RequirementsPage's load() doesn't reject for unrelated tests.
  // Tests that do care override this before calling renderPage().
  fetchEventCustomFields.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("RequirementsPage: a route without an event", () => {
  it("says there is no event, without reading anything", () => {
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/admin/requirements"]}>
          <Routes>
            <Route path="/admin/requirements" element={<RequirementsPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );

    expect(screen.getByText("Missing event.")).toBeTruthy();
    expect(fetchEventItems).not.toHaveBeenCalled();
    expect(fetchEventCustomFields).not.toHaveBeenCalled();
  });
});

describe("RequirementsPage: the first read", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // A read that a test has not set up hangs, instead of answering with nothing.
    fetchEventItems.mockImplementation(hangUntilAborted as never);
  });

  it("holds the room of the card invisibly for 200ms, then draws a grey Event items card with its real title and headings, and says it is taking longer after 8 seconds", async () => {
    renderPage();
    await advanceTimers(0);

    const held = placeholder() as HTMLElement;
    expect(held.classList.contains("at-loading-hold")).toBe(true);
    for (const text of ["Event items", "Item", "Description", "Active"]) {
      expect(within(held).getByText(text)).toBeTruthy();
    }
    // The one card of the page: the attendee fields have no place in it, and the note about them comes with the answer.
    expect(held.querySelectorAll(".at-card")).toHaveLength(1);
    for (const text of ["Custom attendee fields", "Attendee fields", "Field", "Required"]) {
      expect(within(held).queryByText(text)).toBeNull();
    }
    expect(screen.queryByRole("link", { name: FIELDS_LINK })).toBeNull();
    // The shapes are decoration; nothing claims that there is nothing yet, and there is nothing to add to before the read.
    expect(held.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByText(/No items yet/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add field" })).toBeNull();
    // The page's own header stays.
    expect(screen.getByRole("heading", { name: "Requirements" })).toBeTruthy();

    await advanceTimers(200);
    expect((placeholder() as HTMLElement).classList.contains("at-loading-hold")).toBe(false);
    await advanceTimers(7_799);
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
    await advanceTimers(1);
    expect(screen.getByText(SLOW_NOTICE_TEXT)).toBeTruthy();
  });

  it("fades the card in where the placeholder was once the read has answered", async () => {
    const answer = deferred<EventItemDto[]>();
    fetchEventItems.mockReturnValueOnce(answer.promise);
    renderPage();
    await advanceTimers(0);
    expect((placeholder() as HTMLElement).closest(".at-fade-in")).toBeNull();

    await act(async () => answer.resolve([badgeItem]));
    await advanceTimers(500);
    expect(placeholder()).toBeNull();
    expect(screen.getByRole("switch", { name: "Disable Badge" }).closest(".at-fade-in")).not.toBeNull();
  });

  it("never draws the placeholder for an answer that comes within 200ms", async () => {
    fetchEventItems.mockResolvedValueOnce([badgeItem]);
    renderPage();
    await advanceTimers(0);

    expect(placeholder()).toBeNull();
    expect(screen.getByRole("switch", { name: "Disable Badge" })).toBeTruthy();
  });

  it("ends in an error after 30 seconds, with a Retry that stays on screen, busy, with its focus, and hands the focus to the page's region when it works", async () => {
    fetchEventItems.mockImplementationOnce(hangUntilAborted as never);
    renderPage();
    await advanceTimers(0);
    await advanceTimers(30_000);
    await advanceTimers(0);
    expect(screen.getByRole("alert").textContent).toContain(LOAD_TIMEOUT_MESSAGE);
    expect(screen.getByRole("alert").textContent).toContain("Could not load requirements");

    const answer = deferred<EventItemDto[]>();
    fetchEventItems.mockReturnValueOnce(answer.promise);
    const retry = screen.getByRole("button", { name: "Retry" });
    retry.focus();
    fireEvent.click(retry);
    await advanceTimers(500);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(retry.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(retry);
    expect(screen.getByRole("alert").textContent).toContain(LOAD_TIMEOUT_MESSAGE);
    expect(placeholder()).toBeNull();

    await act(async () => answer.resolve([badgeItem]));
    await advanceTimers(500);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("switch", { name: "Disable Badge" })).toBeTruthy();
    expect(document.activeElement).toBe(requirementsRegion());
  });

  it("announces a Retry that fails again with the same message: the message is mounted afresh in its live region", async () => {
    fetchEventItems.mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline"));
    renderPage();
    await advanceTimers(0);

    const first = screen.getByText("Could not load requirements.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await advanceTimers(500);
    // The 400ms minimum of the busy Retry ends in a timer that is set when the answer is in.
    await advanceTimers(400);

    expect(screen.getByText("Could not load requirements.")).not.toBe(first);
  });

  it("reads the items and the fields of the event once, with a signal that stops the request when the page goes", async () => {
    const { unmount } = renderPage();
    await advanceTimers(0);

    expect(fetchEventItems).toHaveBeenCalledTimes(1);
    expect(fetchEventCustomFields).toHaveBeenCalledTimes(1);
    const [eventId, signal] = fetchEventItems.mock.calls[0] as [string, AbortSignal];
    const [fieldsEventId, fieldsSignal] = fetchEventCustomFields.mock.calls[0] as [string, AbortSignal];
    expect(eventId).toBe("evt-1");
    expect(fieldsEventId).toBe("evt-1");
    expect(signal.aborted).toBe(false);
    expect(fieldsSignal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
    expect(fieldsSignal.aborted).toBe(true);
  });

  it("is a fresh page for another event, with a placeholder instead of the previous event's items", async () => {
    fetchEventItems.mockImplementation(async (eventId: string) => {
      if (eventId === "evt-b") return new Promise<never>(() => {});
      return [badgeItem];
    });
    const router = createMemoryRouter([{ path: "/admin/events/:eventId/requirements", element: <RequirementsPage /> }], {
      initialEntries: ["/admin/events/evt-a/requirements"],
    });
    render(
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>,
    );
    await advanceTimers(0);
    expect(screen.getByRole("switch", { name: "Disable Badge" })).toBeTruthy();

    await act(async () => {
      await router.navigate("/admin/events/evt-b/requirements");
    });
    await advanceTimers(0);

    expect(placeholder()).not.toBeNull();
    expect(screen.queryByRole("switch", { name: "Disable Badge" })).toBeNull();
  });
});

describe("RequirementsPage load failure", () => {
  it("shows a retry EmptyState on a failed load, and recovers when Retry succeeds", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventItems
      .mockRejectedValueOnce(new ApiError(500, "server error"))
      .mockResolvedValueOnce([badgeItem]);

    renderPage();

    await screen.findByText("Could not load requirements");
    expect(screen.getByText("Something went wrong. Try again.")).toBeTruthy();
    expect(reportApiError).toHaveBeenCalledWith(500);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.queryByText("Could not load requirements")).toBeNull();
    });
    expect(await screen.findByRole("switch", { name: "Disable Badge" })).toBeTruthy();
  });

  it("gives an event-access error, not the generic title, for a forbidden load", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventItems.mockRejectedValueOnce(new ApiError(403, "not_for_operator"));

    renderPage();

    expect(await screen.findByText("You do not have access to this event.")).toBeTruthy();
    // The EmptyState title must match this specific cause, not the generic "Could not load
    // requirements" heading used for every other load failure.
    expect(screen.getByText("You do not have access to this event")).toBeTruthy();
    expect(screen.queryByText("Could not load requirements")).toBeNull();
    // Access can be granted meanwhile, so the Retry stays.
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(reportApiError).toHaveBeenCalledWith(403);
  });

  it("shows the generic error when loading fails outside the API layer", async () => {
    fetchEventItems.mockRejectedValueOnce(new Error("network unavailable"));

    renderPage();

    await screen.findByText("Could not load requirements");
    expect(screen.getByText("Could not load requirements.")).toBeTruthy();
    expect(reportApiError).not.toHaveBeenCalled();
  });

  it("redirects to login when the load returns 401", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventItems.mockRejectedValueOnce(new ApiError(401, "authentication_required"));
    const assignSpy = vi.fn();
    const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/admin/events/evt-1/requirements", assign: assignSpy },
    });
    try {
      renderPage();
      await waitFor(() =>
        expect(assignSpy).toHaveBeenCalledWith(
          "/login?next=%2Fadmin%2Fevents%2Fevt-1%2Frequirements",
        ),
      );
      expect(reportApiError).toHaveBeenCalledWith(401);
      // The browser is on its way to the login page: no error flashes up first.
      expect(screen.queryByRole("alert")).toBeNull();
    } finally {
      if (locationDescriptor) Object.defineProperty(window, "location", locationDescriptor);
    }
  });
});

describe("RequirementsPage — item enable/disable toggle", () => {
  it("shows the enabled toast when toggling an item back on", async () => {
    const disabledGiftbag: EventItemDto = {
      ...badgeItem,
      id: "item-gift",
      key: "giftbag",
      label: "Gift bag",
      enabled: false,
    };
    fetchEventItems.mockResolvedValue([disabledGiftbag]);
    updateEventItem.mockResolvedValueOnce({ ...disabledGiftbag, enabled: true });

    renderPage();
    fireEvent.click(await screen.findByRole("switch", { name: "Enable Gift bag" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("Item enabled", "success");
    });
  });
});

describe("RequirementsPage — Add item and Edit item", () => {
  it("shows the Add item modal header subtitle", async () => {
    fetchEventItems.mockResolvedValue([]);

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));

    expect(screen.getByRole("heading", { name: "Add item" })).toBeTruthy();
    expect(
      screen.getByText(/physical item or resource issued or tracked at check-in/i),
    ).toBeTruthy();
  });

  it("shows an inline error and does not create an item when the name has no usable characters", async () => {
    fetchEventItems.mockResolvedValue([]);

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "!!!" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(screen.getByText("Enter a name using letters or numbers.")).toBeTruthy();
    });
    expect(addToast).not.toHaveBeenCalled();
    expect(createEventItem).not.toHaveBeenCalled();
  });

  it("clears the Add item name error once the user edits the input", async () => {
    fetchEventItems.mockResolvedValue([]);

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));
    const input = screen.getByLabelText("Item name");
    fireEvent.change(input, { target: { value: "!!!" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(screen.getByText("Enter a name using letters or numbers.")).toBeTruthy();
    });

    fireEvent.change(input, { target: { value: "Gift bag" } });

    expect(screen.queryByText("Enter a name using letters or numbers.")).toBeNull();
  });

  it("shows a warning toast when creating an item whose name already exists", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventItems.mockResolvedValue([]);
    createEventItem.mockRejectedValueOnce(new ApiError(409, "key_conflict", "key_conflict"));

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "Gift bag" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("An item with this name already exists.", "warning");
    });
  });

  it("keeps the Add item modal open on a click outside, and closes it via Cancel, without creating", async () => {
    fetchEventItems.mockResolvedValue([]);

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "Lanyard" } });
    // A form: a stray click outside must not throw away what was typed.
    const backdrop = document.querySelector(".at-modal-backdrop") as HTMLElement;
    fireEvent.click(backdrop);
    expect(screen.getByLabelText("Item name")).toHaveProperty("value", "Lanyard");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Item name")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByLabelText("Item name")).toHaveProperty("value", "");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Item name")).toBeNull();
    expect(createEventItem).not.toHaveBeenCalled();
  });

  it("opens the edit drawer for an item when clicking Edit item", async () => {
    fetchEventItems.mockResolvedValue([badgeItem]);

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edit item" }));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Badge" })).toBeTruthy();
  });

  it("offers the questions about the guest as hints for an item, and not the questions about a companion: the hint shows the attendee's own answer", async () => {
    fetchEventItems.mockResolvedValue([badgeItem]);
    fetchEventCustomFields.mockResolvedValue([
      hintField("shirt", "Shirt size"),
      hintField("badge_name", "Badge name", "companion"),
      hintField("diet", "Diet", "guest"),
    ]);

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edit item" }));
    const drawer = await screen.findByRole("dialog");

    expect(within(drawer).getByRole("checkbox", { name: "Shirt size" })).toBeTruthy();
    expect(within(drawer).getByRole("checkbox", { name: "Diet" })).toBeTruthy();
    expect(within(drawer).queryByRole("checkbox", { name: "Badge name" })).toBeNull();
    // The sentences of the drawer say where the fields are managed, and it is not on this page.
    expect(within(drawer).getByText(/in the "Attendee fields" card on the Fields tab of the Registration page\./)).toBeTruthy();
    expect(within(drawer).queryByText(/card above/)).toBeNull();
    // The page has no list of the fields of its own: the companion's question, which the drawer leaves out, is nowhere on it.
    expect(screen.queryByText("Badge name")).toBeNull();
    expect(screen.queryByText("Companion")).toBeNull();
  });

  it("saves the hint about a companion that an item already holds as it was read, next to the hints about the guest that are ticked", async () => {
    fetchEventItems.mockResolvedValue([{ ...badgeItem, config: { ...badgeItem.config, content_fields: ["shirt", "badge_name"] } }]);
    fetchEventCustomFields.mockResolvedValue([hintField("shirt", "Shirt size"), hintField("badge_name", "Badge name", "companion"), hintField("diet", "Diet")]);
    updateEventItem.mockResolvedValueOnce(badgeItem);

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edit item" }));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).queryByRole("checkbox", { name: "Badge name" })).toBeNull();
    fireEvent.click(within(drawer).getByRole("checkbox", { name: "Diet" }));
    fireEvent.click(within(drawer).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateEventItem).toHaveBeenCalledTimes(1));
    expect(updateEventItem).toHaveBeenCalledWith("evt-1", "item-badge", expect.objectContaining({ config: expect.objectContaining({ content_fields: ["shirt", "badge_name", "diet"] }) }));
  });

  it("closes the Add item modal on Escape", async () => {
    fetchEventItems.mockResolvedValue([]);

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));
    expect(screen.getByLabelText("Item name")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByLabelText("Item name")).toBeNull();
  });

  it("Event items table has column headers", async () => {
    fetchEventItems.mockResolvedValue([badgeItem]);

    renderPage();
    await pageLoaded();

    expect(screen.getByRole("columnheader", { name: "Item" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Description" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Active" })).toBeTruthy();
  });

  it("shows an item's description in the table", async () => {
    fetchEventItems.mockResolvedValue([{ ...badgeItem, description: "Physical badge at the door." }]);

    renderPage();

    expect(await screen.findByText("Physical badge at the door.")).toBeTruthy();
  });

  it("disambiguates two items that share a display label with their key", async () => {
    fetchEventItems.mockResolvedValue([
      { ...badgeItem, id: "item-a", key: "vip_badge", label: "VIP" },
      { ...badgeItem, id: "item-b", key: "vip_wristband", label: "VIP" },
    ]);

    renderPage();

    expect(await screen.findByText("VIP (vip_badge)")).toBeTruthy();
    expect(screen.getByText("VIP (vip_wristband)")).toBeTruthy();
    expect(screen.queryByText("VIP")).toBeNull();
  });

  it("clicking Add item again while the modal is already open closes it", async () => {
    fetchEventItems.mockResolvedValue([]);

    renderPage();
    const addItemButton = await screen.findByRole("button", { name: "Add" });
    fireEvent.click(addItemButton);
    expect(screen.getByLabelText("Item name")).toBeTruthy();

    fireEvent.click(addItemButton);

    expect(screen.queryByLabelText("Item name")).toBeNull();
  });

  it("flags a colliding name with the unique-suffix hint", async () => {
    fetchEventItems.mockResolvedValue([{ ...badgeItem, key: "gift_bag", label: "Gift bag" }]);

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "Gift bag" } });

    expect(await screen.findByText(/unique suffix added/)).toBeTruthy();
  });
});

const giftBag: EventItemDto = { ...badgeItem, id: "item-gift", key: "gift_bag", label: "Gift bag", config: { requires_return: false } };

async function addGiftBag() {
  fireEvent.click(await screen.findByRole("button", { name: "Add" }));
  fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "Gift bag" } });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
}

describe("RequirementsPage: after an action", () => {
  it("changes a toggled item in place, without reading the page again", async () => {
    fetchEventItems.mockResolvedValue([badgeItem]);
    updateEventItem.mockResolvedValueOnce({ ...badgeItem, enabled: false });

    renderPage();
    fireEvent.click(await screen.findByRole("switch", { name: "Disable Badge" }));

    expect(await screen.findByRole("switch", { name: "Enable Badge" })).toBeTruthy();
    expect(fetchEventItems).toHaveBeenCalledTimes(1);
  });

  it("changes only the toggled item, and leaves the others as they were", async () => {
    fetchEventItems.mockResolvedValue([badgeItem, giftBag]);
    updateEventItem.mockResolvedValueOnce({ ...giftBag, enabled: false });

    renderPage();
    fireEvent.click(await screen.findByRole("switch", { name: "Disable Gift bag" }));

    expect(await screen.findByRole("switch", { name: "Enable Gift bag" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Disable Badge" })).toBeTruthy();
  });

  it("keeps the card on screen, blocked, while the refresh after an added item runs, and shows the new item when it is in", async () => {
    const refresh = deferred<EventItemDto[]>();
    fetchEventItems.mockResolvedValueOnce([badgeItem]).mockReturnValueOnce(refresh.promise);
    createEventItem.mockResolvedValueOnce(giftBag);

    renderPage();
    await addGiftBag();
    await waitFor(() => expect(fetchEventItems).toHaveBeenCalledTimes(2));

    // The rows stay (no placeholder, no error), and nothing in the card reacts to a click until the answer is in.
    expect(screen.getByRole("switch", { name: "Disable Badge" })).toBeTruthy();
    expect(placeholder()).toBeNull();
    expect(requirementsRegion().querySelector(".refetch-card--busy")?.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.queryByLabelText("Item name")).toBeNull();

    await act(async () => refresh.resolve([badgeItem, giftBag]));
    expect(await screen.findByRole("switch", { name: "Disable Gift bag" })).toBeTruthy();
    expect(requirementsRegion().querySelector(".refetch-card--busy")).toBeNull();
  });

  it("replaces the card with the error when the refresh after an added item fails, since it may be wrong", async () => {
    fetchEventItems.mockResolvedValueOnce([badgeItem]).mockRejectedValueOnce(new Error("offline"));
    createEventItem.mockResolvedValueOnce(giftBag);

    renderPage();
    await addGiftBag();

    expect(await screen.findByText("Could not load requirements")).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Disable Badge" })).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});

describe("RequirementsPage: what refreshes the page", () => {
  it("reads the page again after an item is saved in its drawer, and closes the drawer", async () => {
    fetchEventItems.mockResolvedValue([badgeItem]);
    updateEventItem.mockResolvedValueOnce({ ...badgeItem, label: "Badge " });

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edit item" }));
    fireEvent.change(await screen.findByLabelText("Display name"), { target: { value: "Badge " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchEventItems).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("RequirementsPage: the attendee fields", () => {
  it("draws no card for them, though it reads them for the hints of its items", async () => {
    fetchEventItems.mockResolvedValue([badgeItem]);
    fetchEventCustomFields.mockResolvedValue([hintField("shirt", "Shirt size"), hintField("badge_name", "Badge name", "companion")]);

    renderPage();
    await screen.findByRole("switch", { name: "Disable Badge" });

    expect(fetchEventCustomFields).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Custom attendee fields")).toBeNull();
    expect(screen.queryByText("Attendee fields")).toBeNull();
    for (const name of ["Add field", "Edit field", "Delete field", "Add suggested questions"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByText("Shirt size")).toBeNull();
    expect(within(requirementsRegion()).getAllByRole("table")).toHaveLength(1);
  });

  it("says where they are, below the items: a link to the Fields tab of this event's Registration page", async () => {
    fetchEventItems.mockResolvedValue([badgeItem]);

    renderPage();
    const link = await screen.findByRole("link", { name: FIELDS_LINK });

    expect(link.getAttribute("href")).toBe("/admin/events/evt-1/registration?tab=fields");
    const note = link.closest("p") as HTMLElement;
    expect(note.textContent).toBe("Attendee fields are on the Fields tab of the Registration page.");
    const order = [...requirementsRegion().querySelectorAll("section.requirements-section, p.requirements-section-hint")];
    expect(order.map((element) => element.tagName)).toEqual(["SECTION", "P"]);
    expect(order[1]).toBe(note);
  });

  it("is a link like any other for the keyboard: in the tab order, after the controls of the items, and it opens the Fields tab", async () => {
    fetchEventItems.mockResolvedValue([badgeItem]);

    const router = renderPageWithRegistration();
    const link = await screen.findByRole("link", { name: FIELDS_LINK });

    expect(link.tagName).toBe("A");
    expect(link.hasAttribute("tabindex")).toBe(false);
    const tabStops = [...requirementsRegion().querySelectorAll<HTMLElement>("a[href], button, input, [tabindex]")];
    expect(tabStops.at(-1)).toBe(link);
    link.focus();
    expect(document.activeElement).toBe(link);

    fireEvent.click(link);

    expect(router.state.location.pathname).toBe("/admin/events/evt-1/registration");
    expect(router.state.location.search).toBe("?tab=fields");
    expect(await screen.findByText("The Registration page")).toBeTruthy();
  });

  it("keeps the link usable while a refresh runs: it says where something is, not what the read answered", async () => {
    const refresh = deferred<EventItemDto[]>();
    fetchEventItems.mockResolvedValueOnce([badgeItem]).mockReturnValueOnce(refresh.promise);
    createEventItem.mockResolvedValueOnce(giftBag);

    const router = renderPageWithRegistration();
    await addGiftBag();
    await waitFor(() => expect(fetchEventItems).toHaveBeenCalledTimes(2));
    expect(requirementsRegion().querySelector(".refetch-card--busy")).not.toBeNull();

    expect(fieldsLink().closest(".refetch-card")).toBeNull();
    fireEvent.click(fieldsLink());

    expect(router.state.location.pathname).toBe("/admin/events/evt-1/registration");
    await act(async () => refresh.resolve([badgeItem, giftBag]));
  });

  it("is a failed page, not a page without hints, when only the read of the fields fails: Retry reads both again", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventItems.mockResolvedValue([badgeItem]);
    fetchEventCustomFields
      .mockRejectedValueOnce(new ApiError(500, "server error"))
      .mockResolvedValueOnce([hintField("shirt", "Shirt size")]);

    renderPage();

    await screen.findByText("Could not load requirements");
    expect(screen.getByText("Something went wrong. Try again.")).toBeTruthy();
    expect(reportApiError).toHaveBeenCalledWith(500);
    expect(screen.queryByRole("switch", { name: "Disable Badge" })).toBeNull();
    expect(screen.queryByRole("link", { name: FIELDS_LINK })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    fireEvent.click(await screen.findByRole("button", { name: "Edit item" }));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByRole("checkbox", { name: "Shirt size" })).toBeTruthy();
    expect(fetchEventItems).toHaveBeenCalledTimes(2);
    expect(fetchEventCustomFields).toHaveBeenCalledTimes(2);
  });
});

describe("RequirementsPage: the Create button", () => {
  it("shows the work on the button, which keeps its label and the keyboard focus, makes the name read-only and ignores a second press", async () => {
    const created = deferred<EventItemDto>();
    fetchEventItems.mockResolvedValue([badgeItem]);
    createEventItem.mockReturnValueOnce(created.promise);

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));
    const name = screen.getByLabelText("Item name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Gift bag" } });
    const create = screen.getByRole("button", { name: "Create" });
    create.focus();
    fireEvent.click(create);

    await waitFor(() => expect(create.getAttribute("aria-busy")).toBe("true"));
    expect(create.textContent).toContain("Create");
    expect(isOff(create)).toBe(true);
    expect(create.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(create);
    expect(name.readOnly).toBe(true);
    expect(screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(create);
    expect(createEventItem).toHaveBeenCalledTimes(1);

    await act(async () => created.resolve(giftBag));
    await waitFor(() => expect(screen.queryByLabelText("Item name")).toBeNull());
  });

  it("does not create twice when Enter is pressed in the name while the creation runs", async () => {
    const created = deferred<EventItemDto>();
    fetchEventItems.mockResolvedValue([badgeItem]);
    createEventItem.mockReturnValueOnce(created.promise);

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "Gift bag" } });
    const form = document.getElementById("add-item-form") as HTMLFormElement;
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole("button", { name: "Create" }).getAttribute("aria-busy")).toBe("true"));

    fireEvent.submit(form);

    expect(createEventItem).toHaveBeenCalledTimes(1);
    await act(async () => created.resolve(giftBag));
  });

  it("brings the button back, with the focus and what was typed, when the creation fails", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    fetchEventItems.mockResolvedValue([badgeItem]);
    createEventItem.mockRejectedValueOnce(new ApiError(409, "key_conflict", "key_conflict"));

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));
    const name = screen.getByLabelText("Item name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Gift bag" } });
    const create = screen.getByRole("button", { name: "Create" });
    create.focus();
    fireEvent.click(create);

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("An item with this name already exists.", "warning"));
    expect(create.getAttribute("aria-busy")).not.toBe("true");
    expect(isOff(create)).toBe(false);
    expect(document.activeElement).toBe(create);
    expect(name.readOnly).toBe(false);
    expect(name.value).toBe("Gift bag");
  });
});

describe("RequirementsPage — Active toggle double-submit guard", () => {
  it("does not double-submit when the Active switch is clicked twice before the request resolves", async () => {
    let resolveUpdate: ((value: EventItemDto) => void) | undefined;
    const pending = new Promise<EventItemDto>((resolve) => {
      resolveUpdate = resolve;
    });
    fetchEventItems.mockResolvedValue([badgeItem]);
    updateEventItem.mockReturnValueOnce(pending);

    renderPage();
    const toggle = await screen.findByRole("switch", { name: "Disable Badge" });

    fireEvent.click(toggle);
    fireEvent.click(toggle);

    resolveUpdate!({ ...badgeItem, enabled: false });

    await waitFor(() => {
      expect(updateEventItem).toHaveBeenCalledTimes(1);
    });
  });
});
