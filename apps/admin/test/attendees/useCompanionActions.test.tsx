// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { AttendeeDetailDto } from "../../src/api/types.js";
import type { CompanionFormState } from "../../src/attendees/companionForm.js";
import { useCompanionActions, type CompanionActionsInput } from "../../src/attendees/useCompanionActions.js";
import { deferred } from "../test-utils.js";
import { answerField } from "./answerTypeFixtures.js";

/**
 * What the dialogs of a guest's companion do with a request, apart from the page they sit on: which of them is open, what each is busy
 * with, and where a failure is said. The page around them is in AttendeeDetailPage.companion.test.tsx.
 */
const updateAttendeeCompanion = vi.fn();
const removeAttendeeCompanion = vi.fn();
const addToast = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  updateAttendeeCompanion: (...args: unknown[]) => updateAttendeeCompanion(...args),
  removeAttendeeCompanion: (...args: unknown[]) => removeAttendeeCompanion(...args),
}));
vi.mock("@admitto/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@admitto/ui")>()), useToast: () => ({ addToast }) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const FORM: CompanionFormState = { name: "Anna Companion", answers: {} };
const DETAIL = { id: "att-1" } as AttendeeDetailDto;

function setup(overrides: Partial<CompanionActionsInput> = {}) {
  const input: CompanionActionsInput = {
    eventId: "evt-1",
    attendeeId: "att-1",
    fields: [answerField("diet", "Diet", "text", { applies_to: "companion" })],
    onChanged: vi.fn(() => true),
    onArchived: vi.fn(),
    onOutOfDate: vi.fn(),
    ...overrides,
  };
  return { input, hook: renderHook(() => useCompanionActions(input)) };
}

describe("a request that is answered after the card is gone", () => {
  const pendingSave = (hook: ReturnType<typeof setup>["hook"]) => {
    let done!: Promise<void>;
    act(() => {
      done = hook.result.current.edit.save(FORM);
    });
    return done;
  };
  const pendingRemoval = (hook: ReturnType<typeof setup>["hook"]) => {
    let done!: Promise<void>;
    act(() => {
      done = hook.result.current.removal.confirm();
    });
    return done;
  };

  it("applies nothing of a save that worked, and says nothing", async () => {
    const answer = deferred<AttendeeDetailDto>();
    updateAttendeeCompanion.mockReturnValueOnce(answer.promise);
    const { input, hook } = setup();
    const done = pendingSave(hook);
    hook.unmount();

    await act(async () => {
      answer.resolve(DETAIL);
      await done;
    });

    expect(input.onChanged).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("says nothing of a save that failed", async () => {
    const answer = deferred<AttendeeDetailDto>();
    updateAttendeeCompanion.mockReturnValueOnce(answer.promise);
    const { input, hook } = setup();
    const done = pendingSave(hook);
    hook.unmount();

    await act(async () => {
      answer.reject(new ApiError(409, "attendee_erased"));
      await done;
    });

    expect(input.onOutOfDate).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("applies nothing of a removal that worked, and says nothing", async () => {
    const answer = deferred<AttendeeDetailDto>();
    removeAttendeeCompanion.mockReturnValueOnce(answer.promise);
    const { input, hook } = setup();
    const done = pendingRemoval(hook);
    hook.unmount();

    await act(async () => {
      answer.resolve(DETAIL);
      await done;
    });

    expect(input.onChanged).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("says nothing of a removal that failed", async () => {
    const answer = deferred<AttendeeDetailDto>();
    removeAttendeeCompanion.mockReturnValueOnce(answer.promise);
    const { input, hook } = setup();
    const done = pendingRemoval(hook);
    hook.unmount();

    await act(async () => {
      answer.reject(new ApiError(404, "companion_not_found"));
      await done;
    });

    expect(input.onOutOfDate).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
  });
});

describe("a request that finds the page out of date", () => {
  it.each([
    ["attendee_erased", 409],
    ["companion_not_found", 404],
  ])("from the Edit dialog (%s): closes both dialogs, says so in a toast, and tells the page", async (code, status) => {
    updateAttendeeCompanion.mockRejectedValueOnce(new ApiError(status, code));
    const { input, hook } = setup();
    act(() => hook.result.current.edit.show());
    expect(hook.result.current.edit.open).toBe(true);

    await act(() => hook.result.current.edit.save(FORM));

    expect(hook.result.current.edit.open).toBe(false);
    expect(hook.result.current.removal.open).toBe(false);
    expect(input.onOutOfDate).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledWith(expect.any(String), "warning");
    expect(hook.result.current.edit.error).toBeNull();
  });

  it.each([
    ["attendee_erased", 409],
    ["companion_not_found", 404],
  ])("from the Remove confirmation (%s): closes it, says so in a toast, and tells the page", async (code, status) => {
    removeAttendeeCompanion.mockRejectedValueOnce(new ApiError(status, code));
    const { input, hook } = setup();
    act(() => hook.result.current.removal.show());

    await act(() => hook.result.current.removal.confirm());

    expect(hook.result.current.removal.open).toBe(false);
    expect(input.onOutOfDate).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledWith(expect.any(String), "warning");
    expect(hook.result.current.removal.error).toBeNull();
  });
});

describe("a request that is on its way", () => {
  it("keeps the Edit dialog open when it is cancelled, and lets it close when it is not busy", async () => {
    const pending = deferred<AttendeeDetailDto>();
    updateAttendeeCompanion.mockReturnValueOnce(pending.promise);
    const { hook } = setup();
    act(() => hook.result.current.edit.show());

    act(() => {
      void hook.result.current.edit.save(FORM);
    });
    await waitFor(() => expect(hook.result.current.edit.saving).toBe(true));
    act(() => hook.result.current.edit.cancel());
    expect(hook.result.current.edit.open).toBe(true);

    await act(() => Promise.resolve(pending.resolve(DETAIL)));
    expect(hook.result.current.edit.open).toBe(false);
    act(() => hook.result.current.edit.show());
    act(() => hook.result.current.edit.cancel());
    expect(hook.result.current.edit.open).toBe(false);
  });

  it("keeps the Remove confirmation open when it is cancelled, and lets it close when it is not busy", async () => {
    const pending = deferred<AttendeeDetailDto>();
    removeAttendeeCompanion.mockReturnValueOnce(pending.promise);
    const { hook } = setup();
    act(() => hook.result.current.removal.show());

    act(() => {
      void hook.result.current.removal.confirm();
    });
    await waitFor(() => expect(hook.result.current.removal.busy).toBe(true));
    act(() => hook.result.current.removal.cancel());
    expect(hook.result.current.removal.open).toBe(true);

    await act(() => Promise.resolve(pending.resolve(DETAIL)));
    expect(hook.result.current.removal.open).toBe(false);
    act(() => hook.result.current.removal.show());
    act(() => hook.result.current.removal.cancel());
    expect(hook.result.current.removal.open).toBe(false);
  });

  it("hands the answer over with the attendee it was asked for", async () => {
    updateAttendeeCompanion.mockResolvedValueOnce(DETAIL);
    const { input, hook } = setup({ eventId: "evt-9", attendeeId: "att-9" });

    await act(() => hook.result.current.edit.save(FORM));

    expect(updateAttendeeCompanion).toHaveBeenCalledWith("evt-9", "att-9", expect.anything());
    expect(input.onChanged).toHaveBeenCalledWith(DETAIL, { eventId: "evt-9", attendeeId: "att-9" });
  });
});

describe("an answer that the page did not take", () => {
  // The page has moved on to another attendee in the moment before the card goes: the dialog closes, but the toast would be said on the wrong screen.
  it("closes the Edit dialog and says nothing", async () => {
    updateAttendeeCompanion.mockResolvedValueOnce(DETAIL);
    const { input, hook } = setup({ onChanged: vi.fn(() => false) });
    act(() => hook.result.current.edit.show());

    await act(() => hook.result.current.edit.save(FORM));

    expect(input.onChanged).toHaveBeenCalledTimes(1);
    expect(hook.result.current.edit.open).toBe(false);
    expect(addToast).not.toHaveBeenCalled();
  });

  it("closes the Remove confirmation and says nothing", async () => {
    removeAttendeeCompanion.mockResolvedValueOnce(DETAIL);
    const { input, hook } = setup({ onChanged: vi.fn(() => false) });
    act(() => hook.result.current.removal.show());

    await act(() => hook.result.current.removal.confirm());

    expect(input.onChanged).toHaveBeenCalledTimes(1);
    expect(hook.result.current.removal.open).toBe(false);
    expect(addToast).not.toHaveBeenCalled();
  });

  it("says the change was saved or removed when the page took the answer", async () => {
    updateAttendeeCompanion.mockResolvedValueOnce(DETAIL);
    removeAttendeeCompanion.mockResolvedValueOnce(DETAIL);
    const { hook } = setup();

    await act(() => hook.result.current.edit.save(FORM));
    await act(() => hook.result.current.removal.confirm());

    expect(addToast).toHaveBeenNthCalledWith(1, "Companion saved", "success");
    expect(addToast).toHaveBeenNthCalledWith(2, "Companion removed", "success");
  });
});
