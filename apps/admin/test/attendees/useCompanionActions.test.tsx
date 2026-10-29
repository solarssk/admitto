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
    onChanged: vi.fn(),
    onArchived: vi.fn(),
    onOutOfDate: vi.fn(),
    ...overrides,
  };
  return { input, hook: renderHook(() => useCompanionActions(input)) };
}

describe("a request that finds the page out of date", () => {
  it.each([
    ["attendee_erased", 409],
    ["companion_not_found", 404],
  ])("from the Edit dialog (%s): closes both dialogs, says so in a toast, and tells the page", async (code, status) => {
    updateAttendeeCompanion.mockRejectedValueOnce(new ApiError(status, code));
    const { input, hook } = setup();
    act(() => hook.result.current.edit.show());
    expect(hook.result.current.edit.open).toBe(true);

    await act(async () => hook.result.current.edit.save(FORM));

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

    await act(async () => hook.result.current.removal.confirm());

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

    await act(async () => pending.resolve(DETAIL));
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

    await act(async () => pending.resolve(DETAIL));
    expect(hook.result.current.removal.open).toBe(false);
    act(() => hook.result.current.removal.show());
    act(() => hook.result.current.removal.cancel());
    expect(hook.result.current.removal.open).toBe(false);
  });

  it("hands the answer over with the attendee it was asked for", async () => {
    updateAttendeeCompanion.mockResolvedValueOnce(DETAIL);
    const { input, hook } = setup({ eventId: "evt-9", attendeeId: "att-9" });

    await act(async () => hook.result.current.edit.save(FORM));

    expect(input.onChanged).toHaveBeenCalledWith(DETAIL, { eventId: "evt-9", attendeeId: "att-9" });
  });
});
