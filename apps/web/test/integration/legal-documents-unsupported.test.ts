import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { hashPassword } from "@admitto/auth";
import { bootSingleOrgFixture } from "../helpers/boot-single-org-fixture.js";
import { enrollConfirmedTotp } from "../helpers/enroll-confirmed-totp.js";
import { createAdminAndOp, seedOrgAndEvent } from "../helpers/seed-org-and-event.js";

// A text that real markup cannot produce (cleaning it never settles) is stood in for by a marker, so the
// answer of the route to a refusal can be tested: the sanitiser itself is the real one for everything else.
vi.mock("../../src/legal/sanitize-legal-html.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/legal/sanitize-legal-html.js")>();
  return {
    ...actual,
    sanitizeLegalHtml: (raw: string) => (raw.includes("NEVER-SETTLES") ? null : actual.sanitizeLegalHtml(raw)),
  };
});

const adminDistRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/admin-dist");
const sameOrigin = { Origin: "http://localhost" };

const ORG = "org-legal-unsupported";
const EVENT = "evt-legal-unsupported";
const EMAILS = ["legal-unsupported-admin@example.com", "legal-unsupported-op@example.com"];

let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof bootSingleOrgFixture>>["app"];
let adminCookie = "";

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await prisma.legalDocument.deleteMany({ where: { event_id: EVENT } });
  await prisma.adminAuditLog.deleteMany({ where: { organization_id: ORG } });
  await prisma.roleAssignment.deleteMany({ where: { scope_id: { in: [ORG, EVENT] } } });
  await prisma.session.deleteMany({ where: { user: { email: { in: EMAILS } } } });
  await prisma.userMfaMethod.deleteMany({ where: { user: { email: { in: EMAILS } } } });
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
  await prisma.event.deleteMany({ where: { id: EVENT } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
  await seedOrgAndEvent(
    prisma,
    { id: ORG, name: "Legal Unsupported Org", slug: "legal-unsupported-org" },
    { id: EVENT, title: "Legal Unsupported", slug: "legal-unsupported", date: "2026-10-01", organizationId: ORG },
  );
  const { adminId, opId } = await createAdminAndOp(prisma, {
    adminEmail: EMAILS[0]!,
    opEmail: EMAILS[1]!,
    passwordHash: await hashPassword("legal-unsupported-pass-123"),
    orgId: ORG,
    eventId: EVENT,
  });
  await enrollConfirmedTotp(prisma, adminId);
  ({ app, adminCookie } = await bootSingleOrgFixture({
    prisma,
    adminId,
    opId,
    checkinToken: "legal-unsupported-checkin-token-32c!",
    adminDistRoot,
  }));
});

afterAll(async () => {
  await prisma?.$disconnect();
});

const put = (content_html: string) =>
  app.request(`/api/admin/events/${EVENT}/legal-documents/privacy-notice`, {
    method: "PUT",
    headers: { Cookie: adminCookie, ...sameOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Notice", content_html }),
  });

describe("PUT of a text the sanitiser refuses", () => {
  it("answers 422 legal_document_unsupported, not 'empty', and stores and audits nothing", async () => {
    const res = await put("<p>NEVER-SETTLES</p>");
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "legal_document_unsupported" });
    expect(await prisma.legalDocument.count({ where: { event_id: EVENT } })).toBe(0);
    expect(await prisma.adminAuditLog.count({ where: { organization_id: ORG } })).toBe(0);
  });

  it("still saves any other text", async () => {
    const res = await put("<p>Ordinary text</p>");
    expect(res.status).toBe(201);
    expect(await prisma.legalDocument.count({ where: { event_id: EVENT } })).toBe(1);
  });
});
