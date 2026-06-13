import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setMailSettings } from "@admitto/mailer-config";
import type { ExportPayload } from "@admitto/mailer";
import { resetDb } from "./resetDb.js";
import { listDeliveries } from "../src/listDeliveries.js";
import { sendTicketEmails } from "../src/index.js";

const prisma = new PrismaClient();
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
    { attendeeIds: ["att-list-a"] },
    prisma,
    { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
    { exportSink: (p) => exported.push(p) },
  );
  await sendTicketEmails(
    EVENT_B,
    { attendeeIds: ["att-list-b"] },
    prisma,
    { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
    { exportSink: (p) => exported.push(p) },
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("listDeliveries", () => {
  it("returns safe fields scoped to event_id", async () => {
    const rows = await listDeliveries({ eventId: EVENT_A }, prisma);

    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r.attendee_id === "att-list-a")).toBe(true);

    for (const row of rows) {
      expect(row).toHaveProperty("id");
      expect(row).toHaveProperty("status");
      expect(row).toHaveProperty("provider");
      expect(row).toHaveProperty("recipient_email");
      expect(row).not.toHaveProperty("rendered_html");
      expect(row).not.toHaveProperty("rendered_subject");
    }
  });

  it("does not return deliveries from other events", async () => {
    const rowsA = await listDeliveries({ eventId: EVENT_A }, prisma);
    const rowsB = await listDeliveries({ eventId: EVENT_B }, prisma);

    expect(rowsA.some((r) => r.attendee_id === "att-list-b")).toBe(false);
    expect(rowsB.some((r) => r.attendee_id === "att-list-a")).toBe(false);
    expect(rowsB.some((r) => r.attendee_id === "att-list-b")).toBe(true);
  });

  it("filters by status", async () => {
    const accepted = await listDeliveries(
      { eventId: EVENT_A, filters: { status: "accepted" } },
      prisma,
    );
    expect(accepted.length).toBeGreaterThanOrEqual(1);
    expect(accepted.every((r) => r.status === "accepted")).toBe(true);

    const failed = await listDeliveries(
      { eventId: EVENT_A, filters: { status: "failed" } },
      prisma,
    );
    expect(failed).toHaveLength(0);
  });

  it("filters by purpose", async () => {
    const initial = await listDeliveries(
      { eventId: EVENT_A, filters: { purpose: "initial" } },
      prisma,
    );
    expect(initial.length).toBeGreaterThanOrEqual(1);
    expect(initial.every((r) => r.purpose === "initial")).toBe(true);
  });
});
