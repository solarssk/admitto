import type { PrismaClient } from "@admitto/db";
import { resolveWalletProvider, type WalletPassProvider } from "@admitto/wallet";
import { parseWalletFieldMapping } from "./resolve.js";

/** Loads an event's wallet configuration and resolves it to a provider instance, or null when
 * wallet isn't enabled/configured for that event. Shared by any AdminJob drain that needs to
 * call out to the event's wallet provider (wallet_push, wallet_message). */
export async function resolveEventWalletProvider(
  db: PrismaClient,
  eventId: string,
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
  return resolveWalletProvider({
    walletEnabled: event.wallet_enabled,
    walletTemplateId: event.wallet_template_id,
    walletApiKeyEnc: event.wallet_api_key_enc,
    walletFieldMapping: parseWalletFieldMapping(event.wallet_field_mapping),
  });
}
