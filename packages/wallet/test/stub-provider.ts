import type { WalletPassInput, WalletPassProvider, WalletPassResult } from "../src/index.js";
import { walletSnapshot } from "./snapshot-fixture.js";

/** In-memory stub for compiling/testing the WalletPassProvider contract. Not a real provider:
 * reads reflect writes immediately (no staleness window) and it can do everything. */
export function createStubWalletProvider(): WalletPassProvider {
  const passes = new Map<string, WalletPassResult>();

  function toResult(providerPassId: string, input: WalletPassInput): WalletPassResult {
    return {
      providerPassId,
      appleUrl: `https://example.test/apple/${input.userProvidedId}`,
      androidUrl: `https://example.test/android/${input.userProvidedId}`,
    };
  }

  return {
    provider: "stub",
    capabilities: {
      lifecycleObservation: true,
      expiration: true,
      voidRestore: true,
      registrationSnapshot: true,
      remoteDelete: true,
    },
    consistencyPolicy: { observationStalenessWindowMs: 0 },
    async createPass(input) {
      const result = toResult(`stub-${input.userProvidedId}`, input);
      passes.set(input.userProvidedId, result);
      return result;
    },
    async updatePass(providerPassId, input) {
      const result = toResult(providerPassId, input);
      passes.set(input.userProvidedId, result);
      return result;
    },
    async sendPushMessage() {},
    async voidPass() {},
    async restorePass() {},
    async deletePass(providerPassId) {
      for (const [userProvidedId, result] of passes) {
        if (result.providerPassId === providerPassId) passes.delete(userProvidedId);
      }
    },
    async findByUserProvidedId(userProvidedId) {
      return passes.get(userProvidedId) ?? null;
    },
    async getPassSnapshot(ref) {
      if (!ref.userProvidedId || !passes.has(ref.userProvidedId)) return null;
      return walletSnapshot();
    },
  };
}
