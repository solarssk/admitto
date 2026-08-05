/** Provider-native message id (IMAP UID) for dedup and markProcessed. */
export interface InboundMessage {
  uid: string;
  receivedAt: Date;
  subject: string;
  /** Plain-text body — forwarded NDRs put the diagnostic line in quoted text. */
  bodyText: string;
}

export interface FetchCandidateOptions {
  /** Skip these provider-native UIDs before fetching source (already processed in DB). */
  skipUids?: ReadonlySet<string>;
}

/**
 * Narrow inbound boundary: fetch bounce-shaped messages from a folder.
 * Not a general inbound-mail framework (ADR 0039).
 */
export interface InboundMailProvider {
  connect(): Promise<void>;
  /**
   * Candidate messages in the folder since `since`.
   * When `options.skipUids` is set, implementations should omit those UIDs from the
   * IMAP FETCH (search still runs; body download is skipped).
   */
  fetchCandidateMessages(
    folder: string,
    since: Date,
    options?: FetchCandidateOptions,
  ): Promise<InboundMessage[]>;
  /** Optional IMAP nicety after DB UID mark; must not be the sole dedup signal. */
  markSeen?(folder: string, uid: string | string[]): Promise<void>;
  close(): Promise<void>;
}

export interface ParsedBounceLine {
  recipientEmail: string;
  /** SMTP reply code, e.g. "550". */
  smtpCode: string;
  /** Enhanced status when present, e.g. "5.1.1". */
  enhancedCode?: string;
  reason: string;
}

export interface IngestSummary {
  eventsProcessed: number;
  messagesSeen: number;
  bouncesApplied: number;
  softBouncesLogged: number;
  unparsed: number;
  noMatchingDelivery: number;
  errors: number;
  /** Human-readable skip/noop reason when nothing was attempted. */
  noopReason?: "not_configured" | "disabled" | "none_enabled";
  /** True when at least one IMAP connect failed for an attempted event. */
  connectFailed: boolean;
}

export interface ImapConnectConfig {
  host: string;
  port: number;
  user: string;
  password: string;
}
