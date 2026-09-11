// @vitest-environment jsdom
import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fetchEventAttendees, fetchEventCustomFields, renderPage } from "./attendeesPageSetup.js";
import type { EventCustomFieldDto } from "../../src/api/types.js";

function textField(sourceField: string, label: string): EventCustomFieldDto {
  return {
    id: sourceField,
    source_field: sourceField,
    label,
    description: null,
    type: "text",
    required: false,
    options: null,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("AttendeesPage custom-field text filter debounce", () => {
  it("debounces two text custom fields independently - typing in one does not reset the other's timer", async () => {
    fetchEventCustomFields.mockResolvedValue([
      textField("dietary", "Dietary requirements"),
      textField("shirt_notes", "Shirt notes"),
    ]);
    fetchEventAttendees.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 });

    vi.useFakeTimers();
    try {
      renderPage();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      fetchEventAttendees.mockClear();

      fireEvent.click(screen.getByRole("button", { name: "Filters" }));
      const dietaryInput = screen.getByLabelText("Dietary requirements");
      const shirtInput = screen.getByLabelText("Shirt notes");

      fireEvent.change(dietaryInput, { target: { value: "vegan" } });
      // Just under DEBOUNCE_MS (300ms) - dietary's timer is still pending.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      fireEvent.change(shirtInput, { target: { value: "xl" } });
      // 200ms more: 400ms since "vegan" was typed (past its own debounce), only 200ms since
      // "xl" was typed (not yet past its own). The bug this guards against re-armed dietary's
      // timer to fire 300ms after *this* keystroke instead, delaying it to 500ms total.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });

      expect(fetchEventAttendees).toHaveBeenCalledWith(
        "evt-1",
        expect.objectContaining({ customFieldParams: { cf_dietary: ["vegan"] } }),
        expect.anything(),
      );
      expect(fetchEventAttendees).not.toHaveBeenCalledWith(
        "evt-1",
        expect.objectContaining({ customFieldParams: expect.objectContaining({ cf_shirt_notes: ["xl"] }) }),
        expect.anything(),
      );

      // shirt_notes' own debounce fires on schedule, unaffected by dietary's earlier commit.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(fetchEventAttendees).toHaveBeenCalledWith(
        "evt-1",
        expect.objectContaining({ customFieldParams: { cf_dietary: ["vegan"], cf_shirt_notes: ["xl"] } }),
        expect.anything(),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
