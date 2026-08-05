import { ImapFlow } from "imapflow";
import { resolveSafeMailDestination } from "@admitto/mailer";
import { extractPlainTextFromSource } from "./extractMimeText.js";
import type {
  FetchCandidateOptions,
  InboundMailProvider,
  InboundMessage,
  ImapConnectConfig,
} from "./types.js";

export { extractPlainTextFromSource, MAX_BODY_BYTES } from "./extractMimeText.js";

function messageReceivedAt(msg: {
  internalDate?: Date | string | null;
  envelope?: { date?: Date | string | null } | null;
}): Date {
  if (msg.internalDate instanceof Date) return msg.internalDate;
  if (msg.envelope?.date instanceof Date) return msg.envelope.date;
  return new Date();
}

export class ImapInboundProvider implements InboundMailProvider {
  private client: ImapFlow | null = null;

  constructor(private readonly config: ImapConnectConfig) {}

  /** Same SSRF guard + DNS pin SMTP uses (@admitto/mailer). Resolve once, connect to that IP,
   * keep `servername` as the configured hostname for SNI/cert checks. Without pinning, ImapFlow
   * would re-resolve the hostname at connect time and reopen a DNS-rebinding gap. */
  async connect(): Promise<void> {
    const records = await resolveSafeMailDestination(this.config.host);
    const connectHost = records[0]!.address;
    const client = new ImapFlow({
      host: connectHost,
      servername: this.config.host,
      port: this.config.port,
      secure: true,
      auth: {
        user: this.config.user,
        pass: this.config.password,
      },
      logger: false,
    });
    await client.connect();
    this.client = client;
  }

  async fetchCandidateMessages(
    folder: string,
    since: Date,
    options?: FetchCandidateOptions,
  ): Promise<InboundMessage[]> {
    const client = this.requireClient();
    const lock = await client.getMailboxLock(folder);
    try {
      const uids = await client.search({ since }, { uid: true });
      if (!uids || uids.length === 0) return [];

      const skipUids = options?.skipUids;
      const toFetch =
        skipUids && skipUids.size > 0
          ? uids.filter((uid) => !skipUids.has(String(uid)))
          : uids;
      if (toFetch.length === 0) return [];

      const messages: InboundMessage[] = [];
      for await (const msg of client.fetch(
        toFetch,
        { uid: true, envelope: true, source: true, internalDate: true },
        { uid: true },
      )) {
        const uid = String(msg.uid);
        try {
          const subject = msg.envelope?.subject ?? "";
          messages.push({
            uid,
            receivedAt: messageReceivedAt(msg),
            subject: typeof subject === "string" ? subject : String(subject),
            bodyText: extractPlainTextFromSource(msg.source as Buffer | undefined),
          });
        } catch (err) {
          // One poison MIME/HTML entity must not abort the whole folder fetch.
          console.error(
            `[bounce-ingest] skip uid=${uid}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      return messages;
    } finally {
      lock.release();
    }
  }

  async markSeen(folder: string, uid: string | string[]): Promise<void> {
    const uids = (Array.isArray(uid) ? uid : [uid]).filter((u) => u.length > 0);
    if (uids.length === 0) return;

    const client = this.requireClient();
    const lock = await client.getMailboxLock(folder);
    try {
      // ImapFlow accepts a SequenceString ("1,2,3") or a single UID string.
      const range = uids.length === 1 ? uids[0]! : uids.join(",");
      await client.messageFlagsAdd(range, [String.raw`\Seen`], { uid: true });
    } finally {
      lock.release();
    }
  }

  /** Verify the mailbox exists (STATUS / open) without fetching messages. */
  async probeFolder(folder: string): Promise<void> {
    const client = this.requireClient();
    const lock = await client.getMailboxLock(folder);
    lock.release();
  }

  async close(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.logout();
    } catch {
      this.client.close();
    } finally {
      this.client = null;
    }
  }

  private requireClient(): ImapFlow {
    if (!this.client) {
      throw new Error("IMAP client is not connected");
    }
    return this.client;
  }
}
