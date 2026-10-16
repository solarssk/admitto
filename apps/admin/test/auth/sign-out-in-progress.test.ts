import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSignOutInProgress,
  isSignOutInProgress,
  markSignOutInProgress,
} from "../../src/auth/sign-out-in-progress.js";
import { LOAD_TIMEOUT_MS } from "../../src/utils/loading-timing.js";

describe("sign out in progress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearSignOutInProgress();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearSignOutInProgress();
  });

  it("is off until a Sign out is marked", () => {
    expect(isSignOutInProgress()).toBe(false);
  });

  it("is on from the mark until it is cleared", () => {
    markSignOutInProgress();
    expect(isSignOutInProgress()).toBe(true);

    clearSignOutInProgress();
    expect(isSignOutInProgress()).toBe(false);
  });

  it("goes off by itself after the longest a request is waited for, so a page that stayed goes back to the sign-in page when its session is gone", () => {
    markSignOutInProgress();

    vi.advanceTimersByTime(LOAD_TIMEOUT_MS - 1);
    expect(isSignOutInProgress()).toBe(true);

    vi.advanceTimersByTime(1);
    expect(isSignOutInProgress()).toBe(false);
  });

  it("starts the wait again when it is marked again, once the server's answer is in", () => {
    markSignOutInProgress();
    vi.advanceTimersByTime(LOAD_TIMEOUT_MS - 1000);

    markSignOutInProgress();
    vi.advanceTimersByTime(LOAD_TIMEOUT_MS - 1);

    expect(isSignOutInProgress()).toBe(true);
  });
});
