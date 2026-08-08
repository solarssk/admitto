// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { EventCustomFieldDto } from "../../src/api/types.js";
import { EventCustomFieldModal } from "../../src/requirements/EventCustomFieldModal.js";
import { renderWithToast } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    createEventCustomField: vi.fn(),
    updateEventCustomField: vi.fn(),
  };
});

import { createEventCustomField, updateEventCustomField } from "../../src/api/client.js";

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
});

function renderModal(field: EventCustomFieldDto | null) {
  renderWithToast(
    <EventCustomFieldModal eventId="evt-1" field={field} onClose={vi.fn()} onSaved={vi.fn()} />,
  );
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
    expect(screen.queryByText("Enter a display label using letters or numbers.")).toBeNull();
    expect(createEventCustomField).not.toHaveBeenCalled();
  });

  it("keeps Create field disabled for a select field with no options", () => {
    renderModal(null);
    fireEvent.change(screen.getByLabelText("Display label"), { target: { value: "Size" } });
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(screen.getByRole("button", { name: "Create field" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText("Select fields need at least one option.")).toBeNull();
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

  it("creates a select field with parsed options and required", async () => {
    vi.mocked(createEventCustomField).mockResolvedValueOnce({
      ...dietaryField,
      type: "select",
      required: true,
      options: ["S", "M", "L"],
    });
    renderModal(null);
    fireEvent.change(screen.getByLabelText("Display label"), { target: { value: "Shirt size" } });
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.change(screen.getByLabelText("Select options"), { target: { value: "S\nM\nL" } });
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
        type: "text",
        required: true,
        options: null,
      });
    });
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
        type: "text",
        required: false,
        options: null,
      });
    });
  });

  it("clears a previous select field's options when switching to text", async () => {
    const shirtField: EventCustomFieldDto = {
      ...dietaryField,
      id: "field-shirt",
      source_field: "shirt_size",
      label: "Shirt size",
      type: "select",
      options: ["S", "M", "L"],
    };
    vi.mocked(updateEventCustomField).mockResolvedValueOnce({ ...shirtField, type: "text", options: null });
    renderModal(shirtField);
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
});
