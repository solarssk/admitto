// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { EventCustomFieldDto, EventDto } from "../../src/api/types.js";
import { ARCHIVED_ACTION_TOOLTIP } from "../../src/components/ArchivedGuard.js";
import {
  EventCustomFieldsCard,
  type EventCustomFieldsPlacement,
} from "../../src/requirements/EventCustomFieldsCard.js";
import type { FieldsChange } from "../../src/requirements/useFieldFormControls.js";
import { deferred, getTooltipText, renderWithToast } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    addSuggestedEventCustomFields: vi.fn(),
    deleteEventCustomField: vi.fn(),
    createEventCustomField: vi.fn(),
    updateEventCustomField: vi.fn(),
    reorderEventCustomFields: vi.fn(),
    fetchEventCustomFieldOptionUsage: vi.fn(),
  };
});

import {
  addSuggestedEventCustomFields,
  createEventCustomField,
  deleteEventCustomField,
  reorderEventCustomFields,
  updateEventCustomField,
} from "../../src/api/client.js";

const addToast = vi.fn();
vi.mock("@admitto/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/ui")>();
  return { ...actual, useToast: () => ({ addToast }) };
});

const event: EventDto = { id: "evt-1", title: "Demo", archived_at: null } as EventDto;
const archivedEvent: EventDto = { ...event, archived_at: "2026-01-01T00:00:00.000Z" };

const dietaryField: EventCustomFieldDto = {
  id: "field-dietary",
  source_field: "dietary",
  label: "Dietary requirements",
  description: "Allergies and meal preferences",
  type: "text",
  required: false,
  show_on_form: true,
  display_order: 0,
  options: null,
  created_at: "2026-01-01T00:00:00.000Z",
};

const shirtField: EventCustomFieldDto = {
  ...dietaryField,
  id: "field-shirt",
  source_field: "shirt_size",
  label: "Shirt size",
  description: null,
  type: "select",
  required: true,
  show_on_form: false,
  display_order: 1,
  options: ["S", "M"],
};

const parkingField: EventCustomFieldDto = {
  ...dietaryField,
  id: "field-parking",
  source_field: "parking",
  label: "Needs parking",
  description: null,
  type: "boolean",
  show_on_form: false,
  display_order: 2,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderCard(fields: EventCustomFieldDto[], placement?: EventCustomFieldsPlacement, hostEvent: EventDto = event) {
  const onChanged = vi.fn();
  const onUpdated = vi.fn();
  renderWithToast(
    <EventCustomFieldsCard
      eventId="evt-1"
      event={hostEvent}
      fields={fields}
      placement={placement}
      onChanged={onChanged}
      onUpdated={onUpdated}
    />,
  );
  return { onChanged, onUpdated };
}

/** The list as a host keeps it: what `onUpdated` is told to change is applied, so a test can see the rows in their new order. */
function Host({ initial }: Readonly<{ initial: EventCustomFieldDto[] }>) {
  const [fields, setFields] = useState(initial);
  return (
    <EventCustomFieldsCard
      eventId="evt-1"
      event={event}
      fields={fields}
      placement="registration"
      onChanged={vi.fn()}
      onUpdated={(change: FieldsChange) => setFields(change)}
    />
  );
}

const rowNames = () => screen.getAllByRole("row").slice(1).map((row) => row.querySelector(".requirements-item-name")?.textContent);

// The card is the same one on both pages: what it does for a field is tested once, for each place it is shown.
describe.each([
  {
    placement: "requirements" as const,
    title: "Custom attendee fields",
    emptyTitle: "No custom fields yet",
    emptyText: /Add one to collect extra attendee data, like dietary requirements/,
  },
  {
    placement: "registration" as const,
    title: "Attendee fields",
    emptyTitle: "No attendee fields yet",
    emptyText: /Add a field to ask guests a question on the registration form, like dietary requirements/,
  },
])("EventCustomFieldsCard on $placement", ({ placement, title, emptyTitle, emptyText }) => {
  it("is titled for the page it is on", () => {
    renderCard([dietaryField], placement);
    expect(screen.getByText(title)).toBeTruthy();
  });

  it("shows EmptyState when there are no fields", () => {
    renderCard([], placement);
    expect(screen.getByText(emptyTitle)).toBeTruthy();
    expect(screen.getByText(emptyText)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("keeps the card's padding for the empty state and lets the table bleed edge to edge", () => {
    const { container, unmount } = renderWithToast(
      <EventCustomFieldsCard eventId="evt-1" event={event} fields={[]} placement={placement} onChanged={vi.fn()} />,
    );
    expect(container.querySelector(".at-card__body")).not.toBeNull();
    unmount();

    const withFields = renderWithToast(
      <EventCustomFieldsCard eventId="evt-1" event={event} fields={[dietaryField]} placement={placement} onChanged={vi.fn()} />,
    );
    expect(withFields.container.querySelector(".at-card__body")).toBeNull();
    expect(withFields.container.querySelector(".at-card > .attendees-table-wrap")).not.toBeNull();
  });

  it("lists fields with description and required status", () => {
    renderCard([dietaryField, shirtField], placement);

    expect(screen.getByRole("columnheader", { name: "Description" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Type" })).toBeNull();

    const dietaryRow = screen.getByText("Dietary requirements").closest("tr");
    const shirtRow = screen.getByText("Shirt size").closest("tr");
    expect(dietaryRow).not.toBeNull();
    expect(shirtRow).not.toBeNull();

    expect(within(dietaryRow!).queryByText("dietary")).toBeNull();
    expect(within(dietaryRow!).getByText("Allergies and meal preferences")).toBeTruthy();
    expect(within(dietaryRow!).getByLabelText("Text")).toBeTruthy();
    expect(within(dietaryRow!).getByText("No")).toBeTruthy();

    expect(within(shirtRow!).getByText("Yes")).toBeTruthy();
    expect(within(shirtRow!).getByLabelText("Single choice")).toBeTruthy();
    expect(within(shirtRow!).queryByText("Single choice")).toBeNull();
  });

  it.each([
    ["text", "Text", "ti-letter-case"],
    ["long_text", "Long text", "ti-align-left"],
    ["date", "Date", "ti-calendar"],
    ["datetime", "Date and time", "ti-calendar-time"],
    ["phone", "Phone", "ti-phone"],
    ["select", "Single choice", "ti-list"],
    ["boolean", "Yes / No", "ti-checkbox"],
  ] as const)("draws a %s field with the name and the icon of its type", (type, name, icon) => {
    renderCard([{ ...dietaryField, id: `field-${type}`, source_field: type, label: `A ${type} field`, type }], placement);

    const row = screen.getByText(`A ${type} field`).closest("tr")!;
    const marker = within(row).getByLabelText(name);
    expect(marker.getAttribute("role")).toBe("img");
    expect(marker.querySelector(`i.${icon}`)).not.toBeNull();
  });

  it("marks a question about the companion with a Companion badge under its name, and none on a question about the guest", () => {
    const badgeField: EventCustomFieldDto = { ...dietaryField, id: "field-badge", source_field: "badge", label: "Badge name", applies_to: "companion" };
    renderCard([dietaryField, badgeField], placement);

    const companionRow = screen.getByText("Badge name").closest("tr")!;
    const mark = within(companionRow).getByText("Companion");
    expect(mark.closest(".at-badge")).not.toBeNull();
    expect(mark.closest(".requirements-item-recipient")).not.toBeNull();
    expect(within(screen.getByText("Dietary requirements").closest("tr")!).queryByText("Companion")).toBeNull();
    // The name stays the question's own, without the word.
    expect(rowNames()).toEqual(["Dietary requirements", "Badge name"]);
  });

  it("marks a field that says nothing of its recipient as the guest's: no badge", () => {
    renderCard([dietaryField, { ...shirtField, applies_to: "guest" }], placement);
    expect(screen.queryByText("Companion")).toBeNull();
  });

  it("opens the edit modal of a question about the companion with Companion pressed", () => {
    const badgeField: EventCustomFieldDto = { ...dietaryField, id: "field-badge", source_field: "badge", label: "Badge name", applies_to: "companion" };
    renderCard([dietaryField, badgeField], placement);
    fireEvent.click(within(screen.getByText("Badge name").closest("tr")!).getByRole("button", { name: "Edit field" }));
    const recipients = screen.getByRole("group", { name: "Applies to" });
    expect(within(recipients).getByRole("button", { name: "Companion" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(recipients).getByRole("button", { name: "Guest" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("disambiguates two fields that share a display label with their slug", () => {
    const shirtA: EventCustomFieldDto = { ...dietaryField, id: "f-shirt-a", source_field: "shirt_size", label: "Shirt size" };
    const shirtB: EventCustomFieldDto = { ...dietaryField, id: "f-shirt-b", source_field: "shirt_size_2", label: "Shirt size" };
    renderCard([shirtA, shirtB], placement);

    expect(screen.getByText("Shirt size (shirt_size)")).toBeTruthy();
    expect(screen.getByText("Shirt size (shirt_size_2)")).toBeTruthy();
    expect(screen.queryByText("Shirt size")).toBeNull();
  });

  it("shows the add-field modal with a header subtitle", () => {
    renderCard([], placement);
    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    expect(screen.getByRole("heading", { name: "Add custom field" })).toBeTruthy();
    expect(
      screen.getByText(
        "Collect extra attendee details on import and show them to operators during check-in.",
      ),
    ).toBeTruthy();
  });

  it("opens the edit modal pre-filled for an existing field", () => {
    renderCard([dietaryField], placement);
    fireEvent.click(screen.getByRole("button", { name: "Edit field" }));
    expect(screen.getByRole("heading", { name: "Edit custom field" })).toBeTruthy();
    expect(screen.getByLabelText("Display label")).toHaveProperty("value", "Dietary requirements");
  });

  it("deletes a field after confirmation", async () => {
    vi.mocked(deleteEventCustomField).mockResolvedValueOnce(undefined);
    const { onChanged } = renderCard([dietaryField], placement);
    fireEvent.click(screen.getByRole("button", { name: "Delete field" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(deleteEventCustomField).toHaveBeenCalledWith("evt-1", "field-dietary");
      expect(onChanged).toHaveBeenCalled();
    });
  });

  it("shows a specific warning when delete is blocked by field_in_use", async () => {
    vi.mocked(deleteEventCustomField).mockRejectedValueOnce(
      new ApiError(409, "field_in_use", "field_in_use"),
    );
    renderCard([dietaryField], placement);
    fireEvent.click(screen.getByRole("button", { name: "Delete field" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        expect.stringMatching(/used as a hint on an item/),
        "warning",
      );
    });
  });

  it("shows a generic error toast when delete fails for another reason", async () => {
    vi.mocked(deleteEventCustomField).mockRejectedValueOnce(new ApiError(500, "server error", ""));
    renderCard([dietaryField], placement);
    fireEvent.click(screen.getByRole("button", { name: "Delete field" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(expect.any(String), "error");
    });
  });

  it("closes the delete confirmation without deleting on Cancel", () => {
    renderCard([dietaryField], placement);
    fireEvent.click(screen.getByRole("button", { name: "Delete field" }));
    expect(screen.getByRole("heading", { name: "Delete custom field" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: "Delete custom field" })).toBeNull();
    expect(deleteEventCustomField).not.toHaveBeenCalled();
  });

  it("closes the add modal and refreshes after a field is created", async () => {
    vi.mocked(createEventCustomField).mockResolvedValueOnce(dietaryField);
    const { onChanged } = renderCard([], placement);
    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    fireEvent.change(screen.getByLabelText("Display label"), {
      target: { value: "Dietary requirements" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create field" }));
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalled();
      expect(screen.queryByRole("heading", { name: "Add custom field" })).toBeNull();
    });
  });

  it("locks every control of an archived event, with the reason", () => {
    renderCard([dietaryField, shirtField], placement, archivedEvent);
    const controls = [
      screen.getByRole("button", { name: "Add field" }),
      ...screen.getAllByRole("button", { name: "Edit field" }),
      ...screen.getAllByRole("button", { name: "Delete field" }),
    ];
    if (placement === "registration") {
      controls.push(
        screen.getByRole("button", { name: "Add suggested questions" }),
        screen.getByRole("switch", { name: "Dietary requirements on the form" }),
        screen.getByRole("button", { name: "Move Dietary requirements down" }),
        screen.getByRole("button", { name: "Move Shirt size up" }),
      );
    }
    for (const control of controls) {
      expect((control as HTMLButtonElement | HTMLInputElement).disabled).toBe(true);
      expect(getTooltipText(control)).toBe(ARCHIVED_ACTION_TOOLTIP);
    }
  });
});

describe("EventCustomFieldsCard: the Requirements page (the default)", () => {
  it("has no Add suggested questions button: the suggested questions are a matter of the registration form", () => {
    renderCard([dietaryField]);

    expect(screen.getByRole("button", { name: "Add field" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add suggested questions" })).toBeNull();
  });

  it("is the card as it was: no On the form column, switch or arrows", () => {
    renderCard([dietaryField, shirtField]);

    expect(screen.getByText("Custom attendee fields")).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "On the form" })).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Move / })).toBeNull();
    expect(document.querySelector(".requirements-section--registration")).toBeNull();
  });

  it("creates a field that is not on the registration form, as the API does by default", async () => {
    vi.mocked(createEventCustomField).mockResolvedValueOnce(dietaryField);
    renderCard([]);
    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    fireEvent.change(screen.getByLabelText("Display label"), { target: { value: "Dietary requirements" } });
    fireEvent.click(screen.getByRole("button", { name: "Create field" }));
    await waitFor(() => expect(createEventCustomField).toHaveBeenCalled());
    expect(vi.mocked(createEventCustomField).mock.calls[0]![1]).not.toHaveProperty("show_on_form");
  });
});

describe("EventCustomFieldsCard: the Registration page", () => {
  it("has an On the form switch for each field, on for the fields that are on the form", () => {
    renderCard([dietaryField, shirtField], "registration");

    expect(screen.getByRole("columnheader", { name: "On the form" })).toBeTruthy();
    expect((screen.getByRole("switch", { name: "Dietary requirements on the form" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("switch", { name: "Shirt size on the form" }) as HTMLInputElement).checked).toBe(false);
    expect(document.querySelector(".requirements-section--registration")).not.toBeNull();
  });

  it("names the switch and the arrows of two fields with the same label by their slugs", () => {
    const first: EventCustomFieldDto = { ...dietaryField, id: "f-a", source_field: "shirt_size", label: "Shirt size" };
    const second: EventCustomFieldDto = { ...dietaryField, id: "f-b", source_field: "shirt_size_2", label: "Shirt size" };
    renderCard([first, second], "registration");

    expect(screen.getByRole("switch", { name: "Shirt size (shirt_size) on the form" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Shirt size (shirt_size_2) on the form" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move Shirt size (shirt_size_2) up" })).toBeTruthy();
  });

  it("creates a new field already on the form", async () => {
    vi.mocked(createEventCustomField).mockResolvedValueOnce(dietaryField);
    renderCard([], "registration");
    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    fireEvent.change(screen.getByLabelText("Display label"), { target: { value: "Dietary requirements" } });
    fireEvent.click(screen.getByRole("button", { name: "Create field" }));
    await waitFor(() => {
      expect(createEventCustomField).toHaveBeenCalledWith("evt-1", {
        source_field: "dietary_requirements",
        label: "Dietary requirements",
        description: undefined,
        type: "text",
        required: false,
        options: undefined,
        show_on_form: true,
      });
    });
  });

  it("does not move a field on or off the form when its other details are edited", async () => {
    vi.mocked(updateEventCustomField).mockResolvedValueOnce({ ...dietaryField, required: true });
    renderCard([dietaryField], "registration");
    fireEvent.click(screen.getByRole("button", { name: "Edit field" }));
    fireEvent.click(screen.getByRole("button", { name: "Required" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateEventCustomField).toHaveBeenCalled());
    expect(vi.mocked(updateEventCustomField).mock.calls[0]![2]).not.toHaveProperty("show_on_form");
  });

  describe("the Add suggested questions button", () => {
    const ADDED = { added: ["parking", "parking_plate", "travel", "arrival", "accommodation"], skipped: [] };
    const suggestButton = () => screen.getByRole("button", { name: "Add suggested questions" });
    const suggestDialog = () => screen.queryByRole("dialog", { name: "Add suggested questions" });

    it("stands beside Add field, before it, as a secondary button", () => {
      renderCard([dietaryField], "registration");

      const buttons = within(document.querySelector(".at-card__actions") as HTMLElement).getAllByRole("button");
      expect(buttons.map((button) => button.textContent)).toEqual(["Add suggested questions", "Add field"]);
      expect(suggestButton().className).toContain("at-btn--secondary");
      expect(suggestDialog()).toBeNull();
    });

    it("opens the window for the fields the event has now, and Cancel closes it without asking the server, with the focus back on the button", () => {
      renderCard([{ ...parkingField, show_on_form: true }], "registration");

      fireEvent.click(suggestButton());

      const dialog = suggestDialog() as HTMLElement;
      expect(within(dialog).getAllByText("Already in your list")).toHaveLength(1);
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(suggestDialog()).toBeNull();
      expect(addSuggestedEventCustomFields).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(suggestButton());
    });

    it("gives the focus back to the button when the window is closed with Escape", () => {
      renderCard([], "registration");
      fireEvent.click(suggestButton());

      fireEvent.keyDown(document, { key: "Escape" });

      expect(suggestDialog()).toBeNull();
      expect(document.activeElement).toBe(suggestButton());
    });

    it("adds the questions, says how many, reads the list again, closes the window and gives the focus back", async () => {
      vi.mocked(addSuggestedEventCustomFields).mockResolvedValueOnce(ADDED);
      const { onChanged } = renderCard([], "registration");
      fireEvent.click(suggestButton());

      fireEvent.click(within(suggestDialog() as HTMLElement).getByRole("button", { name: "Add 5 questions" }));

      await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
      expect(addSuggestedEventCustomFields).toHaveBeenCalledWith("evt-1");
      expect(addToast).toHaveBeenCalledWith("Added 5 suggested questions.", "success");
      expect(suggestDialog()).toBeNull();
      expect(document.activeElement).toBe(suggestButton());
    });

    it("says so, and still reads the list again, when another admin had added the questions first and none was added", async () => {
      vi.mocked(addSuggestedEventCustomFields).mockResolvedValueOnce({
        added: [],
        skipped: ADDED.added.map((source_field) => ({ source_field, reason: "exists" as const })),
      });
      const { onChanged } = renderCard([], "registration");
      fireEvent.click(suggestButton());

      fireEvent.click(within(suggestDialog() as HTMLElement).getByRole("button", { name: "Add 5 questions" }));

      await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
      expect(addToast).toHaveBeenCalledWith("The suggested questions are already in your list.", "info");
    });

    it("keeps the window open with the refusal, and neither reads the list again nor says it added anything", async () => {
      vi.mocked(addSuggestedEventCustomFields).mockRejectedValueOnce(new ApiError(422, "field_limit_reached", "field_limit_reached"));
      const { onChanged } = renderCard([], "registration");
      fireEvent.click(suggestButton());

      fireEvent.click(within(suggestDialog() as HTMLElement).getByRole("button", { name: "Add 5 questions" }));

      expect((await screen.findByRole("alert")).textContent).toBe("This event has reached its custom field limit.");
      expect(suggestDialog()).not.toBeNull();
      expect(onChanged).not.toHaveBeenCalled();
      expect(addToast).not.toHaveBeenCalled();
    });

    it("tells an event over the limit by how much, and asks nothing of the server", () => {
      const own: EventCustomFieldDto[] = Array.from({ length: 18 }, (_, index) => ({ ...dietaryField, id: `f-${index}`, source_field: `own_${index}`, label: `Own ${index}` }));
      renderCard(own, "registration");

      fireEvent.click(suggestButton());

      expect((suggestDialog() as HTMLElement).textContent).toContain("This event has 18 of 20 fields, and adding 5 questions would take it to 23. Delete 3 fields first");
      expect(addSuggestedEventCustomFields).not.toHaveBeenCalled();
    });

    it("is locked for an archived event, with the reason, and opens nothing", () => {
      renderCard([], "registration", archivedEvent);

      fireEvent.click(suggestButton());

      expect((suggestButton() as HTMLButtonElement).disabled).toBe(true);
      expect(getTooltipText(suggestButton())).toBe(ARCHIVED_ACTION_TOOLTIP);
      expect(suggestDialog()).toBeNull();
    });
  });

  describe("the On the form switch", () => {
    it("saves the other state, shows the answer on the list the host has now and says so", async () => {
      const saved = { ...shirtField, show_on_form: true };
      vi.mocked(updateEventCustomField).mockResolvedValueOnce(saved);
      const { onUpdated, onChanged } = renderCard([dietaryField, shirtField], "registration");

      fireEvent.click(screen.getByRole("switch", { name: "Shirt size on the form" }));

      await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
      expect(updateEventCustomField).toHaveBeenCalledWith("evt-1", "field-shirt", { show_on_form: true });
      // The change is applied to whatever the host holds when it runs, so a list that changed meanwhile is not put back.
      const change = onUpdated.mock.calls[0]![0] as FieldsChange;
      expect(change([dietaryField, { ...shirtField, label: "Older" }])).toEqual([dietaryField, saved]);
      expect(addToast).toHaveBeenCalledWith("Added to the form", "success");
      expect(onChanged).not.toHaveBeenCalled();
    });

    it("takes a field off the form with the same request the other way", async () => {
      vi.mocked(updateEventCustomField).mockResolvedValueOnce({ ...dietaryField, show_on_form: false });
      renderCard([dietaryField], "registration");

      fireEvent.click(screen.getByRole("switch", { name: "Dietary requirements on the form" }));

      await waitFor(() => expect(addToast).toHaveBeenCalledWith("Removed from the form", "success"));
      expect(updateEventCustomField).toHaveBeenCalledWith("evt-1", "field-dietary", { show_on_form: false });
    });

    it("reads the list again instead, when the host has no way to show the answer", async () => {
      vi.mocked(updateEventCustomField).mockResolvedValueOnce({ ...shirtField, show_on_form: true });
      const onChanged = vi.fn();
      renderWithToast(<EventCustomFieldsCard eventId="evt-1" event={event} fields={[shirtField]} placement="registration" onChanged={onChanged} />);

      fireEvent.click(screen.getByRole("switch", { name: "Shirt size on the form" }));

      await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    });

    it("is busy while its request is on its way, keeps the focus and ignores a second change", async () => {
      const request = deferred<EventCustomFieldDto>();
      vi.mocked(updateEventCustomField).mockReturnValueOnce(request.promise);
      const { onUpdated } = renderCard([shirtField], "registration");
      const toggle = screen.getByRole("switch", { name: "Shirt size on the form" }) as HTMLInputElement;

      toggle.focus();
      fireEvent.click(toggle);

      // Never `disabled`: a control that turns disabled under the keyboard drops its focus.
      expect(toggle.getAttribute("aria-busy")).toBe("true");
      expect(toggle.getAttribute("aria-disabled")).toBe("true");
      expect(toggle.disabled).toBe(false);
      expect(document.activeElement).toBe(toggle);
      fireEvent.click(toggle);
      expect(updateEventCustomField).toHaveBeenCalledTimes(1);

      await act(async () => request.resolve({ ...shirtField, show_on_form: true }));

      expect(onUpdated).toHaveBeenCalledTimes(1);
      expect(toggle.hasAttribute("aria-busy")).toBe(false);
      expect(toggle.hasAttribute("aria-disabled")).toBe(false);
    });

    it("says why a required field cannot leave the form, and changes nothing", async () => {
      vi.mocked(updateEventCustomField).mockRejectedValueOnce(new ApiError(422, "required_field_not_on_form", "required_field_not_on_form"));
      const { onUpdated } = renderCard([{ ...dietaryField, required: true }], "registration");

      fireEvent.click(screen.getByRole("switch", { name: "Dietary requirements on the form" }));

      await waitFor(() =>
        expect(addToast).toHaveBeenCalledWith(expect.stringMatching(/A required field must also be on the registration form/), "error"),
      );
      expect(onUpdated).not.toHaveBeenCalled();
      expect((screen.getByRole("switch", { name: "Dietary requirements on the form" }) as HTMLInputElement).checked).toBe(true);
    });

    it("says that it failed, never the server's own words", async () => {
      vi.mocked(updateEventCustomField).mockRejectedValueOnce(new ApiError(500, "SELECT secret FROM x", ""));
      renderCard([shirtField], "registration");

      fireEvent.click(screen.getByRole("switch", { name: "Shirt size on the form" }));

      await waitFor(() => expect(addToast).toHaveBeenCalledWith("Failed to update the field.", "error"));
    });
  });

  describe("the arrows", () => {
    it("are named after the field, and off where a field cannot go further", () => {
      renderCard([dietaryField, shirtField, parkingField], "registration");

      const off = (name: string) => (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;
      expect(off("Move Dietary requirements up")).toBe(true);
      expect(off("Move Dietary requirements down")).toBe(false);
      expect(off("Move Shirt size up")).toBe(false);
      expect(off("Move Shirt size down")).toBe(false);
      expect(off("Move Needs parking up")).toBe(false);
      expect(off("Move Needs parking down")).toBe(true);
    });

    it("send the ids of all the fields with the moved one a place further, and show the order the server answers", async () => {
      const answer = [shirtField, dietaryField, parkingField];
      vi.mocked(reorderEventCustomFields).mockResolvedValueOnce(answer);
      const { onUpdated, onChanged } = renderCard([dietaryField, shirtField, parkingField], "registration");

      fireEvent.click(screen.getByRole("button", { name: "Move Dietary requirements down" }));

      await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
      expect(reorderEventCustomFields).toHaveBeenCalledWith("evt-1", ["field-shirt", "field-dietary", "field-parking"]);
      expect((onUpdated.mock.calls[0]![0] as FieldsChange)([dietaryField, shirtField, parkingField])).toEqual(answer);
      // A move that lands says nothing: the rows moving is the answer.
      expect(addToast).not.toHaveBeenCalled();
      expect(onChanged).not.toHaveBeenCalled();
    });

    it("move a field up the same way", async () => {
      vi.mocked(reorderEventCustomFields).mockResolvedValueOnce([]);
      renderCard([dietaryField, shirtField, parkingField], "registration");

      fireEvent.click(screen.getByRole("button", { name: "Move Needs parking up" }));

      await waitFor(() => expect(reorderEventCustomFields).toHaveBeenCalled());
      expect(reorderEventCustomFields).toHaveBeenCalledWith("evt-1", ["field-dietary", "field-parking", "field-shirt"]);
    });

    it("do nothing at the end of the list", () => {
      renderCard([dietaryField, shirtField], "registration");

      fireEvent.click(screen.getByRole("button", { name: "Move Dietary requirements up" }));
      fireEvent.click(screen.getByRole("button", { name: "Move Shirt size down" }));

      expect(reorderEventCustomFields).not.toHaveBeenCalled();
    });

    it("keep the pressed arrow busy, with its focus, and let one move at a time through", async () => {
      const request = deferred<EventCustomFieldDto[]>();
      vi.mocked(reorderEventCustomFields).mockReturnValueOnce(request.promise);
      renderCard([dietaryField, shirtField, parkingField], "registration");
      const pressed = screen.getByRole("button", { name: "Move Dietary requirements down" });

      pressed.focus();
      fireEvent.click(pressed);

      expect(pressed.getAttribute("aria-busy")).toBe("true");
      expect(pressed.getAttribute("aria-disabled")).toBe("true");
      expect((pressed as HTMLButtonElement).disabled).toBe(false);
      expect(document.activeElement).toBe(pressed);
      // A second move made from the list as it is now would put the first one back.
      fireEvent.click(screen.getByRole("button", { name: "Move Needs parking up" }));
      fireEvent.click(pressed);
      expect(reorderEventCustomFields).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "Move Needs parking up" }).hasAttribute("aria-busy")).toBe(false);

      await act(async () => request.resolve([shirtField, dietaryField, parkingField]));

      expect(pressed.hasAttribute("aria-busy")).toBe(false);
    });

    it("leave the switches busy while a move is on its way, and ignore a switch made then", async () => {
      const request = deferred<EventCustomFieldDto[]>();
      vi.mocked(reorderEventCustomFields).mockReturnValueOnce(request.promise);
      renderCard([dietaryField, shirtField, parkingField], "registration");
      fireEvent.click(screen.getByRole("button", { name: "Move Dietary requirements down" }));
      const toggle = screen.getByRole("switch", { name: "Shirt size on the form" });
      expect(toggle.getAttribute("aria-busy")).toBe("true");

      // The answer of the move is the whole list: a switch flipped now could be put back by it.
      fireEvent.click(toggle);
      expect(updateEventCustomField).not.toHaveBeenCalled();

      await act(async () => request.resolve([shirtField, dietaryField, parkingField]));
      expect(toggle.hasAttribute("aria-busy")).toBe(false);
    });

    it("ignore a move made while a switch request is on its way, and move again once it has landed", async () => {
      const request = deferred<EventCustomFieldDto>();
      vi.mocked(updateEventCustomField).mockReturnValueOnce(request.promise);
      vi.mocked(reorderEventCustomFields).mockResolvedValueOnce([shirtField, dietaryField, parkingField]);
      renderCard([dietaryField, shirtField, parkingField], "registration");
      fireEvent.click(screen.getByRole("switch", { name: "Shirt size on the form" }));

      fireEvent.click(screen.getByRole("button", { name: "Move Dietary requirements down" }));
      expect(reorderEventCustomFields).not.toHaveBeenCalled();

      await act(async () => request.resolve({ ...shirtField, show_on_form: true }));
      fireEvent.click(screen.getByRole("button", { name: "Move Dietary requirements down" }));
      await waitFor(() => expect(reorderEventCustomFields).toHaveBeenCalledTimes(1));
    });

    it("give the focus back to the arrow that was pressed once its row has moved", async () => {
      vi.mocked(reorderEventCustomFields).mockImplementation(async (_eventId, ids) =>
        ids.map((id) => [dietaryField, shirtField, parkingField].find((field) => field.id === id)!),
      );
      renderWithToast(<Host initial={[dietaryField, shirtField, parkingField]} />);
      const press = async (name: string) => {
        const button = screen.getByRole("button", { name });
        button.focus();
        fireEvent.click(button);
        await waitFor(() => expect(button.hasAttribute("aria-busy")).toBe(false));
      };

      await press("Move Dietary requirements down");
      expect(rowNames()).toEqual(["Shirt size", "Dietary requirements", "Needs parking"]);
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move Dietary requirements down" })));

      await press("Move Dietary requirements down");
      expect(rowNames()).toEqual(["Shirt size", "Needs parking", "Dietary requirements"]);
      // Now last: its Down is off, so the focus goes to the Up of the same row instead of to the page.
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move Dietary requirements up" })));

      await press("Move Dietary requirements up");
      expect(rowNames()).toEqual(["Shirt size", "Dietary requirements", "Needs parking"]);
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move Dietary requirements up" })));
    });

    it("refresh the list when it is out of date, and say so", async () => {
      vi.mocked(reorderEventCustomFields).mockRejectedValueOnce(new ApiError(409, "stale_write", "stale_write"));
      const { onChanged, onUpdated } = renderCard([dietaryField, shirtField], "registration");

      fireEvent.click(screen.getByRole("button", { name: "Move Dietary requirements down" }));

      await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
      expect(addToast).toHaveBeenCalledWith(expect.stringMatching(/so it was refreshed. Move the field again\./), "warning");
      expect(onUpdated).not.toHaveBeenCalled();
    });

    it("say that a move failed for any other reason, never the server's own words, and leave the list alone", async () => {
      vi.mocked(reorderEventCustomFields).mockRejectedValueOnce(new ApiError(500, "SELECT secret FROM x", ""));
      const { onChanged, onUpdated } = renderCard([dietaryField, shirtField], "registration");

      fireEvent.click(screen.getByRole("button", { name: "Move Dietary requirements down" }));

      await waitFor(() => expect(addToast).toHaveBeenCalledWith("Failed to move the field.", "error"));
      expect(onChanged).not.toHaveBeenCalled();
      expect(onUpdated).not.toHaveBeenCalled();
      // The arrow is free again.
      expect(screen.getByRole("button", { name: "Move Dietary requirements down" }).hasAttribute("aria-busy")).toBe(false);
    });
  });
});

describe("EventCustomFieldsCard: the icon and the condition of a question", { timeout: 30_000 }, () => {
  const parking = { ...parkingField, show_on_form: true, rules: { icon: "parking" } } as EventCustomFieldDto;
  const plate: EventCustomFieldDto = {
    ...dietaryField,
    id: "field-plate",
    source_field: "plate",
    label: "Plate number",
    description: null,
    rules: { icon: "car", show_when: { field: "parking", value: true } },
  };
  const meal: EventCustomFieldDto = { ...shirtField, id: "field-meal", source_field: "meal", label: "Meal", options: ["Standard", "Vegan"], show_on_form: true };
  const veganNote: EventCustomFieldDto = {
    ...dietaryField,
    id: "field-vegan",
    source_field: "vegan_note",
    label: "Vegan note",
    description: null,
    rules: { show_when: { field: "meal", value: "Vegan" } },
  };
  const food: EventCustomFieldDto = { ...dietaryField, rules: { icon: "food" } };
  const rowOf = (name: string) => screen.getByText(name, { selector: ".requirements-item-name" }).closest("tr") as HTMLTableRowElement;

  for (const placement of ["requirements", "registration"] as const) {
    describe(`on the ${placement} card`, () => {
      it("draws the icon of the question before its name, with a name of its own, and the glyph Tabler has for it", () => {
        renderCard([food, parking], placement);
        const icon = within(rowOf("Dietary requirements")).getByRole("img", { name: "Icon on the form: Food" });
        expect(icon.querySelector("i")?.className).toBe("ti ti-tools-kitchen-2");
        const name = rowOf("Dietary requirements").querySelector(".requirements-item-name") as HTMLElement;
        expect(name.contains(icon)).toBe(true);
        expect(name.firstElementChild).toBe(icon);
        expect(within(rowOf("Needs parking")).getByRole("img", { name: "Icon on the form: Parking" })).toBeTruthy();
      });

      it("draws no icon for a question that has none, or whose icon this version does not know", () => {
        const unknown = { ...shirtField, rules: { icon: "rocket" } } as unknown as EventCustomFieldDto;
        renderCard([dietaryField, unknown], placement);
        expect(within(rowOf("Dietary requirements")).queryByRole("img", { name: /Icon on the form/ })).toBeNull();
        expect(within(rowOf("Shirt size")).queryByRole("img", { name: /Icon on the form/ })).toBeNull();
        // The type of the answer keeps its own icon, named by the type.
        expect(within(rowOf("Dietary requirements")).getByRole("img", { name: "Text" })).toBeTruthy();
      });

      it("says under the name of a question that has a condition which question it is shown for, and the answer", () => {
        renderCard([parking, plate, meal, veganNote], placement);
        expect(within(rowOf("Plate number")).getByText("Shown only when “Needs parking” is Yes")).toBeTruthy();
        expect(within(rowOf("Vegan note")).getByText("Shown only when “Meal” is “Vegan”")).toBeTruthy();
        const line = within(rowOf("Plate number")).getByText("Shown only when “Needs parking” is Yes");
        expect(line.classList.contains("requirements-item-condition")).toBe(true);
        expect(line.previousElementSibling?.classList.contains("requirements-item-name")).toBe(true);
      });

      it("says nothing under a question that is always asked, and the question it depends on is not marked", () => {
        renderCard([parking, plate, meal, veganNote], placement);
        expect(rowOf("Needs parking").querySelector(".requirements-item-condition")).toBeNull();
        expect(rowOf("Meal").querySelector(".requirements-item-condition")).toBeNull();
      });

      it("tells two questions with the same label apart in that line, by the key", () => {
        const twin = { ...parking, id: "field-parking-2", source_field: "parking_2" };
        renderCard([parking, twin, plate], placement);
        expect(within(rowOf("Plate number")).getByText("Shown only when “Needs parking (parking)” is Yes")).toBeTruthy();
      });

      it("opens the editor of a question with its condition in place, and offers the questions of the event", async () => {
        renderCard([parking, plate, meal, veganNote], placement);
        fireEvent.click(within(rowOf("Plate number")).getByRole("button", { name: "Edit field" }));
        expect(await screen.findByRole("button", { name: "Question, Needs parking" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "Answer, Yes" })).toBeTruthy();
      });

      it("holds back deleting a question that others are shown for: the dialog says which, in text, and Delete is off", () => {
        renderCard([parking, plate, meal, veganNote], placement);
        fireEvent.click(within(rowOf("Needs parking")).getByRole("button", { name: "Delete field" }));
        const dialog = screen.getByRole("dialog", { name: "Delete custom field" });
        expect(within(dialog).getByText("“Needs parking” can't be deleted yet: “Plate number” (for Yes) is shown only for an answer to it. Remove its condition first.")).toBeTruthy();
        expect(within(dialog).queryByText(/This cannot be undone/)).toBeNull();
        expect(within(dialog).getByRole("button", { name: "Delete" }).hasAttribute("disabled")).toBe(true);
        fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
        expect(deleteEventCustomField).not.toHaveBeenCalled();
        expect(within(dialog).queryByRole("button", { name: "Cancel" })).toBeNull();
        fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
        expect(screen.queryByRole("dialog", { name: "Delete custom field" })).toBeNull();
      });

      it("deletes a question that nothing depends on as before, and one that depends on others, with the usual dialog", async () => {
        vi.mocked(deleteEventCustomField).mockResolvedValueOnce(undefined as never);
        const { onChanged } = renderCard([parking, plate], placement);
        fireEvent.click(within(rowOf("Plate number")).getByRole("button", { name: "Delete field" }));
        const dialog = screen.getByRole("dialog", { name: "Delete custom field" });
        expect(within(dialog).getByText(/Delete "Plate number"\? This cannot be undone\./)).toBeTruthy();
        expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();
        fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
        await waitFor(() => expect(deleteEventCustomField).toHaveBeenCalledWith("evt-1", "field-plate"));
        await waitFor(() => expect(onChanged).toHaveBeenCalled());
      });

      it("names every field that is shown for a question that is to be deleted", () => {
        const second = { ...plate, id: "field-second", source_field: "second", label: "Second" };
        renderCard([parking, plate, second], placement);
        fireEvent.click(within(rowOf("Needs parking")).getByRole("button", { name: "Delete field" }));
        expect(
          screen.getByText("“Needs parking” can't be deleted yet: “Plate number” (for Yes) and “Second” (for Yes) are shown only for an answer to it. Remove their conditions first."),
        ).toBeTruthy();
      });
    });
  }
});
