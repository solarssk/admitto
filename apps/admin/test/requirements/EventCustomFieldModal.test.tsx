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
    expect(screen.queryByText("needs_parking")).toBeNull();
    fireEvent.change(screen.getByLabelText("Display label"), {
      target: { value: "Needs Parking" },
    });
    expect(screen.getByText("needs_parking")).toBeTruthy();
  });

  it("blocks save when the display label is empty", async () => {
    renderModal(null);
    fireEvent.click(screen.getByRole("button", { name: "Create field" }));
    await waitFor(() => {
      expect(screen.getByText("Enter a display label using letters or numbers.")).toBeTruthy();
    });
    expect(createEventCustomField).not.toHaveBeenCalled();
  });

  it("blocks save for a select field with no options", async () => {
    renderModal(null);
    fireEvent.change(screen.getByLabelText("Display label"), { target: { value: "Size" } });
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("button", { name: "Create field" }));
    await waitFor(() => {
      expect(screen.getByText("Select fields need at least one option.")).toBeTruthy();
    });
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
        type: "select",
        required: true,
        options: ["S", "M", "L"],
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
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(updateEventCustomField).toHaveBeenCalledWith("evt-1", "field-dietary", {
        label: "Dietary needs",
        type: "text",
        required: true,
        options: undefined,
      });
    });
  });
});
