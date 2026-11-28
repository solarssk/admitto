import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LEGAL_CONSENT_KEY_PATTERN,
  legalDocumentPath,
  legalDocumentRef,
  normalizeLegalTitle,
  parseLegalDocumentRef,
  requiredLegalDocuments,
  type LegalDocumentRef,
} from "../../src/legal/legal-documents.js";
import { evaluateLegalGate, legalDocumentRefDto } from "../../src/legal/registration-gate.js";

const PRIVACY: LegalDocumentRef = { kind: "privacy_notice", key: "" };
const TERMS: LegalDocumentRef = { kind: "event_terms", key: "" };
const consent = (key: string): LegalDocumentRef => ({ kind: "consent", key });

describe("legal document refs", () => {
  it("name each kind, and a consent by its key", () => {
    expect(legalDocumentRef(PRIVACY)).toBe("privacy-notice");
    expect(legalDocumentRef(TERMS)).toBe("event-terms");
    expect(legalDocumentRef(consent("photos"))).toBe("consent-photos");
  });

  it("parse back to what they name", () => {
    for (const doc of [PRIVACY, TERMS, consent("photos"), consent("a"), consent("newsletter-2026"), consent("x_1")]) {
      expect(parseLegalDocumentRef(legalDocumentRef(doc))).toEqual(doc);
    }
  });

  it.each([
    "",
    "privacy_notice",
    "event_terms",
    "Privacy-Notice",
    "privacy-notice/",
    " privacy-notice",
    "privacy-notices",
    "consent",
    "consent-",
    "consents-photos",
    "consent-Photos",
    "consent-photo s",
    "consent--photos",
    "consent-_photos",
    "consent-photos/",
    "consent-photos.html",
    `consent-${"a".repeat(41)}`,
    "consent-zdj\u0119cia",
    "..",
    "%70rivacy-notice",
  ])("do not parse %j", (ref) => {
    expect(parseLegalDocumentRef(ref)).toBeNull();
  });

  it("accept a key of up to 40 characters", () => {
    expect(parseLegalDocumentRef(`consent-${"a".repeat(40)}`)).toEqual(consent("a".repeat(40)));
  });

  it("use the same key rule as the database constraint, read from the migration itself", () => {
    const migration = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../../../packages/db/prisma/migrations/20261021130000_add_legal_document/migration.sql"),
      "utf8",
    );
    const sqlPattern = /CONSTRAINT "LegalDocument_key_format"\s+CHECK \("key" = '' OR "key" ~ '([^']+)'\)/.exec(migration)?.[1];
    expect(sqlPattern).toBeDefined();
    expect(LEGAL_CONSENT_KEY_PATTERN.source).toBe(sqlPattern);
  });

  it("give the public path under the event's slug", () => {
    expect(legalDocumentPath("summit-2026", PRIVACY)).toBe("/legal/summit-2026/privacy-notice");
    expect(legalDocumentPath("summit-2026", consent("photos"))).toBe("/legal/summit-2026/consent-photos");
  });
});

describe("requiredLegalDocuments", () => {
  it("is the privacy notice and the terms, then the event's consents in the order it lists them", () => {
    expect(requiredLegalDocuments([])).toEqual([PRIVACY, TERMS]);
    expect(requiredLegalDocuments(["photos", "newsletter"])).toEqual([PRIVACY, TERMS, consent("photos"), consent("newsletter")]);
  });

  it("lists a repeated consent once", () => {
    expect(requiredLegalDocuments(["photos", "photos"])).toEqual([PRIVACY, TERMS, consent("photos")]);
  });
});

describe("normalizeLegalTitle", () => {
  it("makes one line of single spaces", () => {
    expect(normalizeLegalTitle("  Event \t terms \n\n of  entry  ")).toBe("Event terms of entry");
  });

  it("removes control and invisible characters", () => {
    expect(normalizeLegalTitle("Pri\u0000vacy\u200b not\u00adice\u202e\u2066!")).toBe("Privacy notice!");
  });

  it("composes letters and keeps every script", () => {
    expect(normalizeLegalTitle("Za\u0328b")).toBe("Z\u0105b");
    expect(normalizeLegalTitle("Regulamin: \u201eZ\u0105b\u201d \u6570\u636e")).toBe("Regulamin: \u201eZ\u0105b\u201d \u6570\u636e");
  });

  it("gives an empty string for a title that is only blank", () => {
    expect(normalizeLegalTitle(" \t\n\u200b\u00a0 ")).toBe("");
  });
});

describe("evaluateLegalGate", () => {
  const at = new Date("2026-10-21T10:00:00Z");
  const row = (doc: LegalDocumentRef, publishedAt: Date | null = at, title = `Title of ${doc.kind}`) => ({
    ...doc,
    title,
    published_at: publishedAt,
  });

  it("passes when everything required is published, and lists the titles in order", () => {
    const gate = evaluateLegalGate([row(consent("photos")), row(TERMS), row(PRIVACY)], ["photos"]);
    expect(gate.missing).toEqual([]);
    expect(gate.published.map(({ kind, key, title }) => ({ kind, key, title }))).toEqual([
      { kind: "privacy_notice", key: "", title: "Title of privacy_notice" },
      { kind: "event_terms", key: "", title: "Title of event_terms" },
      { kind: "consent", key: "photos", title: "Title of consent" },
    ]);
  });

  it("reports a text that does not exist", () => {
    expect(evaluateLegalGate([row(TERMS)], []).missing).toEqual([PRIVACY]);
    expect(evaluateLegalGate([], []).missing).toEqual([PRIVACY, TERMS]);
  });

  it("reports a draft like a text that does not exist", () => {
    expect(evaluateLegalGate([row(PRIVACY), row(TERMS, null)], []).missing).toEqual([TERMS]);
  });

  it("asks for a consent only when the event lists its key", () => {
    const rows = [row(PRIVACY), row(TERMS), row(consent("photos"), null)];
    expect(evaluateLegalGate(rows, []).missing).toEqual([]);
    expect(evaluateLegalGate(rows, ["photos"]).missing).toEqual([consent("photos")]);
    expect(evaluateLegalGate(rows, ["newsletter"]).missing).toEqual([consent("newsletter")]);
  });

  it("does not take a consent for the terms because their keys look alike", () => {
    expect(evaluateLegalGate([row(PRIVACY), row({ kind: "consent", key: "x" })], []).missing).toEqual([TERMS]);
  });
});

describe("legalDocumentRefDto", () => {
  it("gives the ref, the kind and a null key where there is none", () => {
    expect(legalDocumentRefDto(PRIVACY)).toEqual({ ref: "privacy-notice", kind: "privacy_notice", key: null });
    expect(legalDocumentRefDto(consent("photos"))).toEqual({ ref: "consent-photos", kind: "consent", key: "photos" });
  });
});
