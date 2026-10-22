// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { EventCustomFieldDto } from "../../src/api/types.js";
import { CUSTOM_FIELD_TYPES } from "../../src/requirements/customFieldType.js";
import { EventCustomFieldModal } from "../../src/requirements/EventCustomFieldModal.js";
import { advanceTimers, deferred, hangUntilAborted, isOff, renderWithToast } from "../test-utils.js";
import { LOAD_TIMEOUT_MESSAGE, LOAD_TIMEOUT_MS, SLOW_NOTICE_MS, SLOW_NOTICE_TEXT } from "../../src/utils/loading-timing.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    createEventCustomField: vi.fn(),
    updateEventCustomField: vi.fn(),
    fetchEventCustomFieldOptionUsage: vi.fn(),
  };
});

import {
  createEventCustomField,
  fetchEventCustomFieldOptionUsage,
  updateEventCustomField,
} from "../../src/api/client.js";

// Most tests don't care about usage counts - only the ones exercising rename-warning/delete-
// confirm/save-gate need real numbers, via mockResolvedValueOnce on top of this default.
vi.mocked(fetchEventCustomFieldOptionUsage).mockResolvedValue({});

const addToast = vi.fn();
vi.mock("@admitto/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/ui")>();
  return { ...actual, useToast: () => ({ addToast }) };
});

const dietaryField: EventCustomFieldDto = {
  id: "field-dietary",
  source_field: "dietary",
  label: "Dietary requirements",
  description: null,
  type: "text",
  required: false,
  options: null,
  created_at: "2026-01-01T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.mocked(fetchEventCustomFieldOptionUsage).mockResolvedValue({});
});

function renderModal(field: EventCustomFieldDto | null) {
  renderWithToast(
    <EventCustomFieldModal eventId="evt-1" field={field} onClose={vi.fn()} onSaved={vi.fn()} />,
  );
}

/** Clicks "+ Add option" and types into the row it creates - option inputs share one
 * aria-label ("Option text"), so the newest one is always the last in document order. */
function addOptionRow(text: string) {
  fireEvent.click(screen.getByRole("button", { name: "+ Add option" }));
  const inputs = screen.getAllByLabelText("Option text");
  fireEvent.change(inputs[inputs.length - 1]!, { target: { value: text } });
}

const usagePlaceholder = () => document.querySelector(".options-editor__usage-skeleton");

/** A select field is opened for edit fetches usage counts on mount - wait for that to resolve
 * (the counts are bars and Save stays disabled until it does) before interacting further. */
async function waitForUsageLoaded() {
  await waitFor(() => expect(usagePlaceholder()).toBeNull());
}

describe("EventCustomFieldModal — create", () => {
  it("shows a live ID preview derived from the label", () => {
    renderModal(null);
    expect(
      screen.getByText(
        "Collect extra attendee details on import and show them to operators during check-in.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("needs_parking")).toBeNull();
    fireEvent.change(screen.getByLabelText("Display label"), {
      target: { value: "Needs Parking" },
    });
    expect(screen.getByText("needs_parking")).toBeTruthy();
  });

  it("keeps Create field disabled when the display label is empty", () => {
    renderModal(null);
    expect(screen.getByRole("button", { name: "Create field" }).hasAttribute("disabled")).toBe(true);
    expect(createEventCustomField).not.toHaveBeenCalled();
  });

  it("keeps Create field disabled for a select field with no options", () => {
    renderModal(null);
    fireEvent.change(screen.getByLabelText("Display label"), { target: { value: "Size" } });
    fireEvent.click(screen.getByRole("button", { name: "Single choice" }));
    expect(screen.getByRole("button", { name: "Create field" }).hasAttribute("disabled")).toBe(true);
    expect(createEventCustomField).not.toHaveBeenCalled();
  });

  it("creates a text field with the assembled payload", async () => {
    vi.mocked(createEventCustomField).mockResolvedValueOnce(dietaryField);
    renderModal(null);
    fireEvent.change(screen.getByLabelText("Display label"), {
      target: { value: "Dietary requirements" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create field" }));
    await waitFor(() => {
      expect(createEventCustomField).toHaveBeenCalledWith("evt-1", {
        source_field: "dietary_requirements",
        label: "Dietary requirements",
        description: undefined,
        type: "text",
        required: false,
        options: undefined,
      });
    });
  });

  it("creates the field on the registration form when it is opened from the Registration page", async () => {
    vi.mocked(createEventCustomField).mockResolvedValueOnce(dietaryField);
    renderWithToast(<EventCustomFieldModal eventId="evt-1" field={null} showOnForm onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Display label"), {
      target: { value: "Dietary requirements" },
    });
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

  it("sends no show_on_form otherwise, so the API's own default (off the form) applies", async () => {
    vi.mocked(createEventCustomField).mockResolvedValueOnce(dietaryField);
    renderModal(null);
    fireEvent.change(screen.getByLabelText("Display label"), { target: { value: "Dietary requirements" } });
    fireEvent.click(screen.getByRole("button", { name: "Create field" }));
    await waitFor(() => expect(createEventCustomField).toHaveBeenCalled());
    expect(vi.mocked(createEventCustomField).mock.calls[0]![1]).not.toHaveProperty("show_on_form");
  });

  it("creates a select field with the options an operator adds and required", async () => {
    vi.mocked(createEventCustomField).mockResolvedValueOnce({
      ...dietaryField,
      type: "select",
      required: true,
      options: ["S", "M", "L"],
    });
    renderModal(null);
    fireEvent.change(screen.getByLabelText("Display label"), { target: { value: "Shirt size" } });
    fireEvent.click(screen.getByRole("button", { name: "Single choice" }));
    addOptionRow("S");
    addOptionRow("M");
    addOptionRow("L");
    fireEvent.click(screen.getByRole("button", { name: "Required" }));
    fireEvent.click(screen.getByRole("button", { name: "Create field" }));
    await waitFor(() => {
      expect(createEventCustomField).toHaveBeenCalledWith("evt-1", {
        source_field: "shirt_size",
        label: "Shirt size",
        description: undefined,
        type: "select",
        required: true,
        options: ["S", "M", "L"],
      });
    });
  });

  it("sends the description an operator types, so the import reference table can show it instead of repeating the label", async () => {
    vi.mocked(createEventCustomField).mockResolvedValueOnce({
      ...dietaryField,
      description: "Attendee's t-shirt size for the swag bag",
    });
    renderModal(null);
    fireEvent.change(screen.getByLabelText("Display label"), {
      target: { value: "Dietary requirements" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Attendee's t-shirt size for the swag bag" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create field" }));
    await waitFor(() => {
      expect(createEventCustomField).toHaveBeenCalledWith("evt-1", {
        source_field: "dietary_requirements",
        label: "Dietary requirements",
        description: "Attendee's t-shirt size for the swag bag",
        type: "text",
        required: false,
        options: undefined,
      });
    });
  });

  it("shows a toast on conflict", async () => {
    vi.mocked(createEventCustomField).mockRejectedValueOnce(
      new ApiError(409, "source_field_conflict", "source_field_conflict"),
    );
    renderModal(null);
    fireEvent.change(screen.getByLabelText("Display label"), { target: { value: "Dietary" } });
    fireEvent.click(screen.getByRole("button", { name: "Create field" }));
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(expect.any(String), "error");
    });
  });
});

describe("EventCustomFieldModal — edit", () => {
  it("pre-fills the form and keeps the field key fixed", () => {
    renderModal(dietaryField);
    expect(screen.getByText("Update how this field appears to operators.")).toBeTruthy();
    expect(screen.getByLabelText("Display label")).toHaveProperty("value", "Dietary requirements");
    expect(screen.getByText("dietary")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Display label"), { target: { value: "Something else" } });
    expect(screen.getByText("dietary")).toBeTruthy();
  });

  it("saves label/type/required changes without touching source_field", async () => {
    vi.mocked(updateEventCustomField).mockResolvedValueOnce({
      ...dietaryField,
      label: "Dietary needs",
      required: true,
    });
    renderModal(dietaryField);
    fireEvent.change(screen.getByLabelText("Display label"), {
      target: { value: "Dietary needs" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Required" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(updateEventCustomField).toHaveBeenCalledWith("evt-1", "field-dietary", {
        label: "Dietary needs",
        description: null,
        required: true,
      });
    });
  });

  it("leaves the registration form alone when a field is edited, also from the Registration page", async () => {
    vi.mocked(updateEventCustomField).mockResolvedValueOnce({ ...dietaryField, required: true });
    renderWithToast(<EventCustomFieldModal eventId="evt-1" field={dietaryField} showOnForm onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Required" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateEventCustomField).toHaveBeenCalled());
    expect(vi.mocked(updateEventCustomField).mock.calls[0]![2]).not.toHaveProperty("show_on_form");
  });

  it("pre-fills an existing description and sends the edited value", async () => {
    const fieldWithDescription: EventCustomFieldDto = {
      ...dietaryField,
      description: "Old description",
    };
    vi.mocked(updateEventCustomField).mockResolvedValueOnce({
      ...fieldWithDescription,
      description: "New description",
    });
    renderModal(fieldWithDescription);
    expect(screen.getByLabelText("Description")).toHaveProperty("value", "Old description");

    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "New description" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(updateEventCustomField).toHaveBeenCalledWith("evt-1", "field-dietary", {
        label: "Dietary requirements",
        description: "New description",
        required: false,
      });
    });
  });

  const shirtField: EventCustomFieldDto = {
    ...dietaryField,
    id: "field-shirt",
    source_field: "shirt_size",
    label: "Shirt size",
    type: "select",
    required: false,
    options: ["S", "M", "L"],
  };

  it("clears a previous select field's options when switching to text", async () => {
    vi.mocked(updateEventCustomField).mockResolvedValueOnce({ ...shirtField, type: "text", options: null });
    renderModal(shirtField);
    await waitForUsageLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(updateEventCustomField).toHaveBeenCalledWith("evt-1", "field-shirt", {
        label: "Shirt size",
        description: null,
        type: "text",
        required: false,
        options: null,
      });
    });
  });

  it("does not resend options when saving an unrelated change to a select field", async () => {
    vi.mocked(updateEventCustomField).mockResolvedValueOnce({ ...shirtField, required: true });
    renderModal(shirtField);
    await waitForUsageLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Required" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(updateEventCustomField).toHaveBeenCalledWith("evt-1", "field-shirt", {
        label: "Shirt size",
        description: null,
        required: true,
      });
    });
  });

  it("does not resend options containing a comma when saving an unrelated change", async () => {
    const territoryField: EventCustomFieldDto = {
      ...dietaryField,
      id: "field-territory",
      source_field: "territory",
      label: "Territory",
      type: "select",
      required: false,
      options: ["Sales, EMEA", "Sales, APAC"],
    };
    vi.mocked(updateEventCustomField).mockResolvedValueOnce({ ...territoryField, required: true });
    renderModal(territoryField);
    await waitForUsageLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Required" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(updateEventCustomField).toHaveBeenCalledWith("evt-1", "field-territory", {
        label: "Territory",
        description: null,
        required: true,
      });
    });
  });

  it("sends the new options when a text field is switched to select and given options", async () => {
    vi.mocked(updateEventCustomField).mockResolvedValueOnce({
      ...dietaryField,
      type: "select",
      options: ["A", "B"],
    });
    renderModal(dietaryField);
    fireEvent.click(screen.getByRole("button", { name: "Single choice" }));
    addOptionRow("A");
    addOptionRow("B");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(updateEventCustomField).toHaveBeenCalledWith("evt-1", "field-dietary", {
        label: "Dietary requirements",
        description: null,
        type: "select",
        required: false,
        options: ["A", "B"],
      });
    });
  });

  it("sends the updated options when an operator adds a new one to a select field's list", async () => {
    vi.mocked(updateEventCustomField).mockResolvedValueOnce({ ...shirtField, options: ["S", "M", "L", "XL"] });
    renderModal(shirtField);
    await waitForUsageLoaded();
    addOptionRow("XL");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(updateEventCustomField).toHaveBeenCalledWith("evt-1", "field-shirt", {
        label: "Shirt size",
        description: null,
        required: false,
        options: ["S", "M", "L", "XL"],
      });
    });
  });

  it("shows how many attendees currently have each option, once loaded", async () => {
    vi.mocked(fetchEventCustomFieldOptionUsage).mockResolvedValueOnce({ S: 3, M: 42 });
    renderModal(shirtField);
    expect(usagePlaceholder()).not.toBeNull();
    // Dirty, so that the counts still being unknown is the only reason for Save to be off.
    fireEvent.change(screen.getByLabelText("Display label"), { target: { value: "Shirt sizes" } });
    expect(isOff(screen.getByRole("button", { name: "Save" }))).toBe(true);
    await waitForUsageLoaded();
    expect(isOff(screen.getByRole("button", { name: "Save" }))).toBe(false);
    expect(await screen.findByText("3 attendees")).toBeTruthy();
    expect(await screen.findByText("42 attendees")).toBeTruthy();
    expect(await screen.findByText("Unused")).toBeTruthy(); // L has no attendees
  });

  it("warns inline when renaming an option that's in use, and clears the warning if reverted", async () => {
    vi.mocked(fetchEventCustomFieldOptionUsage).mockResolvedValueOnce({ M: 42 });
    renderModal(shirtField);
    await waitForUsageLoaded();
    const mInput = screen.getAllByLabelText("Option text")[1]!; // S, M, L
    fireEvent.change(mInput, { target: { value: "Medium" } });
    expect(await screen.findByText(/42 attendees currently have “M”/)).toBeTruthy();

    fireEvent.change(mInput, { target: { value: "M" } });
    await waitFor(() => {
      expect(screen.queryByText(/42 attendees currently have “M”/)).toBeNull();
    });
  });

  it("removing an unused option deletes it immediately", async () => {
    renderModal(shirtField);
    await waitForUsageLoaded();
    const deleteButtons = screen.getAllByRole("button", { name: "Remove option" });
    fireEvent.click(deleteButtons[0]!); // S, unused
    await waitFor(() => {
      expect(screen.queryByDisplayValue("S")).toBeNull();
    });
    expect(screen.getByDisplayValue("M")).toBeTruthy();
    expect(screen.getByDisplayValue("L")).toBeTruthy();
  });

  it("removing an option that's in use asks for confirmation before it's gone", async () => {
    vi.mocked(fetchEventCustomFieldOptionUsage).mockResolvedValueOnce({ M: 42 });
    renderModal(shirtField);
    await waitForUsageLoaded();
    const deleteButtons = screen.getAllByRole("button", { name: "Remove option" });
    fireEvent.click(deleteButtons[1]!); // M, in use
    // Confirming turns the row into a "remove?" strip rather than deleting it outright - the
    // other two rows are untouched, and M's own row now reads as a confirmation, not an input.
    expect(screen.getByDisplayValue("S")).toBeTruthy();
    expect(screen.getByDisplayValue("L")).toBeTruthy();
    expect(await screen.findByText(/42 attendees currently have this value/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.getByDisplayValue("M")).toBeTruthy();

    // The row remounted from its confirm-strip markup back to a normal row - re-query rather
    // than reuse the earlier (now-detached) button reference.
    fireEvent.click(screen.getAllByRole("button", { name: "Remove option" })[1]!);
    fireEvent.click(await screen.findByRole("button", { name: "Remove anyway" }));
    await waitFor(() => {
      expect(screen.queryByDisplayValue("M")).toBeNull();
    });
  });

  it("reorders options with the up arrow key on the drag handle", async () => {
    vi.mocked(updateEventCustomField).mockResolvedValueOnce({ ...shirtField, options: ["M", "S", "L"] });
    renderModal(shirtField);
    await waitForUsageLoaded();
    const handles = screen.getAllByLabelText(/Drag to reorder/);
    fireEvent.keyDown(handles[1]!, { key: "ArrowUp" }); // move M above S
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(updateEventCustomField).toHaveBeenCalledWith("evt-1", "field-shirt", {
        label: "Shirt size",
        description: null,
        required: false,
        options: ["M", "S", "L"],
      });
    });
  });

  it("reorders options with the down arrow key on the drag handle", async () => {
    vi.mocked(updateEventCustomField).mockResolvedValueOnce({ ...shirtField, options: ["M", "S", "L"] });
    renderModal(shirtField);
    await waitForUsageLoaded();
    const handles = screen.getAllByLabelText(/Drag to reorder/);
    fireEvent.keyDown(handles[0]!, { key: "ArrowDown" }); // move S below M
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(updateEventCustomField).toHaveBeenCalledWith("evt-1", "field-shirt", {
        label: "Shirt size",
        description: null,
        required: false,
        options: ["M", "S", "L"],
      });
    });
  });

  it("shows an inline error and keeps Save disabled when the usage fetch fails", async () => {
    vi.mocked(fetchEventCustomFieldOptionUsage).mockRejectedValueOnce(new Error("network error"));
    renderModal(shirtField);
    expect(await screen.findByText(/Could not load how many attendees use each option/)).toBeTruthy();
    // Dirty, so that the counts not being known is the only reason for Save to be off.
    fireEvent.change(screen.getByLabelText("Display label"), { target: { value: "Shirt sizes" } });
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
    // A failed lookup is not "unused": every option says that its count is not known.
    expect(screen.getAllByText("Unknown")).toHaveLength(3);
    expect(screen.queryByText("Unused")).toBeNull();
  });

  it("recovers via Retry after a failed usage fetch, without requiring the modal to be reopened", async () => {
    vi.mocked(fetchEventCustomFieldOptionUsage).mockRejectedValueOnce(new Error("network error"));
    vi.mocked(fetchEventCustomFieldOptionUsage).mockResolvedValueOnce({ M: 42 });
    vi.mocked(updateEventCustomField).mockResolvedValueOnce({ ...shirtField, label: "Shirt sizes" });
    renderModal(shirtField);
    expect(await screen.findByText(/Could not load how many attendees use each option/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry loading option usage" }));
    await waitFor(() => {
      expect(screen.queryByText(/Could not load how many attendees use each option/)).toBeNull();
    });
    await waitForUsageLoaded();

    // An unrelated edit (not touching options) can now be saved without closing the modal.
    fireEvent.change(screen.getByLabelText("Display label"), { target: { value: "Shirt sizes" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(updateEventCustomField).toHaveBeenCalledWith("evt-1", "field-shirt", {
        label: "Shirt sizes",
        description: null,
        required: false,
      });
    });
  });

  it("keeps focus inside the modal when the Retry that held it goes away, instead of dropping it on the page behind", async () => {
    vi.mocked(fetchEventCustomFieldOptionUsage).mockRejectedValueOnce(new Error("network error"));
    vi.mocked(fetchEventCustomFieldOptionUsage).mockResolvedValueOnce({ M: 42 });
    renderModal(shirtField);
    expect(await screen.findByText(/Could not load how many attendees use each option/)).toBeTruthy();
    const retry = screen.getByRole("button", { name: "Retry loading option usage" });
    retry.focus();

    fireEvent.click(retry);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Retry loading option usage" })).toBeNull();
    });
    await waitForUsageLoaded();

    const active = document.activeElement;
    expect(active).not.toBe(document.body);
    expect(screen.getByRole("dialog").contains(active)).toBe(true);
  });

  it("pressing Escape while the risky-rename confirmation is open dismisses only the confirmation, not the whole modal", async () => {
    vi.mocked(fetchEventCustomFieldOptionUsage).mockResolvedValueOnce({ M: 42 });
    const onClose = vi.fn();
    renderWithToast(
      <EventCustomFieldModal eventId="evt-1" field={shirtField} onClose={onClose} onSaved={vi.fn()} />,
    );
    await waitForUsageLoaded();
    const mInput = screen.getAllByLabelText("Option text")[1]!;
    fireEvent.change(mInput, { target: { value: "Medium" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("This will affect existing attendees")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByText("This will affect existing attendees")).toBeNull();
    });
    expect(onClose).not.toHaveBeenCalled();
    // The draft survives - the whole modal wasn't discarded, only the confirmation was dismissed.
    expect(screen.getByDisplayValue("Medium")).toBeTruthy();
  });

  it("gates Save behind a confirmation when a rename affects attendees, and proceeds on Save anyway", async () => {
    vi.mocked(fetchEventCustomFieldOptionUsage).mockResolvedValueOnce({ M: 42 });
    vi.mocked(updateEventCustomField).mockResolvedValueOnce({ ...shirtField, options: ["S", "Medium", "L"] });
    renderModal(shirtField);
    await waitForUsageLoaded();
    const mInput = screen.getAllByLabelText("Option text")[1]!;
    fireEvent.change(mInput, { target: { value: "Medium" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(updateEventCustomField).not.toHaveBeenCalled();
    expect(await screen.findByText("This will affect existing attendees")).toBeTruthy();
    expect(screen.getByText(/Renaming “M” to “Medium” affects 42 attendees/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    await waitFor(() => {
      expect(updateEventCustomField).toHaveBeenCalledWith("evt-1", "field-shirt", {
        label: "Shirt size",
        description: null,
        required: false,
        options: ["S", "Medium", "L"],
      });
    });
  });

  it("gates Save behind a confirmation when an in-use option is blanked instead of deleted, and drops it once confirmed", async () => {
    vi.mocked(fetchEventCustomFieldOptionUsage).mockResolvedValueOnce({ M: 42 });
    vi.mocked(updateEventCustomField).mockResolvedValueOnce({ ...shirtField, options: ["S", "L"] });
    renderModal(shirtField);
    await waitForUsageLoaded();
    const mInput = screen.getAllByLabelText("Option text")[1]!;
    fireEvent.change(mInput, { target: { value: "" } }); // cleared, not deleted via the trash button

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(updateEventCustomField).not.toHaveBeenCalled();
    expect(await screen.findByText("This will affect existing attendees")).toBeTruthy();
    expect(screen.getByText(/Removing “M” affects 42 attendees/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    await waitFor(() => {
      expect(updateEventCustomField).toHaveBeenCalledWith("evt-1", "field-shirt", {
        label: "Shirt size",
        description: null,
        required: false,
        options: ["S", "L"],
      });
    });
  });

  it("cancelling the risky-rename confirmation saves nothing and leaves the draft editable", async () => {
    vi.mocked(fetchEventCustomFieldOptionUsage).mockResolvedValueOnce({ M: 42 });
    renderModal(shirtField);
    await waitForUsageLoaded();
    const mInput = screen.getAllByLabelText("Option text")[1]!;
    fireEvent.change(mInput, { target: { value: "Medium" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("This will affect existing attendees")).toBeTruthy();

    // The modal's own "Cancel" (close the whole form) is also on screen behind the confirmation -
    // the confirmation's own Cancel is the last one added to the DOM.
    const cancelButtons = screen.getAllByRole("button", { name: "Cancel" });
    fireEvent.click(cancelButtons[cancelButtons.length - 1]!);
    await waitFor(() => {
      expect(screen.queryByText("This will affect existing attendees")).toBeNull();
    });
    expect(updateEventCustomField).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Medium")).toBeTruthy();
  });

  it("uses singular wording when a rename affects exactly one attendee", async () => {
    vi.mocked(fetchEventCustomFieldOptionUsage).mockResolvedValueOnce({ S: 1 });
    renderModal(shirtField);
    await waitForUsageLoaded();
    const sInput = screen.getAllByLabelText("Option text")[0]!;
    fireEvent.change(sInput, { target: { value: "Small" } });
    expect(await screen.findByText(/1 attendee currently has “S”/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Renaming “S” to “Small” affects 1 attendee\./)).toBeTruthy();
  });

  it("never saves while the usage-count fetch is still pending, even if the form is submitted directly", async () => {
    let resolveUsage!: (counts: Record<string, number>) => void;
    vi.mocked(fetchEventCustomFieldOptionUsage).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveUsage = resolve;
      }),
    );
    const { container } = renderWithToast(
      <EventCustomFieldModal eventId="evt-1" field={shirtField} onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    const form = container.querySelector("#custom-field-form")!;
    fireEvent.submit(form);
    expect(updateEventCustomField).not.toHaveBeenCalled();

    resolveUsage({});
    await waitForUsageLoaded();
  });
});

describe("EventCustomFieldModal: the Save button", () => {
  const textField: EventCustomFieldDto = {
    id: "field-diet",
    source_field: "diet",
    label: "Diet",
    description: null,
    type: "text",
    required: false,
    options: null,
    created_at: "2026-01-01T00:00:00.000Z",
  };

  it("shows the save on the button, which keeps its label and the keyboard focus, makes the fields read-only and ignores a second press", async () => {
    const saved = deferred<EventCustomFieldDto>();
    vi.mocked(updateEventCustomField).mockReturnValueOnce(saved.promise);
    renderModal(textField);
    const label = screen.getByLabelText("Display label") as HTMLInputElement;
    fireEvent.change(label, { target: { value: "Diet needs" } });
    const save = screen.getByRole("button", { name: "Save" });
    save.focus();
    fireEvent.click(save);

    await waitFor(() => expect(save.getAttribute("aria-busy")).toBe("true"));
    expect(save.textContent).toContain("Save");
    expect(isOff(save)).toBe(true);
    expect(save.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(save);
    expect(label.readOnly).toBe(true);
    expect((screen.getByLabelText("Description") as HTMLTextAreaElement).readOnly).toBe(true);
    expect(screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(save);
    expect(updateEventCustomField).toHaveBeenCalledTimes(1);

    await act(async () => saved.resolve(textField));
  });

  it("does not save twice when Enter is pressed in a field while the save runs", async () => {
    const saved = deferred<EventCustomFieldDto>();
    vi.mocked(updateEventCustomField).mockReturnValueOnce(saved.promise);
    renderModal(textField);
    fireEvent.change(screen.getByLabelText("Display label"), { target: { value: "Diet needs" } });
    const form = document.getElementById("custom-field-form") as HTMLFormElement;
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" }).getAttribute("aria-busy")).toBe("true"));

    fireEvent.submit(form);

    expect(updateEventCustomField).toHaveBeenCalledTimes(1);
    await act(async () => saved.resolve(textField));
  });

  it("brings the button back, with the focus and what was typed, when the save fails", async () => {
    vi.mocked(updateEventCustomField).mockRejectedValueOnce(new Error("network error"));
    renderModal(textField);
    const label = screen.getByLabelText("Display label") as HTMLInputElement;
    fireEvent.change(label, { target: { value: "Diet needs" } });
    const save = screen.getByRole("button", { name: "Save" });
    save.focus();
    fireEvent.click(save);

    await waitFor(() => expect(addToast).toHaveBeenCalledWith(expect.any(String), "error"));
    expect(save.getAttribute("aria-busy")).not.toBe("true");
    expect(isOff(save)).toBe(false);
    expect(document.activeElement).toBe(save);
    expect(label.readOnly).toBe(false);
    expect(label.value).toBe("Diet needs");
  });

  it("keeps the label of Create field while it works, too", async () => {
    const created = deferred<EventCustomFieldDto>();
    vi.mocked(createEventCustomField).mockReturnValueOnce(created.promise);
    renderModal(null);
    fireEvent.change(screen.getByLabelText("Display label"), { target: { value: "Parking" } });
    const create = screen.getByRole("button", { name: "Create field" });
    fireEvent.click(create);

    await waitFor(() => expect(create.getAttribute("aria-busy")).toBe("true"));
    expect(create.textContent).toContain("Create field");
    await act(async () => created.resolve(textField));
  });
});

describe("EventCustomFieldModal: the option usage lookup", () => {
  const selectField: EventCustomFieldDto = {
    id: "field-shirt",
    source_field: "shirt_size",
    label: "Shirt size",
    description: null,
    type: "select",
    required: false,
    options: ["S", "M"],
    created_at: "2026-01-01T00:00:00.000Z",
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds the room of the counts invisibly for 200ms, then draws bars, and Save stays off meanwhile", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchEventCustomFieldOptionUsage).mockImplementation(hangUntilAborted as never);
    renderModal(selectField);
    await advanceTimers(0);

    const bars = Array.from(document.querySelectorAll(".options-editor__usage-skeleton"));
    expect(bars).toHaveLength(2);
    expect(bars.every((bar) => bar.classList.contains("at-loading-hold"))).toBe(true);
    expect(screen.queryByText("Unknown")).toBeNull();
    fireEvent.change(screen.getByLabelText("Display label"), { target: { value: "Shirt sizes" } });
    expect(isOff(screen.getByRole("button", { name: "Save" }))).toBe(true);

    await advanceTimers(200);
    expect(bars.some((bar) => bar.classList.contains("at-loading-hold"))).toBe(false);
  });

  it("never draws the bars for an answer that comes within 200ms", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchEventCustomFieldOptionUsage).mockResolvedValueOnce({ S: 2 });
    renderModal(selectField);
    await advanceTimers(0);

    expect(usagePlaceholder()).toBeNull();
    expect(screen.getByText("2 attendees")).toBeTruthy();
  });

  it("says it is taking longer than usual after 8 seconds of waiting for the counts, and gives that up for the error at 30", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchEventCustomFieldOptionUsage).mockImplementationOnce(hangUntilAborted as never);
    renderModal(selectField);
    await advanceTimers(0);

    await advanceTimers(SLOW_NOTICE_MS - 1);
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
    await advanceTimers(1);
    expect(screen.getByText(SLOW_NOTICE_TEXT)).toBeTruthy();
    // Waiting is not a reason to let a save through: the counts are still not known.
    fireEvent.change(screen.getByLabelText("Display label"), { target: { value: "Shirt sizes" } });
    expect(isOff(screen.getByRole("button", { name: "Save" }))).toBe(true);

    // The limit gives the request up: the wait is over, so the note goes and the error with its Retry takes its place.
    await advanceTimers(LOAD_TIMEOUT_MS - SLOW_NOTICE_MS);
    await advanceTimers(0);
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(LOAD_TIMEOUT_MESSAGE);
  });

  it("gives up after 30 seconds with an error and a Retry that stays on screen, busy, until the answer is in", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchEventCustomFieldOptionUsage).mockImplementationOnce(hangUntilAborted as never);
    renderModal(selectField);
    await advanceTimers(0);
    await advanceTimers(30_000);
    await advanceTimers(0);

    expect(screen.getByRole("alert").textContent).toContain(LOAD_TIMEOUT_MESSAGE);
    expect(screen.getAllByText("Unknown")).toHaveLength(2);

    const answer = deferred<Record<string, number>>();
    vi.mocked(fetchEventCustomFieldOptionUsage).mockReturnValueOnce(answer.promise);
    const retry = screen.getByRole("button", { name: "Retry loading option usage" });
    retry.focus();
    fireEvent.click(retry);
    await advanceTimers(500);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(retry.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(retry);
    expect(screen.getByRole("alert").textContent).toContain(LOAD_TIMEOUT_MESSAGE);

    await act(async () => answer.resolve({ S: 1 }));
    await advanceTimers(500);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("1 attendee")).toBeTruthy();
  });

  it("reads the counts of the field being edited, with a signal that stops the request when the modal closes", async () => {
    vi.mocked(fetchEventCustomFieldOptionUsage).mockImplementationOnce(hangUntilAborted as never);
    const { unmount } = renderWithToast(<EventCustomFieldModal eventId="evt-1" field={selectField} onClose={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(fetchEventCustomFieldOptionUsage).toHaveBeenCalledTimes(1));

    const [eventId, fieldId, signal] = vi.mocked(fetchEventCustomFieldOptionUsage).mock.calls[0] as unknown as [string, string, AbortSignal];
    expect([eventId, fieldId]).toEqual(["evt-1", "field-shirt"]);
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it("reads nothing for a field that is being created, or whose type is not a choice", async () => {
    const { unmount } = renderWithToast(<EventCustomFieldModal eventId="evt-1" field={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await act(async () => {});
    expect(fetchEventCustomFieldOptionUsage).not.toHaveBeenCalled();
    unmount();

    renderModal({ ...selectField, id: "field-text", type: "text", options: null });
    await act(async () => {});
    expect(fetchEventCustomFieldOptionUsage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// The answer types long text, date, date and time and phone, and the format rules (v0.8).
// ---------------------------------------------------------------------------------------------

const typeButton = (name: string) => screen.getByRole("button", { name });
const rulesEditor = () => screen.queryByRole("group", { name: "Format rules" });
const createButton = () => screen.getByRole("button", { name: "Create field" });
const saveButton = () => screen.getByRole("button", { name: "Save" });
const digitsOnlySwitch = () => screen.getByRole("switch", { name: "Digits only" }) as HTMLInputElement;
const setBox = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const lastCall = (mock: typeof createEventCustomField | typeof updateEventCustomField) => mock.mock.calls.at(-1)![mock === createEventCustomField ? 1 : 2] as Record<string, unknown>;

/** A field that exists, with the rules and type of the test; everything else is as plain as can be. */
function existingField(changes: Partial<EventCustomFieldDto>): EventCustomFieldDto {
  return { ...dietaryField, id: "field-ruled", source_field: "postcode", label: "Postcode", ...changes };
}

describe("EventCustomFieldModal: the answer types", () => {
  it("offers every answer type as a button with its name, text first and pressed, in a group named Field type", () => {
    renderModal(null);
    const group = screen.getByRole("group", { name: "Field type" });
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons.map((button) => button.textContent)).toEqual(["Text", "Long text", "Date", "Date and time", "Phone", "Single choice", "Yes / No"]);
    expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false", "false", "false", "false"]);
    expect(group.querySelectorAll("button i.ti")).toHaveLength(7);
  });

  it.each(CUSTOM_FIELD_TYPES)("presses $label, drops the pressed state of the one before it and shows its hint", ({ label, hint }) => {
    renderModal(null);
    fireEvent.click(typeButton(label));
    expect(typeButton(label).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("button", { pressed: true }).filter((button) => button.closest(".custom-field-types"))).toHaveLength(1);
    expect(screen.getByText(hint)).toBeTruthy();
  });

  it.each(["long_text", "date", "datetime", "phone"] as const)("creates a %s field, with no rules", async (type) => {
    vi.mocked(createEventCustomField).mockResolvedValueOnce({ ...dietaryField, type });
    renderModal(null);
    setBox("Display label", "Arrival");
    fireEvent.click(typeButton(CUSTOM_FIELD_TYPES.find((entry) => entry.value === type)!.label));
    fireEvent.click(createButton());
    await waitFor(() => {
      expect(createEventCustomField).toHaveBeenCalledWith("evt-1", {
        source_field: "arrival",
        label: "Arrival",
        description: undefined,
        type,
        required: false,
        options: undefined,
      });
    });
    expect(lastCall(createEventCustomField)).not.toHaveProperty("rules");
  });

  it("keeps the type buttons off while the field is being saved, with the one that was pressed still pressed", async () => {
    const saved = deferred<EventCustomFieldDto>();
    vi.mocked(createEventCustomField).mockReturnValueOnce(saved.promise);
    renderModal(null);
    setBox("Display label", "Arrival");
    fireEvent.click(typeButton("Date"));
    fireEvent.click(createButton());
    await waitFor(() => expect(createButton().getAttribute("aria-busy")).toBe("true"));

    for (const entry of CUSTOM_FIELD_TYPES) expect(typeButton(entry.label).hasAttribute("disabled"), entry.label).toBe(true);
    expect(typeButton("Date").getAttribute("aria-pressed")).toBe("true");
    await act(async () => saved.resolve(dietaryField));
    expect(typeButton("Date").hasAttribute("disabled")).toBe(false);
  });

  it("shows a type the editor lists in a field that is edited, pressed, and edits it into another", async () => {
    vi.mocked(updateEventCustomField).mockResolvedValueOnce({ ...dietaryField, type: "datetime" });
    renderModal({ ...dietaryField, type: "date" });
    expect(typeButton("Date").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(typeButton("Date and time"));
    fireEvent.click(saveButton());
    await waitFor(() => {
      expect(updateEventCustomField).toHaveBeenCalledWith("evt-1", "field-dietary", {
        label: "Dietary requirements",
        description: null,
        type: "datetime",
        required: false,
      });
    });
  });
});

describe("EventCustomFieldModal: the format rules", () => {
  it.each([
    ["Text", true],
    ["Long text", true],
    ["Phone", true],
    ["Date", false],
    ["Date and time", false],
    ["Single choice", false],
    ["Yes / No", false],
  ])("%s: the rules editor is there: %s", (label, there) => {
    renderModal(null);
    fireEvent.click(typeButton(label));
    expect(rulesEditor() !== null).toBe(there);
  });

  it("names the boxes, and says what the lengths take, for the type that is picked", () => {
    renderModal(null);
    expect(screen.getByLabelText("Shortest answer")).toBeTruthy();
    expect(screen.getByLabelText("Longest answer")).toBeTruthy();
    expect(screen.getByLabelText("Example")).toBeTruthy();
    expect(digitsOnlySwitch().checked).toBe(false);
    expect(screen.getByText("Whole numbers, up to 100 characters.")).toBeTruthy();
    fireEvent.click(typeButton("Long text"));
    expect(screen.getByText("Whole numbers, up to 1000 characters.")).toBeTruthy();
    fireEvent.click(typeButton("Phone"));
    expect(screen.getByText(/a leading \+ and its digits, 3 to 16 characters/)).toBeTruthy();
    expect(screen.getByText("Only the digits 0 to 9, so a number written with a + is refused.")).toBeTruthy();
  });

  it("creates a text field with the rules an operator sets, the example without the spaces around it", async () => {
    vi.mocked(createEventCustomField).mockResolvedValueOnce(dietaryField);
    renderModal(null);
    setBox("Display label", "Postcode");
    setBox("Shortest answer", "5");
    setBox("Longest answer", "5");
    fireEvent.click(digitsOnlySwitch());
    setBox("Example", "  01234 ");
    fireEvent.click(createButton());
    await waitFor(() => {
      expect(createEventCustomField).toHaveBeenCalledWith("evt-1", {
        source_field: "postcode",
        label: "Postcode",
        description: undefined,
        type: "text",
        required: false,
        options: undefined,
        rules: { min_length: 5, max_length: 5, digits_only: true, example: "01234" },
      });
    });
  });

  it.each(["long_text", "phone"] as const)("creates a %s field with its rules, too", async (type) => {
    vi.mocked(createEventCustomField).mockResolvedValueOnce({ ...dietaryField, type });
    renderModal(null);
    setBox("Display label", "Answer");
    fireEvent.click(typeButton(type === "phone" ? "Phone" : "Long text"));
    setBox("Longest answer", "12");
    fireEvent.click(createButton());
    await waitFor(() => expect(createEventCustomField).toHaveBeenCalled());
    expect(lastCall(createEventCustomField)).toMatchObject({ type, rules: { max_length: 12 } });
  });

  it("leaves a rule out that is empty or turned off, and sends no rules at all when there are none", async () => {
    vi.mocked(createEventCustomField).mockResolvedValueOnce(dietaryField);
    renderModal(null);
    setBox("Display label", "Diet");
    fireEvent.click(digitsOnlySwitch());
    fireEvent.click(digitsOnlySwitch());
    setBox("Example", "   ");
    fireEvent.click(createButton());
    await waitFor(() => expect(createEventCustomField).toHaveBeenCalled());
    expect(lastCall(createEventCustomField)).not.toHaveProperty("rules");
  });

  it("takes only digits in a length box, whatever is typed or pasted", () => {
    renderModal(null);
    setBox("Shortest answer", "a1 b-2.5");
    expect((screen.getByLabelText("Shortest answer") as HTMLInputElement).value).toBe("125");
    expect((screen.getByLabelText("Shortest answer") as HTMLInputElement).inputMode).toBe("numeric");
  });

  describe("a rule the server would refuse", () => {
    function fillLabel() {
      setBox("Display label", "Postcode");
    }

    it.each([
      ["Text", "Longest answer", "101", "Enter a whole number from 1 to 100."],
      ["Text", "Shortest answer", "0", "Enter a whole number from 1 to 100."],
      ["Long text", "Longest answer", "1001", "Enter a whole number from 1 to 1000."],
      ["Phone", "Longest answer", "17", "Enter a whole number from 1 to 16."],
    ])("%s, %s %s: says so where the boxes are, marks the box, and keeps Create field off until it is fixed", (type, box, value, message) => {
      renderModal(null);
      fillLabel();
      fireEvent.click(typeButton(type));
      setBox(box, value);
      expect(screen.getByRole("alert").textContent).toBe(message);
      expect(screen.getByLabelText(box).getAttribute("aria-invalid")).toBe("true");
      expect(createButton().hasAttribute("disabled")).toBe(true);

      setBox(box, "5");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByLabelText(box).getAttribute("aria-invalid")).toBeNull();
      expect(createButton().hasAttribute("disabled")).toBe(false);
    });

    it("refuses a shortest answer longer than the longest, naming both boxes", () => {
      renderModal(null);
      fillLabel();
      setBox("Shortest answer", "10");
      setBox("Longest answer", "9");
      expect(screen.getByRole("alert").textContent).toBe("The longest answer can't be shorter than the shortest.");
      expect(screen.getByLabelText("Shortest answer").getAttribute("aria-invalid")).toBe("true");
      expect(screen.getByLabelText("Longest answer").getAttribute("aria-invalid")).toBe("true");
      expect(createButton().hasAttribute("disabled")).toBe(true);
    });

    it("refuses the lengths of a phone field that no number can meet, and lets the same lengths through on a text field", () => {
      renderModal(null);
      fillLabel();
      setBox("Longest answer", "2");
      expect(screen.queryByRole("alert")).toBeNull();
      fireEvent.click(typeButton("Phone"));
      expect(screen.getByRole("alert").textContent).toBe("No phone number fits these rules: a saved number has 3 to 16 characters.");
      expect(createButton().hasAttribute("disabled")).toBe(true);

      setBox("Longest answer", "");
      fireEvent.click(digitsOnlySwitch());
      setBox("Shortest answer", "16");
      expect(screen.getByRole("alert").textContent).toBe("No phone number fits these rules: a saved number has 3 to 15 characters.");
    });

    it("refuses an example that is too long, counting an emoji as one character, or has an invisible one", () => {
      renderModal(null);
      fillLabel();
      const emoji = String.fromCodePoint(0x1f600);
      setBox("Example", emoji.repeat(100));
      expect(screen.queryByRole("alert")).toBeNull();
      setBox("Example", emoji.repeat(101));
      expect(screen.getByRole("alert").textContent).toBe("Use at most 100 characters.");
      expect(createButton().hasAttribute("disabled")).toBe(true);
      setBox("Example", `a${String.fromCodePoint(0x200b)}b`);
      expect(screen.getByRole("alert").textContent).toBe("Use plain text on one line, with no invisible characters.");
      setBox("Example", "ok");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(createButton().hasAttribute("disabled")).toBe(false);
    });

    it("keeps the room of the line under the lengths when its text turns into an error and back", () => {
      renderModal(null);
      const note = document.getElementById("cf-rules-lengths-note")!;
      expect(note.querySelector(".at-hint--error")).toBeNull();
      setBox("Longest answer", "999");
      expect(note.querySelector(".at-hint--error")).not.toBeNull();
      expect(document.getElementById("cf-rules-lengths-note")).toBe(note);
    });
  });

  describe("when the type is changed", () => {
    it("keeps what was typed and judges it by the new type: a longest answer of 50 is fine for a text and too long for a phone number", () => {
      renderModal(null);
      setBox("Display label", "Answer");
      setBox("Longest answer", "50");
      expect(createButton().hasAttribute("disabled")).toBe(false);
      fireEvent.click(typeButton("Phone"));
      expect((screen.getByLabelText("Longest answer") as HTMLInputElement).value).toBe("50");
      expect(screen.getByRole("alert").textContent).toBe("Enter a whole number from 1 to 16.");
      expect(createButton().hasAttribute("disabled")).toBe(true);
      fireEvent.click(typeButton("Long text"));
      expect(screen.queryByRole("alert")).toBeNull();
      expect(createButton().hasAttribute("disabled")).toBe(false);
    });

    it("takes the rules away with a type that has none, whatever the boxes hold, and gives them back with the type that has them", async () => {
      vi.mocked(createEventCustomField).mockResolvedValueOnce({ ...dietaryField, type: "date" });
      renderModal(null);
      setBox("Display label", "Arrival");
      setBox("Longest answer", "999");
      expect(createButton().hasAttribute("disabled")).toBe(true);

      fireEvent.click(typeButton("Date"));
      expect(rulesEditor()).toBeNull();
      expect(createButton().hasAttribute("disabled")).toBe(false);
      fireEvent.click(typeButton("Text"));
      expect((screen.getByLabelText("Longest answer") as HTMLInputElement).value).toBe("999");
      expect(createButton().hasAttribute("disabled")).toBe(true);

      fireEvent.click(typeButton("Date"));
      fireEvent.click(createButton());
      await waitFor(() => expect(createEventCustomField).toHaveBeenCalled());
      expect(lastCall(createEventCustomField)).toMatchObject({ type: "date" });
      expect(lastCall(createEventCustomField)).not.toHaveProperty("rules");
    });
  });

  describe("a field that exists", () => {
    const ruled = existingField({ rules: { min_length: 5, max_length: 5, digits_only: true, example: "01234" } });

    it("opens with its rules in the boxes", () => {
      renderModal(ruled);
      expect((screen.getByLabelText("Shortest answer") as HTMLInputElement).value).toBe("5");
      expect((screen.getByLabelText("Longest answer") as HTMLInputElement).value).toBe("5");
      expect(digitsOnlySwitch().checked).toBe(true);
      expect((screen.getByLabelText("Example") as HTMLInputElement).value).toBe("01234");
    });

    it("sends no rules when only something else is edited, so the rules stay as they are", async () => {
      vi.mocked(updateEventCustomField).mockResolvedValueOnce(ruled);
      renderModal(ruled);
      setBox("Display label", "Post code");
      fireEvent.click(saveButton());
      await waitFor(() => {
        expect(updateEventCustomField).toHaveBeenCalledWith("evt-1", "field-ruled", {
          label: "Post code",
          description: null,
          required: false,
        });
      });
      expect(lastCall(updateEventCustomField)).not.toHaveProperty("rules");
    });

    it("sends all the rules, changed, when one is edited: an object replaces them", async () => {
      vi.mocked(updateEventCustomField).mockResolvedValueOnce(ruled);
      renderModal(ruled);
      setBox("Longest answer", "6");
      fireEvent.click(saveButton());
      await waitFor(() => {
        expect(updateEventCustomField).toHaveBeenCalledWith("evt-1", "field-ruled", {
          label: "Postcode",
          description: null,
          required: false,
          rules: { min_length: 5, max_length: 6, digits_only: true, example: "01234" },
        });
      });
    });

    it("sends null when every rule is cleared, which is how the server is asked to drop them", async () => {
      vi.mocked(updateEventCustomField).mockResolvedValueOnce(existingField({}));
      renderModal(ruled);
      setBox("Shortest answer", "");
      setBox("Longest answer", "");
      fireEvent.click(digitsOnlySwitch());
      setBox("Example", "");
      fireEvent.click(saveButton());
      await waitFor(() => expect(updateEventCustomField).toHaveBeenCalled());
      expect(lastCall(updateEventCustomField)).toMatchObject({ rules: null });
    });

    it("does not offer Save for rules typed while the type was one that takes them and left behind when it was put back", () => {
      renderModal(existingField({ type: "date" }));
      expect(isOff(saveButton())).toBe(true);
      fireEvent.click(typeButton("Text"));
      setBox("Longest answer", "9");
      expect(isOff(saveButton())).toBe(false);
      fireEvent.click(typeButton("Date"));
      expect(isOff(saveButton())).toBe(true);
    });

    it("does not offer Save for rules that were typed and put back as they were", () => {
      renderModal(ruled);
      expect(isOff(saveButton())).toBe(true);
      setBox("Longest answer", "6");
      expect(isOff(saveButton())).toBe(false);
      setBox("Longest answer", "5");
      expect(isOff(saveButton())).toBe(true);
    });

    it("sends null for the rules and the new type when it becomes a type that takes none, the pair the server needs", async () => {
      vi.mocked(updateEventCustomField).mockResolvedValueOnce(existingField({ type: "date" }));
      renderModal(ruled);
      fireEvent.click(typeButton("Date"));
      fireEvent.click(saveButton());
      await waitFor(() => {
        expect(updateEventCustomField).toHaveBeenCalledWith("evt-1", "field-ruled", {
          label: "Postcode",
          description: null,
          type: "date",
          required: false,
          rules: null,
        });
      });
    });

    it("sends no rules for a type that takes none when the field has none", async () => {
      vi.mocked(updateEventCustomField).mockResolvedValueOnce(existingField({ type: "datetime" }));
      renderModal(existingField({}));
      fireEvent.click(typeButton("Date and time"));
      fireEvent.click(saveButton());
      await waitFor(() => expect(updateEventCustomField).toHaveBeenCalled());
      expect(lastCall(updateEventCustomField)).toMatchObject({ type: "datetime" });
      expect(lastCall(updateEventCustomField)).not.toHaveProperty("rules");
    });

    it("keeps the rules, and sends none, when a text field becomes a long text: they fit, so the server keeps them", async () => {
      vi.mocked(updateEventCustomField).mockResolvedValueOnce(existingField({ type: "long_text", rules: ruled.rules }));
      renderModal(ruled);
      fireEvent.click(typeButton("Long text"));
      fireEvent.click(saveButton());
      await waitFor(() => expect(updateEventCustomField).toHaveBeenCalled());
      expect(lastCall(updateEventCustomField)).toMatchObject({ type: "long_text" });
      expect(lastCall(updateEventCustomField)).not.toHaveProperty("rules");
    });

    it("has to be given rules that fit a phone number before a text field with long rules becomes one", async () => {
      const wide = existingField({ rules: { max_length: 100 } });
      vi.mocked(updateEventCustomField).mockResolvedValueOnce(existingField({ type: "phone", rules: { max_length: 16 } }));
      renderModal(wide);
      fireEvent.click(typeButton("Phone"));
      expect(screen.getByRole("alert").textContent).toBe("Enter a whole number from 1 to 16.");
      expect(isOff(saveButton())).toBe(true);

      setBox("Longest answer", "16");
      fireEvent.click(saveButton());
      await waitFor(() => {
        expect(updateEventCustomField).toHaveBeenCalledWith("evt-1", "field-ruled", {
          label: "Postcode",
          description: null,
          type: "phone",
          required: false,
          rules: { max_length: 16 },
        });
      });
    });

    it("names the type of a choice field only when it changes, since the server refuses a choice that comes without its options", async () => {
      const shirt = existingField({ source_field: "shirt_size", label: "Shirt size", type: "select", options: ["S", "M"] });
      vi.mocked(fetchEventCustomFieldOptionUsage).mockResolvedValue({});
      vi.mocked(updateEventCustomField).mockResolvedValue(shirt);
      renderModal(shirt);
      await waitForUsageLoaded();
      fireEvent.click(screen.getByRole("button", { name: "Required" }));
      fireEvent.click(saveButton());
      await waitFor(() => expect(updateEventCustomField).toHaveBeenCalledTimes(1));
      expect(lastCall(updateEventCustomField)).not.toHaveProperty("type");
      expect(lastCall(updateEventCustomField)).not.toHaveProperty("options");
      expect(lastCall(updateEventCustomField)).not.toHaveProperty("rules");
    });

    it("sends a new type together with the options when a text field becomes a choice", async () => {
      vi.mocked(updateEventCustomField).mockResolvedValueOnce(existingField({ type: "select", options: ["A"] }));
      renderModal(existingField({}));
      fireEvent.click(typeButton("Single choice"));
      addOptionRow("A");
      fireEvent.click(saveButton());
      await waitFor(() => expect(updateEventCustomField).toHaveBeenCalled());
      expect(lastCall(updateEventCustomField)).toMatchObject({ type: "select", options: ["A"] });
    });
  });

  describe("the warning about the answers already saved", () => {
    const warning = () => screen.queryByText(/Answers already saved are not changed/);

    it("is there once a field that exists is given another type, and goes when the type is put back", () => {
      renderModal(existingField({}));
      expect(warning()).toBeNull();
      fireEvent.click(typeButton("Phone"));
      expect(warning()).toBeTruthy();
      expect(warning()!.textContent).toContain("can't be edited until that answer is replaced or cleared");
      fireEvent.click(typeButton("Text"));
      expect(warning()).toBeNull();
    });

    it("is there once a rule is changed, and goes when the rule is put back", () => {
      renderModal(existingField({ rules: { max_length: 5 } }));
      expect(warning()).toBeNull();
      setBox("Longest answer", "6");
      expect(warning()).toBeTruthy();
      setBox("Longest answer", "5");
      expect(warning()).toBeNull();
    });

    it("is not there for another edit, and not for rules typed and left behind by a type that takes none", () => {
      renderModal(existingField({ type: "date" }));
      setBox("Display label", "Arrival");
      fireEvent.click(typeButton("Text"));
      setBox("Longest answer", "9");
      fireEvent.click(typeButton("Date"));
      expect(warning()).toBeNull();
    });

    it("is not there for a field that is being created, whatever is typed", () => {
      renderModal(null);
      fireEvent.click(typeButton("Phone"));
      setBox("Longest answer", "9");
      expect(warning()).toBeNull();
    });

    it("is told to assistive technology as a status, with the warning icon", () => {
      renderModal(existingField({}));
      fireEvent.click(typeButton("Phone"));
      const notice = warning()!.closest("output")!;
      expect(notice.className).toContain("at-notice--warning");
      expect(notice.querySelector(".ti-alert-triangle")).not.toBeNull();
    });
  });

  describe("when the server refuses the save", () => {
    it("says why through the shared messages, keeps the dialog open with what was typed, and gives the button back", async () => {
      vi.mocked(updateEventCustomField).mockRejectedValueOnce(new ApiError(422, "invalid_field_rules", "invalid_field_rules"));
      renderModal(existingField({ rules: { max_length: 5 } }));
      setBox("Longest answer", "6");
      fireEvent.click(saveButton());

      await waitFor(() => expect(addToast).toHaveBeenCalledWith(expect.stringContaining("rules do not fit the field"), "error"));
      expect(screen.getByRole("dialog", { hidden: true })).toBeTruthy();
      expect((screen.getByLabelText("Longest answer") as HTMLInputElement).value).toBe("6");
      expect(saveButton().getAttribute("aria-busy")).not.toBe("true");
      expect(isOff(saveButton())).toBe(false);
    });

    it("never shows the server's own words", async () => {
      vi.mocked(createEventCustomField).mockRejectedValueOnce(new ApiError(422, "secret_internal_detail", "secret_internal_detail"));
      renderModal(null);
      setBox("Display label", "Diet");
      fireEvent.click(createButton());
      await waitFor(() => expect(addToast).toHaveBeenCalled());
      expect(addToast.mock.calls[0]![0]).not.toContain("secret_internal_detail");
    });
  });

  describe("while the field is saved", () => {
    it("keeps the rule boxes on screen with what they hold, read-only, and ignores a switch of Digits only", async () => {
      const saved = deferred<EventCustomFieldDto>();
      vi.mocked(updateEventCustomField).mockReturnValueOnce(saved.promise);
      renderModal(existingField({ rules: { max_length: 5, example: "01234" } }));
      setBox("Longest answer", "6");
      fireEvent.click(saveButton());
      await waitFor(() => expect(saveButton().getAttribute("aria-busy")).toBe("true"));

      for (const label of ["Shortest answer", "Longest answer", "Example"]) {
        expect((screen.getByLabelText(label) as HTMLInputElement).readOnly, label).toBe(true);
      }
      expect((screen.getByLabelText("Longest answer") as HTMLInputElement).value).toBe("6");
      expect(digitsOnlySwitch().getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(digitsOnlySwitch());
      expect(digitsOnlySwitch().checked).toBe(false);
      expect(updateEventCustomField).toHaveBeenCalledTimes(1);
      await act(async () => saved.resolve(existingField({})));
    });
  });
});
