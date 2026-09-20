// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttendeeDetailDto } from "../../src/api/types.js";
import { useActivityLog } from "../../src/attendees/useActivityLog.js";

const fetchAttendeeDetail = vi.fn();

vi.mock("../../src/api/client.js", () => ({
  fetchAttendeeDetail: (...args: unknown[]) => fetchAttendeeDetail(...args),
}));

function dto(page: number, size = 25, snapshot: string | null = "snap-1", total = 60): AttendeeDetailDto {
  return {
    action_log: [{ id: `entry-${page}` }],
    action_log_total: total,
    action_log_page: page,
    action_log_page_size: size,
    action_log_snapshot: snapshot,
  } as unknown as AttendeeDetailDto;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(initial = { eventId: "evt-1", attendeeId: "att-1" }) {
  const onError = vi.fn();
  const view = renderHook(
    (ids: { eventId: string; attendeeId: string }) => useActivityLog({ ...ids, onError }),
    { initialProps: initial },
  );
  act(() => view.result.current.reset(dto(1)));
  return { ...view, onError };
}

afterEach(() => {
  cleanup();
  fetchAttendeeDetail.mockReset();
});

describe("useActivityLog", () => {
  it("has no log until a detail seeds it", () => {
    const { result } = renderHook(() => useActivityLog({ eventId: "e", attendeeId: "a", onError: vi.fn() }));
    expect(result.current.log).toBeNull();
    expect(fetchAttendeeDetail).not.toHaveBeenCalled();
  });

  it("pages against the snapshot, and requests page 1 without one", async () => {
    fetchAttendeeDetail.mockResolvedValueOnce(dto(2));
    fetchAttendeeDetail.mockResolvedValueOnce(dto(1, 25, "snap-fresh"));
    const { result } = setup();

    await act(async () => result.current.goToPage(2));
    expect(fetchAttendeeDetail).toHaveBeenLastCalledWith("evt-1", "att-1", undefined, 1, 2, 25, "snap-1");
    expect(result.current.log?.action_log_page).toBe(2);

    await act(async () => result.current.goToPage(1));
    expect(fetchAttendeeDetail).toHaveBeenLastCalledWith("evt-1", "att-1", undefined, 1, 1, 25, undefined);
    expect(result.current.log?.action_log_snapshot).toBe("snap-fresh");
  });

  it("applies only the newest of two overlapping requests", async () => {
    const older = deferred<AttendeeDetailDto>();
    fetchAttendeeDetail.mockReturnValueOnce(older.promise);
    fetchAttendeeDetail.mockResolvedValueOnce(dto(3));
    const { result } = setup();

    act(() => result.current.goToPage(2));
    await act(async () => result.current.goToPage(3));
    await act(async () => older.resolve(dto(2)));

    expect(result.current.log?.action_log_page).toBe(3);
  });

  it("drops a request that a reset superseded, for success and failure alike", async () => {
    const pending = deferred<AttendeeDetailDto>();
    fetchAttendeeDetail.mockReturnValueOnce(pending.promise);
    const { result, onError } = setup();

    act(() => result.current.goToPage(2));
    act(() => result.current.reset(dto(1, 25, "snap-after-mutation")));
    await act(async () => pending.resolve(dto(2)));
    expect(result.current.log?.action_log_snapshot).toBe("snap-after-mutation");

    const failing = deferred<AttendeeDetailDto>();
    fetchAttendeeDetail.mockReturnValueOnce(failing.promise);
    act(() => result.current.goToPage(2));
    act(() => result.current.reset(dto(1)));
    await act(async () => failing.reject(new Error("boom")));
    expect(onError).not.toHaveBeenCalled();
  });

  it("drops a response that arrives after switching to another attendee", async () => {
    const pending = deferred<AttendeeDetailDto>();
    fetchAttendeeDetail.mockReturnValueOnce(pending.promise);
    const { result, rerender } = setup();

    act(() => result.current.goToPage(2));
    rerender({ eventId: "evt-2", attendeeId: "att-2" });
    act(() => result.current.reset(dto(1, 25, "snap-other")));
    await act(async () => pending.resolve(dto(2)));

    expect(result.current.log?.action_log_snapshot).toBe("snap-other");
  });

  it("keeps the chosen page size across resets and re-applies it", async () => {
    fetchAttendeeDetail.mockResolvedValue(dto(1, 50));
    const { result } = setup();

    act(() => result.current.setPageSize(50));
    await waitFor(() => expect(result.current.log?.action_log_page_size).toBe(50));
    expect(fetchAttendeeDetail).toHaveBeenCalledTimes(1);

    // A whole-detail response comes back at the server default; the choice is applied again.
    act(() => result.current.reset(dto(1, 25)));
    await waitFor(() => expect(fetchAttendeeDetail).toHaveBeenCalledTimes(2));
    expect(fetchAttendeeDetail).toHaveBeenLastCalledWith("evt-1", "att-1", undefined, 1, 1, 50, undefined);
    await waitFor(() => expect(result.current.log?.action_log_page_size).toBe(50));
  });

  it("falls back to the shown size on failure so choosing it again retries", async () => {
    fetchAttendeeDetail.mockRejectedValueOnce(new Error("boom"));
    fetchAttendeeDetail.mockResolvedValueOnce(dto(1, 50));
    const { result, onError } = setup();

    act(() => result.current.setPageSize(50));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(result.current.pageSize).toBe(25);

    act(() => result.current.setPageSize(50));
    await waitFor(() => expect(result.current.log?.action_log_page_size).toBe(50));
    expect(fetchAttendeeDetail).toHaveBeenCalledTimes(2);
  });

  it("follows the size a server actually returns instead of refetching in a loop", async () => {
    fetchAttendeeDetail.mockResolvedValue(dto(1, 25));
    const { result } = setup();

    act(() => result.current.setPageSize(50));
    await waitFor(() => expect(result.current.pageSize).toBe(25));
    await act(async () => {});
    expect(fetchAttendeeDetail).toHaveBeenCalledTimes(1);
  });

  it("ignores a log that reports no page size (old server or fixture)", () => {
    const { result } = renderHook(() => useActivityLog({ eventId: "e", attendeeId: "a", onError: vi.fn() }));
    act(() => result.current.reset({ action_log: [] } as unknown as AttendeeDetailDto));
    expect(fetchAttendeeDetail).not.toHaveBeenCalled();
  });
});
