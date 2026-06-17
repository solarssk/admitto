import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { normalizeScannedInput, CHECKIN_DUPLICATE_DEBOUNCE_MS } from "../src/checkin/normalize.js";
import { canMutateCheckin } from "../src/checkin/connection.js";

describe("normalizeScannedInput", () => {
  it("strips trailing wedge suffixes", () => {
    expect(normalizeScannedInput("TOKEN-ABC\r\n")).toBe("TOKEN-ABC");
  });

  it("exports 300ms debounce constant", () => {
    expect(CHECKIN_DUPLICATE_DEBOUNCE_MS).toBe(300);
  });
});

describe("connection gate", () => {
  it("blocks mutations unless connected", () => {
    expect(canMutateCheckin("connected")).toBe(true);
    expect(canMutateCheckin("reconnecting")).toBe(false);
    expect(canMutateCheckin("offline")).toBe(false);
  });
});

describe("camera opt-in", () => {
  const getUserMedia = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    getUserMedia.mockReset();
  });

  it("does not call getUserMedia on module load", () => {
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
