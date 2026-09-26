import { describe, expect, it } from "vitest";
import {
  PASSCREATOR_CAPABILITIES,
  PASSCREATOR_CONSISTENCY_POLICY,
  walletProviderCapabilities,
} from "../src/capabilities.js";

describe("walletProviderCapabilities", () => {
  it("knows PassCreator, which can delete a remote pass", () => {
    expect(walletProviderCapabilities("passcreator")).toBe(PASSCREATOR_CAPABILITIES);
    expect(PASSCREATOR_CAPABILITIES.remoteDelete).toBe(true);
  });

  it("returns null for a provider this build doesn't know", () => {
    expect(walletProviderCapabilities("google")).toBeNull();
    expect(walletProviderCapabilities("")).toBeNull();
  });

  it("never resolves an inherited Object.prototype member as if it were a provider", () => {
    expect(walletProviderCapabilities("constructor")).toBeNull();
    expect(walletProviderCapabilities("__proto__")).toBeNull();
    expect(walletProviderCapabilities("toString")).toBeNull();
  });
});

describe("PASSCREATOR_CONSISTENCY_POLICY", () => {
  it("allows its read side a non-zero window to catch up with Admitto's own commands", () => {
    expect(PASSCREATOR_CONSISTENCY_POLICY.observationStalenessWindowMs).toBe(10 * 60 * 1000);
  });
});
