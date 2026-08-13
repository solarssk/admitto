import { decryptFromString } from "@admitto/crypto";
import { PassCreatorClient } from "./passcreator-client.js";
import type { WalletPassProvider } from "./provider.js";

/** Trivial env reader, deliberately duplicated from apps/web/src/config.ts's own
 * resolvePassCreatorBaseUrl rather than shared - this package stays app-agnostic (no reaching
 * into apps/web), and the logic is small enough that sharing it isn't worth a new dependency. */
function resolvePassCreatorBaseUrl(): string | undefined {
  const raw = process.env["PASSCREATOR_BASE_URL"]?.trim();
  return raw?.startsWith("https://") ? raw : undefined;
}

/**
 * Both the API key and the pass template belong to the event (ADR 0041). Lives in this package
 * (not apps/web, where it originated) so both apps/web (request paths) and apps/cli (the
 * wallet-sync worker job) can resolve the same provider without duplicating credential
 * decryption/client construction - apps/cli never depends on apps/web. `injectedProvider` mirrors
 * apps/web's createApp `options.walletPassProvider` test escape hatch - pass it through
 * explicitly at each call site.
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
