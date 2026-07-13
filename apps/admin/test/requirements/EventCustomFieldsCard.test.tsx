// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { EventCustomFieldDto, EventDto } from "../../src/api/types.js";
import { EventCustomFieldsCard } from "../../src/requirements/EventCustomFieldsCard.js";
import { renderWithToast } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    deleteEventCustomField: vi.fn(),
    createEventCustomField: vi.fn(),
    updateEventCustomField: vi.fn(),
  };
});

import { deleteEventCustomField } from "../../src/api/client.js";

const addToast = vi.fn();
vi.mock("@admitto/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/ui")>();
  return { ...actual, useToast: () => ({ addToast }) };
});

const event: EventDto = { id: "evt-1", title: "Demo", archived_at: null } as EventDto;

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

function renderCard(fields: EventCustomFieldDto[], loading = false) {
  const onChanged = vi.fn();
  renderWithToast(
    <EventCustomFieldsCard
      eventId="evt-1"
      event={event}
      fields={fields}
      loading={loading}
      onChanged={onChanged}
    />,
  );
  return { onChanged };
}

describe("EventCustomFieldsCard", () => {
  it("shows an empty-state row when there are no fields", () => {
    renderCard([]);
    expect(screen.getByText(/No custom fields yet\./)).toBeTruthy();
  });

  it("lists fields with their type and required status", () => {
    renderCard([dietaryField, { ...dietaryField, id: "f2", source_field: "shirt_size", label: "Shirt size", required: true }]);
    expect(screen.getByText("Dietary requirements")).toBeTruthy();
    expect(screen.getByText("dietary")).toBeTruthy();
    expect(screen.getByText("Shirt size")).toBeTruthy();
  });

  it("opens the add-field modal", () => {
    renderCard([]);
    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    expect(screen.getByRole("heading", { name: "Add custom field" })).toBeTruthy();
  });

  it("opens the edit modal pre-filled for an existing field", () => {
    renderCard([dietaryField]);
    fireEvent.click(screen.getByRole("button", { name: "Edit field" }));
    expect(screen.getByRole("heading", { name: "Edit custom field" })).toBeTruthy();
    expect(screen.getByLabelText("Display label")).toHaveProperty("value", "Dietary requirements");
  });

  it("deletes a field after confirmation", async () => {
    vi.mocked(deleteEventCustomField).mockResolvedValueOnce(undefined);
    const { onChanged } = renderCard([dietaryField]);
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
    renderCard([dietaryField]);
    fireEvent.click(screen.getByRole("button", { name: "Delete field" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        expect.stringMatching(/used as a hint on an item/),
        "warning",
      );
    });
  });
});
