import { describe, expect, it } from "vitest";
import {
  reconcileWalletPassLifecycle,
  type ReconcileWalletPassLifecycleInput,
} from "../src/reconcile-lifecycle.js";

const OBSERVED_AT = new Date("2026-09-24T18:00:00.000Z");
const WINDOW_MS = 10 * 60 * 1000;

function input(overrides: Partial<ReconcileWalletPassLifecycleInput> = {}): ReconcileWalletPassLifecycleInput {
  return {
    current: { status: "active", provider_commanded_at: null, provider_removed_at: null },
    validity: { voided: true, expirationRaw: null, expiresAt: null },
    observedAt: OBSERVED_AT,
    policy: { observationStalenessWindowMs: WINDOW_MS },
    providerTimeZone: null,
    ...overrides,
  };
}

describe("reconcileWalletPassLifecycle", () => {
  describe("what an observation may change", () => {
    it("moves an active pass the provider reports voided to voided", () => {
      expect(reconcileWalletPassLifecycle(input())).toBe("voided");
    });

    it("leaves an active pass alone when the provider reports it not voided", () => {
      expect(reconcileWalletPassLifecycle(input({ validity: { voided: false, expirationRaw: null, expiresAt: null } }))).toBeNull();
    });

    it("leaves an active pass alone when the provider did not report a voided flag - a missing field is not 'not voided', and not 'voided' either", () => {
      expect(reconcileWalletPassLifecycle(input({ validity: { voided: null, expirationRaw: null, expiresAt: null } }))).toBeNull();
    });

    it.each(["voided", "expired", "pending", "failed"])(
      "never changes a %s pass: observation only ever moves an active pass forward",
      (status) => {
        const current = { status, provider_commanded_at: null, provider_removed_at: null };
        expect(reconcileWalletPassLifecycle(input({ current }))).toBeNull();
        // Not even back to active on a clean read: that is the explicit Restore action's job.
        expect(
          reconcileWalletPassLifecycle(
            input({ current, validity: { voided: false, expirationRaw: null, expiresAt: null } }),
          ),
        ).toBeNull();
      },
    );

    it("never changes a pass whose remote resource was deleted", () => {
      const current = { status: "active", provider_commanded_at: null, provider_removed_at: new Date("2026-09-20T10:00:00.000Z") };
      expect(reconcileWalletPassLifecycle(input({ current }))).toBeNull();
    });
  });

  describe("read-after-write staleness (provider_commanded_at)", () => {
    const commandedAt = (msBeforeObservation: number) => new Date(OBSERVED_AT.getTime() - msBeforeObservation);

    it("ignores a 'voided' read taken inside the window after Admitto's own command - a Restore must not be undone by the provider's stale view", () => {
      const current = { status: "active", provider_commanded_at: commandedAt(WINDOW_MS - 1), provider_removed_at: null };
      expect(reconcileWalletPassLifecycle(input({ current }))).toBeNull();
    });

    it("trusts the read once the window has passed", () => {
      const current = { status: "active", provider_commanded_at: commandedAt(WINDOW_MS), provider_removed_at: null };
      expect(reconcileWalletPassLifecycle(input({ current }))).toBe("voided");
    });

    it("ignores a read that was taken before the command it would otherwise contradict", () => {
      const current = { status: "active", provider_commanded_at: commandedAt(-5_000), provider_removed_at: null };
      expect(reconcileWalletPassLifecycle(input({ current }))).toBeNull();
    });

    it("has no window for a provider with strongly consistent reads (0 ms)", () => {
      const current = { status: "active", provider_commanded_at: commandedAt(1), provider_removed_at: null };
      expect(reconcileWalletPassLifecycle(input({ current, policy: { observationStalenessWindowMs: 0 } }))).toBe("voided");
    });
  });

  describe("voided vs expired (PassCreator reports both as voided)", () => {
    it("reads voided as expired when the provider's own offset-carrying expiration is already past", () => {
      const validity = {
        voided: true,
        expirationRaw: "2026-09-24T17:00:00+00:00",
        expiresAt: new Date("2026-09-24T17:00:00.000Z"),
      };
      expect(reconcileWalletPassLifecycle(input({ validity }))).toBe("expired");
    });

    it("keeps it voided when the provider's expiration is still in the future - an explicit void", () => {
      const validity = { voided: true, expirationRaw: null, expiresAt: new Date("2026-09-24T19:00:00.000Z") };
      expect(reconcileWalletPassLifecycle(input({ validity }))).toBe("voided");
    });

    it("never guesses expired from a naive wall-clock expiration when no provider time zone is configured", () => {
      const validity = { voided: true, expirationRaw: "2026-09-24 10:00", expiresAt: null };
      expect(reconcileWalletPassLifecycle(input({ validity, providerTimeZone: null }))).toBe("voided");
    });

    it("reads a naive expiration in the configured provider time zone", () => {
      // 19:00 in Warsaw (UTC+2 in September) is 17:00Z: already past at 18:00Z.
      const past = { voided: true, expirationRaw: "2026-09-24 19:00", expiresAt: null };
      expect(reconcileWalletPassLifecycle(input({ validity: past, providerTimeZone: "Europe/Warsaw" }))).toBe("expired");
      // 21:00 in Warsaw is 19:00Z: still ahead. The same digits read as UTC would already be past,
      // which is exactly the wrong answer this zone handling exists to avoid.
      const future = { voided: true, expirationRaw: "2026-09-24 21:00", expiresAt: null };
      expect(reconcileWalletPassLifecycle(input({ validity: future, providerTimeZone: "Europe/Warsaw" }))).toBe("voided");
    });

    it("accepts seconds in the naive expiration", () => {
      const validity = { voided: true, expirationRaw: "2026-09-24 19:00:00", expiresAt: null };
      expect(reconcileWalletPassLifecycle(input({ validity, providerTimeZone: "Europe/Warsaw" }))).toBe("expired");
    });

    it.each([
      ["a value that is not a wall-clock timestamp", "tomorrow"],
      ["an impossible calendar date", "2026-02-30 10:00"],
      ["an impossible hour", "2026-09-24 25:00"],
      ["a date with no time", "2026-09-24"],
      ["non-numeric seconds", "2026-09-24 19:00:xx"],
      ["trailing text after the time", "2026-09-24 19:00 UTC"],
      ["a truncated time", "2026-09-24 19:0"],
    ])("falls back to voided for %s", (_label, raw) => {
      const validity = { voided: true, expirationRaw: raw, expiresAt: null };
      expect(reconcileWalletPassLifecycle(input({ validity, providerTimeZone: "Europe/Warsaw" }))).toBe("voided");
    });

    it("falls back to voided for a time zone Intl does not know, instead of throwing", () => {
      const validity = { voided: true, expirationRaw: "2026-09-24 10:00", expiresAt: null };
      expect(reconcileWalletPassLifecycle(input({ validity, providerTimeZone: "Not/AZone" }))).toBe("voided");
    });

    it("prefers the adapter-parsed instant over re-reading the raw value", () => {
      // The raw digits alone would be past in any zone; the parsed instant says future.
      const validity = {
        voided: true,
        expirationRaw: "2026-09-24 10:00",
        expiresAt: new Date("2026-09-24T19:00:00.000Z"),
      };
      expect(reconcileWalletPassLifecycle(input({ validity, providerTimeZone: "Europe/Warsaw" }))).toBe("voided");
    });
  });
});
