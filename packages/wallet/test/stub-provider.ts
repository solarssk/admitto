import type { WalletPassInput, WalletPassProvider, WalletPassResult } from "../src/index.js";

/** In-memory stub for compiling/testing the WalletPassProvider contract. Not a real provider. */
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
    async getRegistrationStatus(userProvidedId) {
      if (!passes.has(userProvidedId)) return null;
      return {
        appleActiveRegistrations: 0,
        appleInactiveRegistrations: 0,
        googleActiveRegistrations: 0,
        googleInactiveRegistrations: 0,
        firstDownloadedAt: null,
      };
    },
  };
}
