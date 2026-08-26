// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCameraTorch } from "../../src/checkin/cameraTorch.js";

function mockTrack(options: { torch?: boolean; applyConstraints?: () => Promise<void> } = {}) {
  return {
    getCapabilities: vi.fn(() => (options.torch === undefined ? {} : { torch: options.torch })),
    applyConstraints: vi.fn(options.applyConstraints ?? (() => Promise.resolve())),
  } as unknown as MediaStreamTrack;
}

describe("useCameraTorch", () => {
  it("starts unsupported and off before any track is reported", () => {
    const { result } = renderHook(() => useCameraTorch());
    expect(result.current.torchSupported).toBe(false);
    expect(result.current.torchOn).toBe(false);
  });

  it("reports supported once a track advertises the torch capability", () => {
    const { result } = renderHook(() => useCameraTorch());
    const track = mockTrack({ torch: true });

    act(() => result.current.onTrackChange(track));

    expect(result.current.torchSupported).toBe(true);
  });

  it("stays unsupported for a track that doesn't advertise torch (most laptops, all of iOS)", () => {
    const { result } = renderHook(() => useCameraTorch());
    const track = mockTrack({});

    act(() => result.current.onTrackChange(track));

    expect(result.current.torchSupported).toBe(false);
  });

  it("resets to unsupported and off when the track goes away (camera disabled/torn down)", () => {
    const { result } = renderHook(() => useCameraTorch());
    act(() => result.current.onTrackChange(mockTrack({ torch: true })));
    expect(result.current.torchSupported).toBe(true);

    act(() => result.current.onTrackChange(null));

    expect(result.current.torchSupported).toBe(false);
    expect(result.current.torchOn).toBe(false);
  });

  it("resets torchOn to false whenever the track changes, even if the previous one was on", async () => {
    const { result } = renderHook(() => useCameraTorch());
    const first = mockTrack({ torch: true });
    act(() => result.current.onTrackChange(first));

    await act(async () => {
      result.current.toggleTorch();
      await Promise.resolve();
    });
    expect(result.current.torchOn).toBe(true);

    // A fresh getUserMedia call (e.g. camera restarted) always starts with
    // torch off, regardless of what the previous track's state was.
    act(() => result.current.onTrackChange(mockTrack({ torch: true })));
    expect(result.current.torchOn).toBe(false);
  });

  it("toggleTorch is a no-op without a track", () => {
    const { result } = renderHook(() => useCameraTorch());
    expect(() => act(() => result.current.toggleTorch())).not.toThrow();
    expect(result.current.torchOn).toBe(false);
  });

  it("applies the torch constraint and flips torchOn on success, then flips back off", async () => {
    const track = mockTrack({ torch: true });
    const { result } = renderHook(() => useCameraTorch());
    act(() => result.current.onTrackChange(track));

    await act(async () => {
      result.current.toggleTorch();
      await Promise.resolve();
    });
    expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
    expect(result.current.torchOn).toBe(true);

    await act(async () => {
      result.current.toggleTorch();
      await Promise.resolve();
    });
    expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: false }] });
    expect(result.current.torchOn).toBe(false);
  });

  it("leaves torchOn unchanged when applyConstraints rejects (capability lied, or a mid-session driver failure)", async () => {
    const track = mockTrack({
      torch: true,
      applyConstraints: () => Promise.reject(new Error("driver failure")),
    });
    const { result } = renderHook(() => useCameraTorch());
    act(() => result.current.onTrackChange(track));

    await act(async () => {
      result.current.toggleTorch();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.torchOn).toBe(false);
  });
});
