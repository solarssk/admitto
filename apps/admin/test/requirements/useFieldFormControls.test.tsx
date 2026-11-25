// @vitest-environment jsdom
import { useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { EventCustomFieldDto } from "../../src/api/types.js";
import { deferred } from "../test-utils.js";

const reorderEventCustomFields = vi.fn();
const updateEventCustomField = vi.fn();
const addToast = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  reorderEventCustomFields: (...args: unknown[]) => reorderEventCustomFields(...args),
  updateEventCustomField: (...args: unknown[]) => updateEventCustomField(...args),
}));

vi.mock("@admitto/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@admitto/ui")>()),
  useToast: () => ({ addToast }),
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

const a = field("a", "A", 0);
const b = field("b", "B", 1);
const c = field("c", "C", 2);

beforeEach(() => {
  reorderEventCustomFields.mockReset();
  updateEventCustomField.mockReset();
  addToast.mockReset();
});

/** The hook on a list that a host keeps, as the Fields tab does: what `onUpdated` is told to change is applied. */
function renderOnHost(initial: EventCustomFieldDto[]) {
  const onChanged = vi.fn();
  const view = renderHook(() => {
    const [fields, setFields] = useState(initial);
    const form = useFieldFormControls({ eventId: "evt-1", fields, onChanged, onUpdated: setFields, rootRef: { current: null } });
    return { fields, form };
  });
  const ids = () => view.result.current.fields.map((row) => row.id);
  const press = (index: number, direction: "up" | "down") =>
    act(() => {
      void view.result.current.form.move(index, direction);
    });
  return { ...view, ids, press, onChanged };
}

describe("useFieldFormControls: the answer of a move", () => {
  /** Starts a move of the first field down on [A, B, C], answers it with `answer`, and gives the changes the host is told to make. */
  async function answeredMove(answer: EventCustomFieldDto[]): Promise<{ optimistic: FieldsChange; answered: FieldsChange }> {
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
    expect(onUpdated).toHaveBeenCalledTimes(2);
    return { optimistic: onUpdated.mock.calls[0]![0] as FieldsChange, answered: onUpdated.mock.calls[1]![0] as FieldsChange };
  }

  const answerAfterMove = [field("b", "B", 0), field("a", "A", 1), field("c", "C", 2)];

  it("puts the new order on the rows the host has", async () => {
    const { answered } = await answeredMove(answerAfterMove);

    const shown = answered([field("a", "A", 0), field("b", "B", 1), field("c", "C", 2)]);

    expect(shown.map((row) => row.id)).toEqual(["b", "a", "c"]);
    expect(shown.map((row) => row.display_order)).toEqual([0, 1, 2]);
  });

  it("does not undo a field edited while the move was on its way", async () => {
    const { answered } = await answeredMove(answerAfterMove);

    const shown = answered([field("a", "A", 0), { ...field("b", "B edited meanwhile", 1), required: true }, field("c", "C", 2)]);

    expect(shown.map((row) => row.label)).toEqual(["B edited meanwhile", "A", "C"]);
    expect(shown[0]!.required).toBe(true);
  });

  it("does not bring back a field deleted while the move was on its way", async () => {
    const { answered } = await answeredMove(answerAfterMove);

    const shown = answered([field("a", "A", 0), field("c", "C", 1)]);

    expect(shown.map((row) => row.id)).toEqual(["a", "c"]);
  });

  it("puts a field added while the move was on its way last", async () => {
    const { answered } = await answeredMove(answerAfterMove);

    const shown = answered([field("a", "A", 0), field("b", "B", 1), field("d", "D added meanwhile", 2), field("c", "C", 3)]);

    expect(shown.map((row) => row.id)).toEqual(["b", "a", "c", "d"]);
  });

  it("shows the move before the answer, with the places the server will give, and a field added since goes last", async () => {
    const { optimistic } = await answeredMove(answerAfterMove);

    const shown = optimistic([field("a", "A", 0), field("b", "B", 1), field("d", "D added meanwhile", null), field("c", "C", 2)]);

    expect(shown.map((row) => row.id)).toEqual(["b", "a", "c", "d"]);
    expect(shown.map((row) => row.display_order)).toEqual([0, 1, 2, 3]);
  });

  it("shows the move before the answer without a field that was deleted since", async () => {
    const { optimistic } = await answeredMove(answerAfterMove);

    const shown = optimistic([field("a", "A", 0), field("c", "C", 1)]);

    expect(shown.map((row) => row.id)).toEqual(["a", "c"]);
    expect(shown.map((row) => row.display_order)).toEqual([0, 1]);
  });
});

describe("useFieldFormControls: a move on the screen", () => {
  it("shows the new order at once, before the server has answered, and asks the server for it", async () => {
    const request = deferred<EventCustomFieldDto[]>();
    reorderEventCustomFields.mockReturnValueOnce(request.promise);
    const { result, ids, press } = renderOnHost([a, b, c]);

    press(0, "down");

    expect(ids()).toEqual(["b", "a", "c"]);
    expect(result.current.fields.map((row) => row.display_order)).toEqual([0, 1, 2]);
    expect(reorderEventCustomFields).toHaveBeenCalledWith("evt-1", ["b", "a", "c"]);
    expect(result.current.form.moving.has("a:down")).toBe(true);
    await act(async () => request.resolve([field("b", "B", 0), field("a", "A", 1), field("c", "C", 2)]));
    expect(result.current.form.moving.size).toBe(0);
  });

  it("sends a second move after the first has been answered, made from the order the first put on the screen", async () => {
    const first = deferred<EventCustomFieldDto[]>();
    const second = deferred<EventCustomFieldDto[]>();
    reorderEventCustomFields.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { ids, press } = renderOnHost([a, b, c]);

    press(0, "down");
    press(2, "up");

    expect(ids()).toEqual(["b", "c", "a"]);
    // The second waits for the first: a reorder sends the whole list, and two out together could put each other back.
    expect(reorderEventCustomFields).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve([field("b", "B", 0), field("a", "A", 1), field("c", "C", 2)]));
    expect(reorderEventCustomFields).toHaveBeenCalledTimes(2);
    expect(reorderEventCustomFields).toHaveBeenNthCalledWith(2, "evt-1", ["b", "c", "a"]);
    // The answer of the first is not shown while the second is out: it would put a back above c.
    expect(ids()).toEqual(["b", "c", "a"]);
    await act(async () => second.resolve([field("b", "B", 0), field("c", "C", 1), field("a", "A", 2)]));
    expect(ids()).toEqual(["b", "c", "a"]);
  });

  it("lets the same arrow through once at a time, and a second arrow while the first is out", async () => {
    const first = deferred<EventCustomFieldDto[]>();
    reorderEventCustomFields.mockReturnValueOnce(first.promise).mockResolvedValue([]);
    const { result, press } = renderOnHost([a, b, c]);

    press(0, "down");
    expect(result.current.form.moving.has("a:down")).toBe(true);
    // a is now second; its Down arrow is the one that is busy.
    press(1, "down");
    expect(reorderEventCustomFields).toHaveBeenCalledTimes(1);
    press(0, "down");
    await act(async () => first.resolve([]));

    expect(reorderEventCustomFields).toHaveBeenCalledTimes(2);
  });

  it("drops the moves queued behind a refused one, says so, and reads the list again", async () => {
    const first = deferred<EventCustomFieldDto[]>();
    reorderEventCustomFields.mockReturnValueOnce(first.promise);
    const { press, onChanged } = renderOnHost([a, b, c]);

    press(0, "down");
    press(2, "up");
    await act(async () => first.reject(new ApiError(500, "SELECT secret FROM x", "")));

    // The second move was made from the order that the first had put on the screen; the list is read again instead.
    expect(reorderEventCustomFields).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledWith("Failed to move the field.", "error");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("sends a move made after a refused one, which starts from what the list has been read as", async () => {
    reorderEventCustomFields.mockRejectedValueOnce(new ApiError(500, "x", "")).mockResolvedValueOnce([]);
    const { press } = renderOnHost([a, b, c]);

    press(0, "down");
    await act(async () => undefined);
    press(1, "down");
    await act(async () => undefined);

    expect(reorderEventCustomFields).toHaveBeenCalledTimes(2);
  });

  it("tells a move that the list is out of date by its own words, and reads the list again", async () => {
    reorderEventCustomFields.mockRejectedValueOnce(new ApiError(409, "stale_write", "stale_write"));
    const { press, onChanged } = renderOnHost([a, b, c]);

    press(0, "down");
    await act(async () => undefined);

    expect(addToast).toHaveBeenCalledWith(expect.stringMatching(/so it was refreshed\. Move the field again\./), "warning");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("goes on with the request queued behind a move whose handling throws", async () => {
    const first = deferred<EventCustomFieldDto[]>();
    reorderEventCustomFields.mockReturnValueOnce(first.promise);
    updateEventCustomField.mockResolvedValueOnce({ ...a, show_on_form: true });
    const onChanged = vi.fn().mockImplementationOnce(() => {
      throw new Error("the host failed");
    });
    const { result } = renderHook(() => {
      const [fields, setFields] = useState([a, b, c]);
      return { fields, form: useFieldFormControls({ eventId: "evt-1", fields, onChanged, onUpdated: setFields, rootRef: { current: null } }) };
    });
    let moved!: Promise<void>;
    act(() => {
      moved = result.current.form.move(0, "down");
    });
    act(() => {
      void result.current.form.toggleOnForm(result.current.fields[1]!);
    });
    expect(updateEventCustomField).not.toHaveBeenCalled();

    await act(async () => {
      first.reject(new ApiError(500, "x", ""));
      await moved.catch(() => undefined);
    });

    // The move was refused and the host failed while it was told; the line did not stop, so the switch behind it went.
    expect(updateEventCustomField).toHaveBeenCalledTimes(1);
    expect(updateEventCustomField).toHaveBeenCalledWith("evt-1", "a", { show_on_form: true });
  });

  it("does not move a field past the end of the list", () => {
    const { press } = renderOnHost([a, b, c]);

    press(0, "up");
    press(2, "down");

    expect(reorderEventCustomFields).not.toHaveBeenCalled();
  });
});

describe("useFieldFormControls: a switch and a move together", () => {
  it("lets a switch pressed during a move wait for it, busy on its own row and no other, and keeps the place of its row", async () => {
    const move = deferred<EventCustomFieldDto[]>();
    reorderEventCustomFields.mockReturnValueOnce(move.promise);
    // The answer of the switch carries the place its row had before the move.
    updateEventCustomField.mockResolvedValueOnce({ ...field("b", "B", 9), show_on_form: true });
    const { result, ids, press } = renderOnHost([a, b, c]);

    press(0, "down");
    act(() => {
      void result.current.form.toggleOnForm(result.current.fields[0]!);
    });

    expect(ids()).toEqual(["b", "a", "c"]);
    expect([...result.current.form.switching]).toEqual(["b"]);
    expect(updateEventCustomField).not.toHaveBeenCalled();
    await act(async () => move.resolve([field("b", "B", 0), field("a", "A", 1), field("c", "C", 2)]));

    expect(updateEventCustomField).toHaveBeenCalledWith("evt-1", "b", { show_on_form: true });
    expect(result.current.form.switching.size).toBe(0);
    expect(result.current.fields.map((row) => [row.id, row.display_order, row.show_on_form])).toEqual([
      ["b", 0, true],
      ["a", 1, false],
      ["c", 2, false],
    ]);
    expect(addToast).toHaveBeenCalledWith("Added to the form", "success");
  });

  it("shows a move pressed during a switch at once, and sends it when the switch has landed", async () => {
    const toggle = deferred<EventCustomFieldDto>();
    updateEventCustomField.mockReturnValueOnce(toggle.promise);
    reorderEventCustomFields.mockResolvedValueOnce([field("b", "B", 0), field("a", "A", 1), field("c", "C", 2)]);
    const { result, ids, press } = renderOnHost([a, b, c]);

    act(() => {
      void result.current.form.toggleOnForm(a);
    });
    press(0, "down");

    expect(ids()).toEqual(["b", "a", "c"]);
    expect(reorderEventCustomFields).not.toHaveBeenCalled();
    await act(async () => toggle.resolve({ ...a, show_on_form: true }));
    expect(reorderEventCustomFields).toHaveBeenCalledWith("evt-1", ["b", "a", "c"]);
    expect(ids()).toEqual(["b", "a", "c"]);
    expect(result.current.fields.find((row) => row.id === "a")?.show_on_form).toBe(true);
  });

  it("goes on with the next request when one in the line fails", async () => {
    updateEventCustomField.mockRejectedValueOnce(new ApiError(500, "x", ""));
    reorderEventCustomFields.mockResolvedValueOnce([field("b", "B", 0), field("a", "A", 1), field("c", "C", 2)]);
    const { result, press } = renderOnHost([a, b, c]);

    act(() => {
      void result.current.form.toggleOnForm(a);
    });
    press(0, "down");
    await act(async () => undefined);

    expect(addToast).toHaveBeenCalledWith("Failed to update the field.", "error");
    expect(reorderEventCustomFields).toHaveBeenCalledTimes(1);
  });
});
