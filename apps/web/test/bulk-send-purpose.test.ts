import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { DEFAULT_BODY_MJML, DEFAULT_SUBJECT_TEMPLATE, setMailTemplate } from "@admitto/mail-templates";
import { resolveBulkSendPurpose } from "../src/admin/bulk-send-routes.js";

const ORG = "org-bulk-purpose";
const EVENT = "evt-bulk-purpose";

let prisma: PrismaClient;
let ticketId: string;
let reminderId: string;

describe("resolveBulkSendPurpose", () => {
  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.mailTemplate.deleteMany({ where: { scope_id: { in: [EVENT, ORG] } } });
    await prisma.event.deleteMany({ where: { id: EVENT } });
    await prisma.organization.deleteMany({ where: { id: ORG } });

    await prisma.organization.create({ data: { id: ORG, name: "Org", slug: "bulk-purpose-org" } });
    await prisma.event.create({
      data: {
        id: EVENT,
        title: "Event",
        slug: "bulk-purpose-event",
        date: new Date("2026-10-01"),
        organization_id: ORG,
      },
    });

    await setMailTemplate(
      { scopeType: "event", scopeId: EVENT, name: "ticket" },
      { subject: DEFAULT_SUBJECT_TEMPLATE, body: DEFAULT_BODY_MJML, format: "mjml" },
      prisma,
    );
    await setMailTemplate(
      { scopeType: "event", scopeId: EVENT, name: "reminder" },
      {
        subject: DEFAULT_SUBJECT_TEMPLATE,
        body: DEFAULT_BODY_MJML,
        format: "mjml",
        label: "Reminder",
      },
      prisma,
    );

    ticketId = (
      await prisma.mailTemplate.findUniqueOrThrow({
        where: {
          scope_type_scope_id_name: { scope_type: "event", scope_id: EVENT, name: "ticket" },
        },
        select: { id: true },
      })
    ).id;
    reminderId = (
      await prisma.mailTemplate.findUniqueOrThrow({
        where: {
          scope_type_scope_id_name: { scope_type: "event", scope_id: EVENT, name: "reminder" },
        },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("uses initial for no_delivery ticket template", async () => {
    expect(await resolveBulkSendPurpose(prisma, { type: "no_delivery" }, ticketId)).toBe("initial");
  });

  it("uses resend for no_delivery non-ticket template", async () => {
    expect(await resolveBulkSendPurpose(prisma, { type: "no_delivery" }, reminderId)).toBe("resend");
  });

  it("uses resend for all filter", async () => {
    expect(await resolveBulkSendPurpose(prisma, { type: "all" }, ticketId)).toBe("resend");
  });
});
