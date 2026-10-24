// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventCustomFieldDto } from "../../src/api/types.js";
import { deferred } from "../test-utils.js";

const reorderEventCustomFields = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  reorderEventCustomFields: (...args: unknown[]) => reorderEventCustomFields(...args),
  updateEventCustomField: vi.fn(),
}));

vi.mock("@admitto/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@admitto/ui")>()),
  useToast: () => ({ addToast: vi.fn() }),
}));

import { useFieldFormControls, type FieldsChange } from "../../src/requirements/useFieldFormControls.js";

function field(id: string, label: string, displayOrder: number | null): EventCustomFieldDto {
  return {
    id,
    source_field: id,
    label,
    description: null,
    type: "text",
    required: false,
    show_on_form: false,
    display_order: displayOrder,
    options: null,
    rules: null,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("useFieldFormControls: the answer of a move", () => {
  beforeEach(() => {
    reorderEventCustomFields.mockReset();
  });

  /** Starts a move of the first field down on [A, B, C], answers it with `answer`, and gives the change the host is told to make. */
  async function answeredMove(answer: EventCustomFieldDto[]): Promise<FieldsChange> {
    const a = field("a", "A", 0);
    const b = field("b", "B", 1);
    const c = field("c", "C", 2);
    const request = deferred<EventCustomFieldDto[]>();
    reorderEventCustomFields.mockReturnValueOnce(request.promise);
    const onUpdated = vi.fn();
    const { result } = renderHook(() =>
      useFieldFormControls({ eventId: "evt-1", fields: [a, b, c], onChanged: vi.fn(), onUpdated, rootRef: { current: null } }),
    );
    let moved!: Promise<void>;
    act(() => {
      moved = result.current.move(0, "down");
    });
    expect(reorderEventCustomFields).toHaveBeenCalledWith("evt-1", ["b", "a", "c"]);
    request.resolve(answer);
    await act(async () => {
      await moved;
    });
    expect(onUpdated).toHaveBeenCalledTimes(1);
    return onUpdated.mock.calls[0]![0] as FieldsChange;
  }

  const answerAfterMove = [field("b", "B", 0), field("a", "A", 1), field("c", "C", 2)];

  it("puts the new order on the rows the host has", async () => {
    const change = await answeredMove(answerAfterMove);

    const shown = change([field("a", "A", 0), field("b", "B", 1), field("c", "C", 2)]);

    expect(shown.map((row) => row.id)).toEqual(["b", "a", "c"]);
    expect(shown.map((row) => row.display_order)).toEqual([0, 1, 2]);
  });

  it("does not undo a field edited while the move was on its way", async () => {
    const change = await answeredMove(answerAfterMove);

    const shown = change([field("a", "A", 0), { ...field("b", "B edited meanwhile", 1), required: true }, field("c", "C", 2)]);

    expect(shown.map((row) => row.label)).toEqual(["B edited meanwhile", "A", "C"]);
    expect(shown[0]!.required).toBe(true);
  });

  it("does not bring back a field deleted while the move was on its way", async () => {
    const change = await answeredMove(answerAfterMove);

    const shown = change([field("a", "A", 0), field("c", "C", 1)]);

    expect(shown.map((row) => row.id)).toEqual(["a", "c"]);
  });

  it("puts a field added while the move was on its way last", async () => {
    const change = await answeredMove(answerAfterMove);

    const shown = change([field("a", "A", 0), field("b", "B", 1), field("d", "D added meanwhile", 2), field("c", "C", 3)]);

    expect(shown.map((row) => row.id)).toEqual(["b", "a", "c", "d"]);
  });
});
