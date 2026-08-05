/**
 * Extract bounce-parseable text from raw RFC822 sources.
 *
 * Transfer encoding + charset use libmime / libqp / iconv-lite (same stack as
 * imapflow) instead of hand-rolled QP/base64/UTF-8-only decode. MIME tree walk
 * stays local: we only need delivery-status + text/plain + text/html leaves.
 */
import iconv from "iconv-lite";
import libmime from "libmime";
import libqp from "libqp";

/** Cap body text so one oversized message cannot stall the run. */
export const MAX_BODY_BYTES = 64 * 1024;

const NAMED_HTML_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Accept only Unicode scalar values: integers 0..0x10FFFF outside the surrogate range. */
function isSafeHtmlEntityCodePoint(code: number): boolean {
  return (
    Number.isInteger(code) &&
    code >= 0 &&
    code <= 0x10ffff &&
    !(code >= 0xd800 && code <= 0xdfff)
  );
}

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

/**
 * Strips genuine HTML tags while preserving line breaks from block-level tags.
 * A literal `<user@example.com>` does not match tag syntax, so it survives for
 * bounce-line regexes.
 */
export function stripHtmlTagsSafely(html: string): string {
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

/** Keep source as binary-safe string until charset is known (latin1 = byte↔char 1:1). */
function sourceToBinaryString(source: Buffer | Uint8Array | string | undefined): string {
  if (!source) return "";
  if (typeof source === "string") return source.slice(0, MAX_BODY_BYTES);
  const buf = Buffer.from(source).subarray(0, MAX_BODY_BYTES);
  return buf.toString("binary");
}

function parseHeaders(headerBlock: string): Map<string, string> {
  const headers = new Map<string, string>();
  const unfolded = headerBlock.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    const value = libmime.decodeWords(line.slice(idx + 1).trim());
    headers.set(name, value);
  }
  return headers;
}

function contentTypeParts(headers: Map<string, string>): {
  type: string;
  charset: string | undefined;
  boundary: string | undefined;
} {
  const raw = headers.get("content-type") ?? "text/plain";
  const parsed = libmime.parseHeaderValue(raw);
  const type = (parsed.value ?? "text/plain").toLowerCase();
  const charset =
    typeof parsed.params?.charset === "string" ? parsed.params.charset : undefined;
  const boundary =
    typeof parsed.params?.boundary === "string" ? parsed.params.boundary : undefined;
  return { type, charset, boundary };
}

function transferEncoding(headers: Map<string, string>): string {
  const raw = headers.get("content-transfer-encoding") ?? "7bit";
  const parsed = libmime.parseHeaderValue(raw);
  return (parsed.value ?? "7bit").trim().toLowerCase();
}

function decodeCharset(buf: Buffer, charset: string | undefined): string {
  const raw = (charset || "utf-8").trim() || "utf-8";
  // @types/libmime omits normalizeCharset; runtime libmime exposes it.
  const normalize = (libmime as unknown as { normalizeCharset?: (c: string) => string })
    .normalizeCharset;
  const normalized = (normalize?.(raw) || raw).toLowerCase();
  try {
    if (iconv.encodingExists(normalized)) {
      return iconv.decode(buf, normalized);
    }
  } catch {
    /* fall through */
  }
  return buf.toString("utf8");
}

/** Decode Content-Transfer-Encoding to bytes, then honor Content-Type charset. */
export function decodeTransferEncodedBody(
  bodyBinary: string,
  encoding: string | undefined,
  charset: string | undefined,
): string {
  const enc = (encoding ?? "7bit").trim().toLowerCase();
  let buf: Buffer;
  if (enc === "quoted-printable") {
    buf = libqp.decode(bodyBinary);
  } else if (enc === "base64") {
    buf = Buffer.from(bodyBinary.replace(/\s+/g, ""), "base64");
  } else {
    // 7bit / 8bit / binary: bodyBinary is latin1 byte-preserving.
    buf = Buffer.from(bodyBinary, "binary");
  }
  return decodeCharset(buf, charset);
}

interface MimeLeaf {
  contentType: string;
  text: string;
}

function splitMimeMessage(rawBinary: string, depth = 0): MimeLeaf[] {
  if (depth > 5) return [];
  const headerEnd = rawBinary.search(/\r?\n\r?\n/);
  const headerBlock = headerEnd === -1 ? rawBinary : rawBinary.slice(0, headerEnd);
  const body =
    headerEnd === -1 ? "" : rawBinary.slice(headerEnd).replace(/^\r?\n\r?\n/, "");
  const headers = parseHeaders(headerBlock);
  const { type, charset, boundary } = contentTypeParts(headers);
  const encoding = transferEncoding(headers);

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

  return [
    {
      contentType: type,
      text: decodeTransferEncodedBody(body, encoding, charset),
    },
  ];
}

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

function fallbackBodyText(rawBinary: string): string {
  const headerEnd = rawBinary.search(/\r?\n\r?\n/);
  const headerBlock = headerEnd === -1 ? "" : rawBinary.slice(0, headerEnd);
  const body =
    headerEnd === -1 ? rawBinary : rawBinary.slice(headerEnd).replace(/^\r?\n/, "");
  const headers = headerBlock ? parseHeaders(headerBlock) : new Map<string, string>();
  const { charset } = contentTypeParts(headers);
  const encoding = transferEncoding(headers);
  const decoded = decodeTransferEncodedBody(body, encoding, charset);
  const looksHtml = /<html[\s>]/i.test(decoded) || /<body[\s>]/i.test(decoded);
  return looksHtml ? stripHtmlTagsSafely(decoded) : decoded;
}

/**
 * Extract text used for bounce parsing from a raw RFC822 source.
 *
 * Combines every `message/delivery-status`, `text/plain`, and tag-stripped
 * `text/html` leaf. Honors charset and RFC 2047 encoded-words in headers.
 */
export function extractPlainTextFromSource(
  source: Buffer | Uint8Array | string | undefined,
): string {
  const raw = sourceToBinaryString(source);
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
