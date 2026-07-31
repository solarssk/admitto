import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { DEFAULT_BODY_MJML, DEFAULT_SUBJECT_TEMPLATE, setMailTemplate } from "@admitto/mail-templates";
import {
  resolveBulkSendAttendeeIds,
  resolveBulkSendNoDeliveryScope,
} from "../../src/admin/bulk-send-routes.js";

const ORG = "org-no-del-scope";
const EVENT = "evt-no-del-scope";

let prisma: PrismaClient;
let ticketId: string;
let reminderId: string;

describe("resolveBulkSendAttendeeIds no_delivery scope", () => {
  beforeAll(async () => {
    prisma = createTestPrismaClient();
    await prisma.emailDelivery.deleteMany({ where: { event_id: EVENT } });
    await prisma.attendee.deleteMany({ where: { event_id: EVENT } });
    await prisma.mailTemplate.deleteMany({ where: { scope_id: { in: [EVENT, ORG] } } });
    await prisma.event.deleteMany({ where: { id: EVENT } });
    await prisma.organization.deleteMany({ where: { id: ORG } });

    await prisma.organization.create({ data: { id: ORG, name: "Org", slug: "no-del-scope-org" } });
    await prisma.event.create({
      data: {
        id: EVENT,
        title: "Event",
        slug: "no-del-scope-event",
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

    const attendee = await prisma.attendee.create({
      data: {
        id: "att-no-del-scope",
        event_id: EVENT,
        email: "scoped@example.com",
        name: "Scoped",
      },
    });

    await prisma.emailDelivery.create({
      data: {
        organization_id: ORG,
        event_id: EVENT,
        attendee_id: attendee.id,
        template_id: ticketId,
        purpose: "initial",
        provider: "export_only",
        status: "sent",
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("ticket no_delivery ignores non-initial deliveries", async () => {
    const scope = await resolveBulkSendNoDeliveryScope(prisma, ticketId);
    expect(scope).toEqual({ mode: "initial_ticket" });

    const { ids } = await resolveBulkSendAttendeeIds(
      prisma,
      EVENT,
      { type: "no_delivery" },
      scope,
    );
    expect(ids).toEqual([]);
  });

  it("reminder no_delivery still includes attendee without reminder delivery", async () => {
    const scope = await resolveBulkSendNoDeliveryScope(prisma, reminderId);
    expect(scope).toEqual({ mode: "template", templateId: reminderId });

    const { ids } = await resolveBulkSendAttendeeIds(
      prisma,
      EVENT,
      { type: "no_delivery" },
      scope,
    );
    expect(ids).toEqual(["att-no-del-scope"]);
  });

  it("initial_ticket scope excludes attendee with initial delivery only", async () => {
    const { ids } = await resolveBulkSendAttendeeIds(
      prisma,
      EVENT,
      { type: "no_delivery" },
      { mode: "initial_ticket" },
    );
    expect(ids).toEqual([]);
  });

  it("initial_ticket scope includes attendee with resend-only delivery", async () => {
    const attendee = await prisma.attendee.create({
      data: {
        id: "att-resend-only",
        event_id: EVENT,
        email: "resend-only@example.com",
        name: "Resend Only",
      },
    });
    await prisma.emailDelivery.create({
      data: {
        organization_id: ORG,
        event_id: EVENT,
        attendee_id: attendee.id,
        template_id: reminderId,
        purpose: "resend",
        provider: "export_only",
        status: "sent",
      },
    });

    const { ids } = await resolveBulkSendAttendeeIds(
      prisma,
      EVENT,
      { type: "no_delivery" },
      { mode: "initial_ticket" },
    );
    expect(ids).toEqual([attendee.id]);
  });
});
