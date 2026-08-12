import type { WalletPassInput, WalletPassResult } from "./types.js";

/**
 * Domain boundary for wallet pass delivery (ADR 0009). The rest of Admitto depends only on this
 * interface — never on a concrete provider (e.g. PassCreator, see ADR 0041).
 */
export interface WalletPassProvider {
  readonly provider: string;

  createPass(input: WalletPassInput): Promise<WalletPassResult>;
  updatePass(providerPassId: string, input: WalletPassInput): Promise<WalletPassResult>;
  voidPass(passUid: string): Promise<void>;
  restorePass(passUid: string): Promise<void>;
  findByUserProvidedId(userProvidedId: string): Promise<WalletPassResult | null>;
}
