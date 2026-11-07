import type { LegalDocumentKind } from "@admitto/db/status";
import type { LegalDocumentDto, LegalDocumentMissingDto } from "../api/types.js";

/** The key of an extra consent: it ends up in the address of its page and in what a guest accepted. The same rule as
 * `LEGAL_CONSENT_KEY_PATTERN` in apps/web/src/legal/legal-documents.ts (a test compares the two). */
export const CONSENT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
export const CONSENT_KEY_MAX_CHARS = 40;

export const KIND_LABEL: Readonly<Record<LegalDocumentKind, string>> = {
  privacy_notice: "Privacy notice",
  event_terms: "Event terms",
  consent: "Extra consent",
};

/** A text of the event, written or not: `ref` names it in the address of the API and of its public page. */
export type LegalTextTarget = { ref: string; kind: LegalDocumentKind; key: string | null };

export const PRIVACY_NOTICE_TARGET: LegalTextTarget = { ref: "privacy-notice", kind: "privacy_notice", key: null };
export const EVENT_TERMS_TARGET: LegalTextTarget = { ref: "event-terms", kind: "event_terms", key: null };

export function consentTarget(key: string): LegalTextTarget {
  return { ref: `consent-${key}`, kind: "consent", key };
}

/** What a new text is called until the organiser renames it. A consent has none: its title is the label of its checkbox. */
export function defaultTitle(kind: LegalDocumentKind): string {
  return kind === "consent" ? "" : KIND_LABEL[kind];
}

/** One line of the list: a text the event needs (the privacy notice and the terms, written or not) or a consent that has been written. */
export type LegalTextRow = { target: LegalTextTarget; document: LegalDocumentDto | null };

/** The privacy notice and the terms first, whether they exist yet or not, then the consents the event has. */
export function legalTextRows(items: readonly LegalDocumentDto[]): LegalTextRow[] {
  const byRef = new Map(items.map((item) => [item.ref, item]));
  const fixed = [PRIVACY_NOTICE_TARGET, EVENT_TERMS_TARGET].map((target) => ({ target, document: byRef.get(target.ref) ?? null }));
  const consents = items
    .filter((item) => item.kind === "consent")
    .map((item) => ({ target: { ref: item.ref, kind: item.kind, key: item.key }, document: item }));
  return [...fixed, ...consents];
}

/** What the page says a missing text is called: its title when it has been written, else the name of its kind. */
export function missingTextName(missing: LegalDocumentMissingDto, items: readonly LegalDocumentDto[]): string {
  const written = items.find((item) => item.ref === missing.ref);
  if (written) return written.title;
  return missing.kind === "consent" ? `Consent "${missing.key ?? ""}"` : KIND_LABEL[missing.kind];
}

/** What copying one text does to this event. */
export type CopyAction = "add" | "replace_draft" | "replace_published";

export type CopyStep = { source: LegalDocumentDto; action: CopyAction };

export type CopyPlan = {
  steps: CopyStep[];
  /** How many extra consents this event would have after the copy. */
  consentsAfter: number;
  overLimit: boolean;
};

/**
 * What copying the texts of another event does here: each of its texts is added, or replaces the text of this event
 * that has the same ref (a published one stays published, so guests read the copy at once); texts of this event that the
 * other one lacks stay as they are. The list of steps keeps the order of the source.
 */
export function planCopy(
  source: readonly LegalDocumentDto[],
  current: readonly LegalDocumentDto[],
  maxConsents: number,
): CopyPlan {
  const currentByRef = new Map(current.map((item) => [item.ref, item]));
  const steps = source.map((item): CopyStep => {
    const existing = currentByRef.get(item.ref);
    if (!existing) return { source: item, action: "add" };
    return { source: item, action: existing.published ? "replace_published" : "replace_draft" };
  });
  const consentsAfter =
    current.filter((item) => item.kind === "consent").length +
    steps.filter((step) => step.source.kind === "consent" && step.action === "add").length;
  return { steps, consentsAfter, overLimit: consentsAfter > maxConsents };
}

/** What is wrong with a consent key the person has typed, or undefined: nothing, or nothing typed yet. */
export function consentKeyProblem(key: string, usedKeys: ReadonlySet<string>): string | undefined {
  if (key === "") return undefined;
  if (!CONSENT_KEY_PATTERN.test(key)) {
    return `Use lowercase letters, digits, hyphens and underscores, up to ${CONSENT_KEY_MAX_CHARS} characters, starting with a letter or a digit.`;
  }
  return usedKeys.has(key) ? "This event already has a consent with this key." : undefined;
}

export type LegalFormInput = {
  title: string;
  /** The title as it is stored, or the one a text starts with. */
  savedTitle: string;
  /** The text as the editor reports it ("" for none), null until the editor is there. */
  html: string | null;
  /** What the editor reported when this text was loaded: the difference is the edit. */
  baseline: string | null;
  contentLimit: number;
  /** A consent that has not been saved: its key is typed too. */
  isNewConsent: boolean;
  keyText: string;
  keyProblem: string | undefined;
};

export type LegalFormState = {
  /** Something was changed since the text was loaded or saved. */
  dirty: boolean;
  /** There are no words yet. */
  empty: boolean;
  tooLong: boolean;
  canSave: boolean;
};

/** What the form can say about itself: whether there is anything to save, and whether it can be saved. */
export function legalFormState(input: LegalFormInput): LegalFormState {
  const { title, savedTitle, html, baseline, contentLimit, isNewConsent, keyText, keyProblem } = input;
  const edited = html !== null && baseline !== null && html !== baseline;
  const dirty = title !== savedTitle || edited || (isNewConsent && keyText !== "");
  const empty = html === null || html === "";
  const tooLong = html !== null && html.length > contentLimit;
  const keyReady = !isNewConsent || (keyText !== "" && keyProblem === undefined);
  return { dirty, empty, tooLong, canSave: dirty && !empty && !tooLong && title.trim() !== "" && keyReady };
}
