import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setMailSettings } from "@admitto/mailer-config";
import type { ExportPayload } from "@admitto/mailer";
import { resetDb } from "./resetDb.js";
import { getDeliveryWithTimeline, getRenderedDelivery, listDeliveries } from "../src/listDeliveries.js";
import { sendTicketEmails } from "../src/index.js";

const prisma = createTestPrismaClient();
const EVENT_A = "evt-list-a";
const EVENT_B = "evt-list-b";
const exported: ExportPayload[] = [];

beforeAll(async () => {
  await resetDb();

  await prisma.organization.create({
    data: { id: "org-list", name: "List Org", slug: "list-org" },
  });

  for (const [eventId, slug] of [
    [EVENT_A, "list-event-a"],
    [EVENT_B, "list-event-b"],
  ] as const) {
    await prisma.event.create({
      data: {
        id: eventId,
        organization_id: "org-list",
        title: `List ${slug}`,
        slug,
        date: new Date("2026-09-01"),
      },
    });
  }

  await setMailSettings(
    { scopeType: "organization", scopeId: "org-list" },
    { provider: "export_only", fromAddress: "events@example.com" },
    prisma,
  );

  await prisma.attendee.create({
    data: {
      id: "att-list-a",
      event_id: EVENT_A,
      email: "alice@example.com",
      name: "Alice Example",
    },
  });
  await prisma.attendee.create({
    data: {
      id: "att-list-b",
      event_id: EVENT_B,
      email: "bob@example.com",
      name: "Bob Example",
    },
  });

  exported.length = 0;
  await sendTicketEmails(
    EVENT_A,
    { deliverImmediately: true, attendeeIds: ["att-list-a"] },
    prisma,
    { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
    { exportSink: (p) => exported.push(p) },
  );
  await sendTicketEmails(
    EVENT_B,
    { deliverImmediately: true, attendeeIds: ["att-list-b"] },
    prisma,
    { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
    { exportSink: (p) => exported.push(p) },
  );

  // A resend to an address other than the attendee's own profile email - the row search must
  // still find it by the address actually shown in the log, not just the attendee's current
  // name/email.
  await prisma.emailDelivery.create({
    data: {
      id: "dlv-list-a-forwarded",
      organization_id: "org-list",
      event_id: EVENT_A,
      attendee_id: "att-list-a",
      purpose: "resend",
      provider: "export_only",
      status: "sent",
      recipient_email: "alice-forwarded@example.org",
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("listDeliveries", () => {
  it("returns safe fields scoped to event_id", async () => {
    const { items: rows, total } = await listDeliveries({ eventId: EVENT_A }, prisma);

    expect(total).toBeGreaterThanOrEqual(1);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r.attendee_id === "att-list-a")).toBe(true);

    for (const row of rows) {
      expect(row).toHaveProperty("id");
      expect(row).toHaveProperty("status");
      expect(row).toHaveProperty("provider");
      expect(row).toHaveProperty("recipient_email");
      expect(row).toHaveProperty("rendered_subject");
      expect(row).toHaveProperty("error_code");
      expect(row).not.toHaveProperty("rendered_html");
    }
  });

  it("does not return deliveries from other events", async () => {
    const { items: rowsA } = await listDeliveries({ eventId: EVENT_A }, prisma);
    const { items: rowsB } = await listDeliveries({ eventId: EVENT_B }, prisma);

    expect(rowsA.some((r) => r.attendee_id === "att-list-b")).toBe(false);
    expect(rowsB.some((r) => r.attendee_id === "att-list-a")).toBe(false);
    expect(rowsB.some((r) => r.attendee_id === "att-list-b")).toBe(true);
  });

  it("filters by status", async () => {
    const { items: accepted } = await listDeliveries(
      { eventId: EVENT_A, filters: { status: "accepted" } },
      prisma,
    );
    expect(accepted.length).toBeGreaterThanOrEqual(1);
    expect(accepted.every((r) => r.status === "accepted")).toBe(true);

    const { items: failed } = await listDeliveries(
      { eventId: EVENT_A, filters: { status: "failed" } },
      prisma,
    );
    expect(failed).toHaveLength(0);
  });

  it("filters by purpose", async () => {
    const { items: initial } = await listDeliveries(
      { eventId: EVENT_A, filters: { purpose: "initial" } },
      prisma,
    );
    expect(initial.length).toBeGreaterThanOrEqual(1);
    expect(initial.every((r) => r.purpose === "initial")).toBe(true);
  });

  it("supports skip/take pagination", async () => {
    const page1 = await listDeliveries({ eventId: EVENT_A, skip: 0, take: 1 }, prisma);
    const page2 = await listDeliveries({ eventId: EVENT_A, skip: 1, take: 1 }, prisma);

    expect(page1.total).toBeGreaterThanOrEqual(page1.items.length);
    if (page1.total > 1) {
      expect(page1.items[0]?.id).not.toBe(page2.items[0]?.id);
    }
  });

  it("filters by attendeeId", async () => {
    const { items } = await listDeliveries(
      { eventId: EVENT_A, filters: { attendeeId: "att-list-a" } },
      prisma,
    );
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.every((r) => r.attendee_id === "att-list-a")).toBe(true);

    const { items: none } = await listDeliveries(
      { eventId: EVENT_A, filters: { attendeeId: "att-does-not-exist" } },
      prisma,
    );
    expect(none).toHaveLength(0);
  });

  it("filters by templateId, including null for the built-in default ticket template", async () => {
    const { items } = await listDeliveries(
      { eventId: EVENT_A, filters: { templateId: null } },
      prisma,
    );
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.every((r) => r.template_id === null)).toBe(true);

    const { items: none } = await listDeliveries(
      { eventId: EVENT_A, filters: { templateId: "tmpl-does-not-exist" } },
      prisma,
    );
    expect(none).toHaveLength(0);
  });

  it("keeps the sent-with template's label after that template is deleted, and excludes the row from the default filter", async () => {
    const template = await prisma.mailTemplate.create({
      data: {
        scope_type: "event",
        scope_id: EVENT_A,
        name: "vip-list-a",
        label: "VIP invite (list)",
        subject_template: "Subject",
        body_template: "<p>Body</p>",
        template_format: "html",
        compiled_html_template: "<p>Body</p>",
      },
    });
    const delivery = await prisma.emailDelivery.create({
      data: {
        id: "dlv-list-a-deleted-template",
        organization_id: "org-list",
        event_id: EVENT_A,
        attendee_id: "att-list-a",
        purpose: "resend",
        provider: "export_only",
        status: "sent",
        template_id: template.id,
        template_label_snapshot: template.label,
      },
    });

    // Deleting the template SetNulls template_id (see schema.prisma) - the snapshot must survive
    // this, so the row stays distinguishable from a genuine default-template send.
    await prisma.mailTemplate.delete({ where: { id: template.id } });

    const { items } = await listDeliveries({ eventId: EVENT_A }, prisma);
    const row = items.find((r) => r.id === delivery.id);
    expect(row).toBeDefined();
    expect(row!.template_id).toBeNull();
    expect(row!.template_name).toBe("VIP invite (list)");

    const { items: defaultItems } = await listDeliveries(
      { eventId: EVENT_A, filters: { templateId: null } },
      prisma,
    );
    expect(defaultItems.some((r) => r.id === delivery.id)).toBe(false);
  });

  it("filters by search (case-insensitive attendee name/email match)", async () => {
    const { items: byName } = await listDeliveries(
      { eventId: EVENT_A, filters: { search: "ALICE" } },
      prisma,
    );
    expect(byName.length).toBeGreaterThanOrEqual(1);
    expect(byName.every((r) => r.attendee_id === "att-list-a")).toBe(true);

    const { items: byEmail } = await listDeliveries(
      { eventId: EVENT_A, filters: { search: "alice@example" } },
      prisma,
    );
    expect(byEmail.length).toBeGreaterThanOrEqual(1);

    const { items: noMatch } = await listDeliveries(
      { eventId: EVENT_A, filters: { search: "nobody-matches-this" } },
      prisma,
    );
    expect(noMatch).toHaveLength(0);
  });

  it("also matches a delivery's own recipient_email, e.g. a resend to a different address than the attendee's profile email", async () => {
    const { items } = await listDeliveries(
      { eventId: EVENT_A, filters: { search: "alice-forwarded@example.org" } },
      prisma,
    );
    expect(items.map((r) => r.id)).toEqual(["dlv-list-a-forwarded"]);
  });
});

describe("getDeliveryWithTimeline", () => {
  it("returns the delivery detail plus its attendee's timeline, oldest first", async () => {
    const { items } = await listDeliveries({ eventId: EVENT_A }, prisma);
    const target = items[0]!;

    const result = await getDeliveryWithTimeline({ eventId: EVENT_A, id: target.id }, prisma);

    expect(result).not.toBeNull();
    expect(result!.entry.id).toBe(target.id);
    expect(result!.entry).toHaveProperty("batch_id");
    expect(result!.entry).toHaveProperty("actor_user_id");
    expect(result!.entry).toHaveProperty("session_id");
    expect(result!.timeline.length).toBeGreaterThanOrEqual(1);
    expect(result!.timeline.some((t) => t.id === target.id)).toBe(true);
    // Oldest-first: each row's queued_at is <= the next one's.
    for (let i = 1; i < result!.timeline.length; i++) {
      expect(result!.timeline[i - 1]!.queued_at.getTime()).toBeLessThanOrEqual(
        result!.timeline[i]!.queued_at.getTime(),
      );
    }
  });

  it("returns null for an unknown id", async () => {
    const result = await getDeliveryWithTimeline({ eventId: EVENT_A, id: "dlv-does-not-exist" }, prisma);
    expect(result).toBeNull();
  });

  it("returns null for a cross-tenant id (right delivery, wrong event)", async () => {
    const { items } = await listDeliveries({ eventId: EVENT_B }, prisma);
    const bDeliveryId = items[0]!.id;

    const result = await getDeliveryWithTimeline({ eventId: EVENT_A, id: bDeliveryId }, prisma);
    expect(result).toBeNull();
  });
});

describe("getRenderedDelivery", () => {
  it("returns the stored subject/html snapshot for a known delivery", async () => {
    const { items } = await listDeliveries({ eventId: EVENT_A }, prisma);
    const target = items[0]!;

    const result = await getRenderedDelivery({ eventId: EVENT_A, id: target.id }, prisma);

    expect(result).not.toBeNull();
    expect(result).toHaveProperty("rendered_subject");
    expect(result).toHaveProperty("rendered_html");
  });

  it("returns null for an unknown id", async () => {
    const result = await getRenderedDelivery({ eventId: EVENT_A, id: "dlv-does-not-exist" }, prisma);
    expect(result).toBeNull();
  });
});
