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
    async findByUserProvidedId(userProvidedId) {
      return passes.get(userProvidedId) ?? null;
    },
  };
}
