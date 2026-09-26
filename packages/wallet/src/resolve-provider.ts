import { decryptFromString } from "@admitto/crypto";
import { emitSystemLog } from "@admitto/shared/system-log";
import { PassCreatorClient } from "./passcreator-client.js";
import type { WalletPassProvider } from "./provider.js";

/** Trivial env reader, deliberately duplicated from apps/web/src/config.ts's own
 * resolvePassCreatorBaseUrl rather than shared - this package stays app-agnostic (no reaching
 * into apps/web), and the logic is small enough that sharing it isn't worth a new dependency. */
function resolvePassCreatorBaseUrl(): string | undefined {
  const raw = process.env["PASSCREATOR_BASE_URL"]?.trim();
  return raw?.startsWith("https://") ? raw : undefined;
}

/** The event's own provider credentials and field mapping - everything needed to talk to the
 * provider, independent of whether the wallet feature is currently switched on. */
type ConfiguredWalletEvent = {
  walletTemplateId: string | null;
  walletApiKeyEnc: string | null;
  walletFieldMapping: Record<string, string> | null;
};

/**
 * Whether new wallet passes may be issued for this event: the master switch is on AND the event
 * has both a template and an API key. `wallet_enabled=false` means "don't issue new passes" - it
 * does not mean "forget how to reach the provider for passes that already exist", which is what
 * {@link resolveConfiguredWalletProvider} is for.
 */
export function canIssueWalletPass(
  event: Pick<ConfiguredWalletEvent, "walletTemplateId" | "walletApiKeyEnc"> & { walletEnabled: boolean },
): boolean {
  return event.walletEnabled && Boolean(event.walletTemplateId) && Boolean(event.walletApiKeyEnc);
}

/**
 * Both the API key and the pass template belong to the event (ADR 0041). Resolves the provider from
 * that configuration alone, ignoring the wallet master switch - for actions on passes that already
 * exist and must keep working after the feature is switched off or the event is archived (GDPR
 * erasure, and the wind-down actions planned on top of it). Lives in this package (not apps/web,
 * where it originated) so both apps/web (request paths) and apps/cli (the wallet-sync worker job)
 * can resolve the same provider without duplicating credential decryption/client construction -
 * apps/cli never depends on apps/web. `injectedProvider` mirrors apps/web's createApp
 * `options.walletPassProvider` test escape hatch - pass it through explicitly at each call site.
 */
export function resolveConfiguredWalletProvider(
  event: ConfiguredWalletEvent,
  injectedProvider?: WalletPassProvider,
): WalletPassProvider | null {
  if (injectedProvider) return injectedProvider;
  const templateId = event.walletTemplateId;
  if (!templateId || !event.walletApiKeyEnc) return null;
  let apiKey: string;
  try {
    apiKey = decryptFromString(event.walletApiKeyEnc);
  } catch (err) {
    emitSystemLog("wallet", "error", "wallet_api_key_decrypt_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  return new PassCreatorClient({
    apiKey,
    templateId,
    baseUrl: resolvePassCreatorBaseUrl(),
    fieldMapping: event.walletFieldMapping ?? undefined,
  });
}

/**
 * The provider for anything that presumes the wallet feature is on for this event (issuing, and
 * today also sync/push/void/restore, which the master switch gates - see EventWalletPanel's
 * disable-confirm): the master switch AND a configured provider, or null.
 */
export function resolveWalletProvider(
  event: ConfiguredWalletEvent & { walletEnabled: boolean },
  injectedProvider?: WalletPassProvider,
): WalletPassProvider | null {
  if (injectedProvider) return injectedProvider;
  if (!canIssueWalletPass(event)) return null;
  return resolveConfiguredWalletProvider(event);
}
