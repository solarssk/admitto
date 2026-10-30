/**
 * The legal texts of an event (D-F2): vocabulary, limits, the one string that names a text in a URL,
 * and the clean-up of the fields an organiser types. Pure: nothing here touches the database.
 *
 * A text is named by its `ref`: `privacy-notice`, `event-terms` or `consent-<key>`. The same ref is
 * the last segment of the public page (`/legal/<event slug>/<ref>`) and of the organiser API
 * (`/api/admin/events/:eventId/legal-documents/<ref>`), so one parser serves both.
 */
import type { LegalDocumentKind } from "@admitto/db";

/** Longest title, after clean-up. For a consent the title is also the label of its checkbox. */
export const MAX_LEGAL_TITLE_CHARS = 200;

/** Longest HTML an organiser may send for one text (a long privacy notice is about 30 000). */
export const MAX_LEGAL_CONTENT_CHARS = 100_000;

/** Extra consents one event may define. Each is a separate text of up to MAX_LEGAL_CONTENT_CHARS. */
export const MAX_CONSENT_DOCUMENTS_PER_EVENT = 10;

/** Body cap of the save route. A text of MAX_LEGAL_CONTENT_CHARS is up to about 300 KB in UTF-8 and a
 * little more once JSON has escaped its quotes. */
export const MAX_LEGAL_BODY_BYTES = 512 * 1024;

/** A consent key: it ends up in a URL and as a key of `Registration.consents`. Same rule as the
 * `LegalDocument_key_format` CHECK constraint. */
export const LEGAL_CONSENT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** A text of an event: its kind, and its consent key (empty for the privacy notice and the terms). */
export type LegalDocumentRef = { kind: LegalDocumentKind; key: string };

const CONSENT_REF_PREFIX = "consent-";

/** The ref of a text, for a URL. */
export function legalDocumentRef({ kind, key }: LegalDocumentRef): string {
  if (kind === "privacy_notice") return "privacy-notice";
  if (kind === "event_terms") return "event-terms";
  return `${CONSENT_REF_PREFIX}${key}`;
}

/** The text a ref names, or null for anything that is not a ref (a malformed consent key too). */
export function parseLegalDocumentRef(ref: string): LegalDocumentRef | null {
  if (ref === "privacy-notice") return { kind: "privacy_notice", key: "" };
  if (ref === "event-terms") return { kind: "event_terms", key: "" };
  if (!ref.startsWith(CONSENT_REF_PREFIX)) return null;
  const key = ref.slice(CONSENT_REF_PREFIX.length);
  return LEGAL_CONSENT_KEY_PATTERN.test(key) ? { kind: "consent", key } : null;
}

/** The public page of a text. The slug is an event slug, so it needs no encoding. */
export function legalDocumentPath(eventSlug: string, doc: LegalDocumentRef): string {
  return `/legal/${eventSlug}/${legalDocumentRef(doc)}`;
}

/** What an event needs published before its registration can be on (D-F2): the privacy notice, the
 * terms and every extra consent the event asks for, in that order. */
export function requiredLegalDocuments(consentKeys: readonly string[]): LegalDocumentRef[] {
  return [
    { kind: "privacy_notice", key: "" },
    { kind: "event_terms", key: "" },
    ...[...new Set(consentKeys)].map((key) => ({ kind: "consent" as const, key })),
  ];
}

/** A title as it is stored: one line, no control or invisible characters, single spaces. A tab or a
 * line break becomes a space; any other control character (U+0000 too) is removed. */
export function normalizeLegalTitle(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/\p{Default_Ignorable_Code_Point}/gu, "")
    .replace(/\p{Cc}/gu, (char) => (/\s/u.test(char) ? " " : ""))
    .replace(/\s+/gu, " ")
    .trim();
}
