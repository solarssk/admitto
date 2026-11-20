import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { createTestPrismaClient } from "../src/testing.js";
import { assertTestDatabaseUrl } from "../src/testDbGuard.js";
import { LEGAL_DOCUMENT_KIND } from "../src/status.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..");

const ORG_ID = "org-legal-document-schema";
const EVENT_ID = "evt-legal-document-schema";
const OTHER_EVENT_ID = "evt-legal-document-schema-other";

let prisma: PrismaClient;
let n = 0;

type Violation = { code: "23514" | "23505" | "23503"; constraint: string };

/** Runs a statement that must fail with this Postgres error code on this constraint. Prisma 7 puts both into the message of a failed raw query. */
async function expectViolation(action: () => Promise<unknown>, { code, constraint }: Violation): Promise<void> {
  const failure = await action().then(
    () => null,
    (err: unknown) => (err instanceof Error ? err.message : String(err)),
  );
  expect(failure, `expected ${constraint} to be violated`).not.toBeNull();
  expect(failure).toContain(`Code: \`${code}\``);
  expect(failure).toContain(constraint);
}

type Row = {
  event?: string;
  kind?: string;
  key?: string;
  title?: string;
  content?: string;
  publishedAt?: string | null;
};

/** Inserts with raw SQL, so the constraints (not Prisma) are what is tested. */
async function insertDocument(row: Row = {}): Promise<string> {
  n += 1;
  const id = `legal-${n}`;
  await prisma.$executeRaw`
    INSERT INTO "LegalDocument" ("id", "event_id", "kind", "key", "title", "content_html", "published_at", "updated_at")
    VALUES (${id}, ${row.event ?? EVENT_ID}, ${row.kind ?? "privacy_notice"}, ${row.key ?? ""},
            ${row.title ?? "Privacy notice"}, ${row.content ?? "<p>Text</p>"}, ${row.publishedAt ?? null}::timestamp, now())`;
  return id;
}

beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  execSync("npx prisma migrate reset --force", { cwd: DB_ROOT, env: { ...process.env }, stdio: "pipe" });
  prisma = createTestPrismaClient();
  await prisma.organization.create({ data: { id: ORG_ID, name: "Legal Document Schema Org", slug: "legal-document-schema" } });
  for (const [id, slug] of [
    [EVENT_ID, "legal-document-schema"],
    [OTHER_EVENT_ID, "legal-document-schema-other"],
  ] as const) {
    await prisma.event.create({ data: { id, title: id, slug, date: new Date("2030-09-01"), organization_id: ORG_ID } });
  }
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("LegalDocument kinds", () => {
  it("are exactly the values the CHECK constraint accepts", async () => {
    for (const kind of LEGAL_DOCUMENT_KIND) {
      await expect(insertDocument({ event: OTHER_EVENT_ID, kind, key: kind === "consent" ? "photos" : "" })).resolves.toBeTruthy();
    }
    await expectViolation(() => insertDocument({ kind: "privacy_policy" }), {
      code: "23514",
      constraint: "LegalDocument_kind_check",
    });
    await prisma.$executeRaw`DELETE FROM "LegalDocument"`;
  });
});

describe("LegalDocument defaults", () => {
  it("starts as an unpublished draft with an empty key", async () => {
    const row = await prisma.legalDocument.create({
      data: { event_id: EVENT_ID, kind: "event_terms", title: "Event terms", content_html: "<p>Terms</p>" },
    });
    expect(row).toMatchObject({ key: "", published_at: null, updated_by: null });
    await prisma.legalDocument.delete({ where: { id: row.id } });
  });
});

describe("LegalDocument keys", () => {
  it("belong to a consent and to nothing else", async () => {
    await expectViolation(() => insertDocument({ kind: "consent", key: "" }), {
      code: "23514",
      constraint: "LegalDocument_key_iff_consent",
    });
    await expectViolation(() => insertDocument({ kind: "privacy_notice", key: "photos" }), {
      code: "23514",
      constraint: "LegalDocument_key_iff_consent",
    });
    await expectViolation(() => insertDocument({ kind: "event_terms", key: "photos" }), {
      code: "23514",
      constraint: "LegalDocument_key_iff_consent",
    });
  });

  it.each(["photos", "a", "newsletter-2026", "x_1", "0abc", "a".repeat(40)])("accepts %s", async (key) => {
    const id = await insertDocument({ kind: "consent", key, title: key });
    await prisma.$executeRaw`DELETE FROM "LegalDocument" WHERE "id" = ${id}`;
  });

  it.each(["Photos", "-photos", "_photos", "photo s", "photos/", "photos.", "photos\n", "a".repeat(41), "zdjęcia"])(
    "refuses %j",
    async (key) => {
      await expectViolation(() => insertDocument({ kind: "consent", key }), {
        code: "23514",
        constraint: "LegalDocument_key_format",
      });
    },
  );
});

describe("LegalDocument uniqueness", () => {
  it("holds one privacy notice, one set of terms and one text per consent key for an event", async () => {
    await insertDocument({ kind: "privacy_notice" });
    await insertDocument({ kind: "event_terms" });
    await insertDocument({ kind: "consent", key: "photos" });
    await insertDocument({ kind: "consent", key: "newsletter" });

    for (const [kind, key] of [
      ["privacy_notice", ""],
      ["event_terms", ""],
      ["consent", "photos"],
    ] as const) {
      await expectViolation(() => insertDocument({ kind, key }), {
        code: "23505",
        constraint: "LegalDocument_event_id_kind_key_key",
      });
    }
  });

  it("does not share texts between events", async () => {
    await expect(insertDocument({ event: OTHER_EVENT_ID, kind: "privacy_notice" })).resolves.toBeTruthy();
    await expect(insertDocument({ event: OTHER_EVENT_ID, kind: "consent", key: "photos" })).resolves.toBeTruthy();
  });
});

describe("LegalDocument content", () => {
  beforeEach(async () => {
    await prisma.$executeRaw`DELETE FROM "LegalDocument" WHERE "event_id" = ${EVENT_ID}`;
  });

  it.each(["", "   ", " \t\n "])("needs a title that is not blank (%j)", async (title) => {
    await expectViolation(() => insertDocument({ kind: "event_terms", title }), {
      code: "23514",
      constraint: "LegalDocument_title_not_blank",
    });
  });

  it("may be an empty draft but never an empty published page", async () => {
    await expect(insertDocument({ content: "", publishedAt: null })).resolves.toBeTruthy();
    await prisma.$executeRaw`DELETE FROM "LegalDocument" WHERE "event_id" = ${EVENT_ID}`;

    await expectViolation(() => insertDocument({ content: " \n ", publishedAt: "2030-01-01T00:00:00Z" }), {
      code: "23514",
      constraint: "LegalDocument_published_not_blank",
    });

    const id = await insertDocument({ content: "<p>Text</p>", publishedAt: "2030-01-01T00:00:00Z" });
    await expectViolation(() => prisma.$executeRaw`UPDATE "LegalDocument" SET "content_html" = '' WHERE "id" = ${id}`, {
      code: "23514",
      constraint: "LegalDocument_published_not_blank",
    });
  });
});

describe("LegalDocument ownership", () => {
  it("belongs to an event that exists", async () => {
    await expectViolation(() => insertDocument({ event: "evt-does-not-exist" }), {
      code: "23503",
      constraint: "LegalDocument_event_id_fkey",
    });
  });

  it("goes with its event", async () => {
    await insertDocument({ event: OTHER_EVENT_ID, kind: "event_terms" });
    expect(await prisma.legalDocument.count({ where: { event_id: OTHER_EVENT_ID } })).toBeGreaterThan(0);
    await prisma.event.delete({ where: { id: OTHER_EVENT_ID } });
    expect(await prisma.legalDocument.count({ where: { event_id: OTHER_EVENT_ID } })).toBe(0);
    expect(await prisma.legalDocument.count({ where: { event_id: EVENT_ID } })).toBeGreaterThan(0);
  });
});
