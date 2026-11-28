import type { LegalDocumentDto, LegalDocumentLimitsDto, LegalDocumentWithContentDto } from "../../src/api/types.js";

/** The limits the server reports, and the ones a test of a limit lowers. */
export const LEGAL_LIMITS: LegalDocumentLimitsDto = { title_chars: 200, content_chars: 100_000, consents: 10 };

const KIND_BY_REF: Readonly<Record<string, LegalDocumentDto["kind"]>> = { "privacy-notice": "privacy_notice", "event-terms": "event_terms" };
const TITLE_BY_REF: Readonly<Record<string, string>> = { "privacy-notice": "Privacy notice", "event-terms": "Event terms" };

/** A legal text of an event as the list gives it: a draft, the privacy notice, the terms, or (any other ref) an extra consent. */
export function legalDoc(ref: string, extra: Partial<LegalDocumentDto> = {}): LegalDocumentDto {
  const kind = KIND_BY_REF[ref] ?? "consent";
  return {
    id: `id-${ref}`,
    ref,
    kind,
    key: kind === "consent" ? ref.slice("consent-".length) : null,
    title: TITLE_BY_REF[ref] ?? ref,
    published: false,
    published_at: null,
    updated_at: "2026-10-20T09:00:00.000Z",
    public_path: `/legal/demo/${ref}`,
    required: kind !== "consent",
    ...extra,
  };
}

/** The same text as one read on its own, with its HTML. */
export function legalDocWithContent(ref: string, extra: Partial<LegalDocumentWithContentDto> = {}): LegalDocumentWithContentDto {
  return { ...legalDoc(ref), content_html: "<h2>Heading</h2><p>Some words.</p>", ...extra };
}
