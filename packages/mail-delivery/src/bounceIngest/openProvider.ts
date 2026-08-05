import type { PrismaClient, BounceIngestSettings } from "@admitto/db";
import { ImapInboundProvider } from "./imapProvider.js";
import { resolveImapConnectConfig } from "./resolveAuth.js";
import type { InboundMailProvider } from "./types.js";

export type OpenBounceImapProviderOptions = {
  createProvider?: (settings: BounceIngestSettings) => Promise<InboundMailProvider>;
  env?: NodeJS.ProcessEnv;
};

/** Shared by ingest + bounce probe so IMAP open is not duplicated. */
export async function openBounceImapProvider(
  db: PrismaClient,
  settings: BounceIngestSettings,
  options: OpenBounceImapProviderOptions = {},
): Promise<InboundMailProvider> {
  if (options.createProvider) {
    return options.createProvider(settings);
  }
  const connectCfg = await resolveImapConnectConfig(db, settings, options.env ?? process.env);
  return new ImapInboundProvider(connectCfg);
}
