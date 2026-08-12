import { PassCreatorClient, type WalletPassProvider } from "@admitto/wallet";
import { decryptFromString } from "@admitto/crypto";
import { resolvePassCreatorBaseUrl } from "./config.js";

/**
 * Both the API key and the pass template belong to the event (ADR 0041). Its own module (not a
 * createApp closure, and not defined inside app.ts) so admin routes and the attendee-erasure flow
 * can resolve the same provider without duplicating credential decryption/client construction -
 * attendees-api-routes.ts is imported by app.ts, so a definition living in app.ts itself would
 * make that import circular. `injectedProvider` mirrors createApp's own `options.walletPassProvider`
 * test escape hatch - pass it through explicitly at each call site.
 */
export function resolveWalletProvider(
  event: {
    walletEnabled: boolean;
    walletTemplateId: string | null;
    walletApiKeyEnc: string | null;
    walletFieldMapping: Record<string, string> | null;
  },
  injectedProvider?: WalletPassProvider,
): WalletPassProvider | null {
  if (injectedProvider) return injectedProvider;
  if (!event.walletEnabled) return null;
  const templateId = event.walletTemplateId;
  if (!templateId || !event.walletApiKeyEnc) return null;
  let apiKey: string;
  try {
    apiKey = decryptFromString(event.walletApiKeyEnc);
  } catch (err) {
    console.error("wallet API key decrypt failed:", err);
    return null;
  }
  return new PassCreatorClient({
    apiKey,
    templateId,
    baseUrl: resolvePassCreatorBaseUrl(),
    fieldMapping: event.walletFieldMapping ?? undefined,
  });
}
