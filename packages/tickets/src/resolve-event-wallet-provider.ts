import type { PrismaClient } from "@admitto/db";
import { resolveConfiguredWalletProvider, resolveWalletProvider, type WalletPassProvider } from "@admitto/wallet";
import { parseWalletFieldMapping } from "./resolve.js";

/** Loads an event's wallet configuration and resolves it to a provider instance, or null when
 * wallet isn't enabled/configured for that event. Shared by any AdminJob drain that needs to
 * call out to the event's wallet provider (wallet_push, wallet_message, wallet_refresh_status).
 *
 * `ignoreWalletEnabled` resolves from the event's credentials alone, without the wallet master
 * switch - for read-only actions on passes that already exist, which must keep working after the
 * feature is switched off (see resolveConfiguredWalletProvider). Everything that changes a pass or
 * sends something to an attendee leaves it off. */
export async function resolveEventWalletProvider(
  db: PrismaClient,
  eventId: string,
  options: { ignoreWalletEnabled?: boolean } = {},
): Promise<WalletPassProvider | null> {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: {
      wallet_enabled: true,
      wallet_template_id: true,
      wallet_api_key_enc: true,
      wallet_field_mapping: true,
    },
  });
  if (!event) return null;
  const config = {
    walletTemplateId: event.wallet_template_id,
    walletApiKeyEnc: event.wallet_api_key_enc,
    walletFieldMapping: parseWalletFieldMapping(event.wallet_field_mapping),
  };
  return options.ignoreWalletEnabled
    ? resolveConfiguredWalletProvider(config)
    : resolveWalletProvider({ ...config, walletEnabled: event.wallet_enabled });
}
