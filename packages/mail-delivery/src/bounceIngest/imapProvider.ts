import { ImapFlow } from "imapflow";
import { resolveSafeMailDestination } from "@admitto/mailer";
import type { InboundMailProvider, InboundMessage, ImapConnectConfig } from "./types.js";

/** Cap body text so one oversized message cannot stall the run. */
export const MAX_BODY_BYTES = 64 * 1024;

function sourceToText(source: Buffer | Uint8Array | string | undefined): string {
  if (!source) return "";
  const buf = typeof source === "string" ? Buffer.from(source, "utf8") : Buffer.from(source);
  return buf.subarray(0, MAX_BODY_BYTES).toString("utf8");
}

/** Undo RFC 2045 quoted-printable: soft line breaks (`=\r\n`) and `=XX` hex escapes.
 * Real NDRs are QP-encoded; without this, a diagnostic line that happens to wrap
 * (`host x.example.com (1.2.3.4) =\nsaid: 550 …`) leaves a stray `=` where a
 * bounce-line regex expects whitespace, silently breaking the match. */
function decodeQuotedPrintable(input: string): string {
  const joined = input.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    const hex = joined.slice(i + 1, i + 3);
    if (joined[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(Number.parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push((joined.codePointAt(i) ?? 0) & 0xff);
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

function decodeBase64(input: string): string {
  try {
    return Buffer.from(input.replace(/\s+/g, ""), "base64").toString("utf8");
  } catch {
    return input;
  }
}

function decodeBodyByEncoding(raw: string, encoding: string | undefined): string {
  const enc = (encoding ?? "7bit").trim().toLowerCase();
  if (enc === "quoted-printable") return decodeQuotedPrintable(raw);
  if (enc === "base64") return decodeBase64(raw);
  return raw;
}

const NAMED_HTML_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Accept only Unicode scalar values: integers 0..0x10FFFF outside the surrogate range.
 * Invalid numeric entities keep the original match (never throw via fromCodePoint). */
function isSafeHtmlEntityCodePoint(code: number): boolean {
  return (
    Number.isInteger(code) &&
    code >= 0 &&
    code <= 0x10ffff &&
    !(code >= 0xd800 && code <= 0xdfff)
  );
}

/** Decodes `&#347;` / `&#x159;` numeric references and the handful of named entities MTAs
 * actually emit. Left undecoded otherwise (never throws) - bounce NDRs are diagnostic text,
 * not attacker-controlled markup, so a best-effort decode is enough. */
function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, ref: string) => {
    if (ref.startsWith("#x") || ref.startsWith("#X")) {
      const code = Number.parseInt(ref.slice(2), 16);
      return isSafeHtmlEntityCodePoint(code) ? String.fromCodePoint(code) : match;
    }
    if (ref.startsWith("#")) {
      const code = Number.parseInt(ref.slice(1), 10);
      return isSafeHtmlEntityCodePoint(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_HTML_ENTITIES[ref.toLowerCase()] ?? match;
  });
}

/** Strips genuine HTML tags (name starts with a letter) while preserving line breaks from
 * block-level tags, and decodes HTML entities. A literal `<user@example.com>` (some MTAs emit
 * this unescaped in an NDR's HTML part) does not start with a letter followed by tag syntax, so
 * it survives and stays visible to the bounce-line regexes.
 *
 * Collapsing all whitespace (including real line breaks) to single spaces here previously let
 * an unrelated paragraph (e.g. a confidentiality disclaimer after the diagnostic line) merge
 * onto the same "line" as the bounce reason, so `parseBounceLine`'s `$`-anchored reason capture
 * had nothing to stop at and swallowed the whole paragraph into the stored bounce reason. */
function stripHtmlTagsSafely(html: string): string {
  const withLineBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n");
  const withoutTags = withLineBreaks.replace(/<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>/g, " ");
  return decodeHtmlEntities(withoutTags)
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function parseContentTypeHeader(value: string): { type: string; params: Map<string, string> } {
  const parts = value.split(";").map((s) => s.trim());
  const type = (parts[0] ?? "").toLowerCase();
  const params = new Map<string, string>();
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq === -1) continue;
    const key = p.slice(0, eq).trim().toLowerCase();
    let val = p.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    params.set(key, val);
  }
  return { type, params };
}

function parseHeaders(headerBlock: string): Map<string, string> {
  const headers = new Map<string, string>();
  const unfolded = headerBlock.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    headers.set(line.slice(0, idx).trim().toLowerCase(), line.slice(idx + 1).trim());
  }
  return headers;
}

interface MimeLeaf {
  contentType: string;
  text: string;
}

/** Best-effort recursive MIME walker: enough to reach `message/delivery-status`,
 * `text/plain`, and `text/html` leaves inside `multipart/report|alternative|mixed`,
 * with each leaf's Content-Transfer-Encoding decoded. Not a full RFC 2045 parser. */
function splitMimeMessage(raw: string, depth = 0): MimeLeaf[] {
  if (depth > 5) return [];
  const headerEnd = raw.search(/\r?\n\r?\n/);
  const headerBlock = headerEnd === -1 ? raw : raw.slice(0, headerEnd);
  const body = headerEnd === -1 ? "" : raw.slice(headerEnd).replace(/^\r?\n\r?\n/, "");
  const headers = parseHeaders(headerBlock);
  const { type, params } = parseContentTypeHeader(headers.get("content-type") ?? "text/plain");
  const boundary = params.get("boundary");

  if (type.startsWith("multipart/") && boundary) {
    const delimiter = `--${boundary}`;
    const segments = body.split(delimiter);
    const leaves: MimeLeaf[] = [];
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i] ?? "";
      if (seg.startsWith("--")) break;
      const trimmed = seg.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
      if (!trimmed.trim()) continue;
      leaves.push(...splitMimeMessage(trimmed, depth + 1));
    }
    return leaves;
  }

  return [{ contentType: type, text: decodeBodyByEncoding(body, headers.get("content-transfer-encoding")) }];
}

/**
 * Extract text used for bounce parsing from a raw RFC822 source.
 *
 * Decodes MIME structure and quoted-printable/base64 encoding, then combines
 * every `message/delivery-status` (RFC 3464, machine-readable), `text/plain`,
 * and `text/html` (tag-stripped, brackets preserved) leaf found. Some MTAs put
 * the recipient address only in the HTML part while the plain-text part omits
 * it entirely, so both are kept rather than picking one.
 */
function collectMimeTextChunks(leaves: MimeLeaf[]): string[] {
  const chunks: string[] = [];
  for (const leaf of leaves) {
    if (leaf.contentType === "message/delivery-status" && leaf.text.trim()) {
      chunks.push(leaf.text.trim());
    }
  }
  for (const leaf of leaves) {
    if (leaf.contentType === "text/plain" && leaf.text.trim()) {
      chunks.push(leaf.text.trim());
    }
  }
  for (const leaf of leaves) {
    if (leaf.contentType === "text/html" && leaf.text.trim()) {
      chunks.push(stripHtmlTagsSafely(leaf.text));
    }
  }
  return chunks;
}

function fallbackBodyText(raw: string): string {
  const headerEnd = raw.search(/\r?\n\r?\n/);
  const body = headerEnd === -1 ? raw : raw.slice(headerEnd).replace(/^\r?\n/, "");
  const looksHtml = /<html[\s>]/i.test(body) || /<body[\s>]/i.test(body);
  return looksHtml ? stripHtmlTagsSafely(body) : body;
}

export function extractPlainTextFromSource(source: Buffer | Uint8Array | string | undefined): string {
  const raw = sourceToText(source);
  if (!raw) return "";

  let leaves: MimeLeaf[];
  try {
    leaves = splitMimeMessage(raw);
  } catch {
    leaves = [];
  }

  const chunks = collectMimeTextChunks(leaves);
  if (chunks.length === 0) chunks.push(fallbackBodyText(raw));

  return chunks.join("\n\n").slice(0, MAX_BODY_BYTES);
}

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

  async fetchCandidateMessages(folder: string, since: Date): Promise<InboundMessage[]> {
    const client = this.requireClient();
    const lock = await client.getMailboxLock(folder);
    try {
      const uids = await client.search({ since }, { uid: true });
      if (!uids || uids.length === 0) return [];

      const messages: InboundMessage[] = [];
      for await (const msg of client.fetch(
        uids,
        { uid: true, envelope: true, source: true, internalDate: true },
        { uid: true },
      )) {
        const uid = String(msg.uid);
        const subject = msg.envelope?.subject ?? "";
        messages.push({
          uid,
          receivedAt: messageReceivedAt(msg),
          subject: typeof subject === "string" ? subject : String(subject),
          bodyText: extractPlainTextFromSource(msg.source as Buffer | undefined),
        });
      }
      return messages;
    } finally {
      lock.release();
    }
  }

  async markSeen(folder: string, uid: string): Promise<void> {
    const client = this.requireClient();
    const lock = await client.getMailboxLock(folder);
    try {
      await client.messageFlagsAdd(uid, [String.raw`\Seen`], { uid: true });
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
