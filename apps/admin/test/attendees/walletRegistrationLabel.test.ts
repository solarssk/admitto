import { describe, expect, it } from "vitest";
import { walletRegistrationLabel } from "../../src/attendees/walletRegistrationLabel.js";

describe("walletRegistrationLabel", () => {
  it("returns Status unknown when the worker has never checked", () => {
    expect(walletRegistrationLabel(null, null)).toBe("Status unknown");
  });

  it("returns Registered for a single active device", () => {
    expect(walletRegistrationLabel(1, 0)).toBe("Registered");
  });

  it("returns a device count for more than one active device", () => {
    expect(walletRegistrationLabel(3, 0)).toBe("Registered (3 devices)");
  });

  it("returns Unregistered when there are only inactive registrations", () => {
    expect(walletRegistrationLabel(0, 1)).toBe("Unregistered");
  });

  it("returns Not added when both counts are confirmed zero", () => {
    expect(walletRegistrationLabel(0, 0)).toBe("Not added");
  });

  it("prefers active over inactive when both are nonzero", () => {
    expect(walletRegistrationLabel(2, 5)).toBe("Registered (2 devices)");
  });

  it("treats a null active count as zero when inactive is a confirmed number", () => {
    expect(walletRegistrationLabel(null, 2)).toBe("Unregistered");
  });

  it("treats a null inactive count as zero when active is a confirmed number", () => {
    expect(walletRegistrationLabel(1, null)).toBe("Registered");
  });

  describe("for a pass removed at the provider (frozen last-known snapshot)", () => {
    it("says Was registered instead of Registered", () => {
      expect(walletRegistrationLabel(1, 0, true)).toBe("Was registered");
    });

    it("keeps the device count, worded as Was registered", () => {
      expect(walletRegistrationLabel(3, 0, true)).toBe("Was registered (3 devices)");
    });

    it("leaves every state that never claimed a live registration unchanged", () => {
      expect(walletRegistrationLabel(null, null, true)).toBe("Status unknown");
      expect(walletRegistrationLabel(0, 1, true)).toBe("Unregistered");
      expect(walletRegistrationLabel(0, 0, true)).toBe("Not added");
    });
  });
});
