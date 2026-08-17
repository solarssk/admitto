import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as mailer from "@admitto/mailer";
import { encryptToString } from "@admitto/crypto";
import { setMailSettings } from "@admitto/mailer-config";
import type { ExportPayload } from "@admitto/mailer";
import { hashToken, generateToken } from "@admitto/tickets";
import { resetDb } from "./resetDb.js";
import {
  resendTicketEmail,
  retryDelivery,
  sendTicketEmails,
} from "../src/index.js";

const prisma = createTestPrismaClient();
const EVENT_ID = "evt-mail-send";
const exported: ExportPayload[] = [];

beforeAll(async () => {
  await resetDb();
  await prisma.organization.create({
    data: { id: "org-mail", name: "Mail Org", slug: "mail-org" },
  });
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      organization_id: "org-mail",
      title: "Mail Event",
      slug: "mail-event",
      date: new Date("2026-09-01"),
    },
  });

  await setMailSettings(
    { scopeType: "organization", scopeId: "org-mail" },
    { provider: "export_only", fromAddress: "events@example.com" },
    prisma,
  );

  await prisma.attendee.create({
    data: {
      id: "att-mode-a",
      event_id: EVENT_ID,
      email: "alice@example.com",
      name: "Alice Example",
    },
  });
  await prisma.attendee.create({
    data: {
      id: "att-mode-b-url",
      event_id: EVENT_ID,
      email: "bob@example.com",
      name: "Bob Agency",
      external_uuid: "https://agency.example.com/t/xyz",
      public_ref: generateToken(),
    },
  });
  await prisma.attendee.create({
    data: {
      id: "att-mode-b-qr",
      event_id: EVENT_ID,
      email: "carol@example.com",
      name: "Carol Agency",
      qr_payload: "AGENCY-PAYLOAD-001",
      public_ref: generateToken(),
    },
  });
}, 60_000);

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sendTicketEmails name fields", () => {
  // Own event, isolated from EVENT_ID's fixed 3-attendee count assertions elsewhere in this file.
  const NAME_FIELDS_EVENT_ID = "evt-mail-send-name-fields";

  beforeAll(async () => {
    await prisma.event.create({
      data: {
        id: NAME_FIELDS_EVENT_ID,
        organization_id: "org-mail",
        title: "Mail Event (name fields)",
        slug: "mail-event-name-fields",
        date: new Date("2026-09-01"),
      },
    });
  });

  it("uses first_name/last_name directly when set, instead of splitting name", async () => {
    // "Zhang Wei" naively splits to first_name="Zhang" (actually the family name) - explicit
    // fields must win over that guess. If the send path fell back to splitDisplayName(name)
    // here, the greeting would read "Hi Zhang," instead.
    await prisma.attendee.create({
      data: {
        id: "att-explicit-name-fields",
        event_id: NAME_FIELDS_EVENT_ID,
        email: "wei@example.com",
        name: "Zhang Wei",
        first_name: "Wei",
        last_name: "Zhang",
      },
    });
    exported.length = 0;

    await sendTicketEmails(
      NAME_FIELDS_EVENT_ID,
      { deliverImmediately: true, attendeeIds: ["att-explicit-name-fields"] },
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: (p) => exported.push(p) },
    );

    const weiExport = exported.find((p) => p.message.to === "wei@example.com");
    expect(weiExport?.message.html).toContain("Hi Wei,");
    expect(weiExport?.message.html).not.toContain("Hi Zhang,");
  });

  it("uses the real field even when only last_name is set (first_name still null)", async () => {
    // Reachable via a PATCH that only touches last_name on an attendee whose first_name was
    // never migrated - computePatchChanges (attendees-api-routes.ts) allows that. Must still
    // use the real last_name, not fall back to splitting name.
    await prisma.attendee.create({
      data: {
        id: "att-last-name-only",
        event_id: NAME_FIELDS_EVENT_ID,
        email: "partial@example.com",
        name: "Partial Example",
        last_name: "RealLastName",
      },
    });
    exported.length = 0;

    await sendTicketEmails(
      NAME_FIELDS_EVENT_ID,
      { deliverImmediately: true, attendeeIds: ["att-last-name-only"] },
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: (p) => exported.push(p) },
    );

    const partialExport = exported.find((p) => p.message.to === "partial@example.com");
    expect(partialExport?.message.html).not.toContain("Hi Partial,");
  });

  it("uses the real field even when only first_name is set (last_name still null)", async () => {
    // Mirror of the last_name-only case above: reachable via a PATCH that only touches
    // first_name. last_name must fall back to "" here, not to a value split out of name.
    await prisma.attendee.create({
      data: {
        id: "att-first-name-only",
        event_id: NAME_FIELDS_EVENT_ID,
        email: "onlyfirst@example.com",
        name: "Only First",
        first_name: "RealFirstName",
      },
    });
    exported.length = 0;

    await sendTicketEmails(
      NAME_FIELDS_EVENT_ID,
      { deliverImmediately: true, attendeeIds: ["att-first-name-only"] },
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: (p) => exported.push(p) },
    );

    const onlyFirstExport = exported.find((p) => p.message.to === "onlyfirst@example.com");
    expect(onlyFirstExport?.message.html).toContain("Hi RealFirstName,");
  });

  it("falls back to splitting name when first_name/last_name are still null (un-migrated attendee)", async () => {
    await prisma.attendee.create({
      data: {
        id: "att-null-name-fields",
        event_id: NAME_FIELDS_EVENT_ID,
        email: "dana@example.com",
        name: "Dana Example",
      },
    });
    exported.length = 0;

    await sendTicketEmails(
      NAME_FIELDS_EVENT_ID,
      { deliverImmediately: true, attendeeIds: ["att-null-name-fields"] },
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: (p) => exported.push(p) },
    );

    const danaExport = exported.find((p) => p.message.to === "dana@example.com");
    expect(danaExport?.message.html).toContain("Hi Dana,");
  });
});

describe("sendTicketEmails", () => {
  it("sends ticket emails and creates EmailDelivery rows", async () => {
    exported.length = 0;
    const result = await sendTicketEmails(
      EVENT_ID,
      { deliverImmediately: true },
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: (p) => exported.push(p) },
    );

    expect(result.sent).toBe(3);
    expect(exported).toHaveLength(3);

    const deliveries = await prisma.emailDelivery.findMany({
      where: { event_id: EVENT_ID, purpose: "initial" },
    });
    expect(deliveries).toHaveLength(3);
    expect(deliveries.every((d) => d.status === "accepted")).toBe(true);

    const modeA = deliveries.find((d) => d.attendee_id === "att-mode-a");
    expect(modeA?.rendered_html).toContain("{{ticket_url}}");
    expect(modeA?.rendered_html).toContain("{{qr_image_url}}");
    expect(modeA?.rendered_html).not.toMatch(/\/t\/[A-Za-z0-9_-]{20,}/);

    const aliceExport = exported.find((p) => p.message.to === "alice@example.com");
    expect(aliceExport?.message.html).toMatch(/\/t\/[A-Za-z0-9_-]{20,}/);
    expect(aliceExport?.message.html).toContain("https://tickets.example.com");
  });

  it("renders saved event location and map tokens", async () => {
    await prisma.eventLocation.create({
      data: {
        event_id: EVENT_ID,
        venue_name: "Mail venue",
        formatted_address: "Example Street 1, Warsaw",
        latitude: 52.2297,
        longitude: 21.0122,
        directions_text: "Enter through gate A.",
        accessibility_text: "A step-free entrance is available.",
      },
    });
    const template = await prisma.mailTemplate.create({
      data: {
        scope_type: "event",
        scope_id: EVENT_ID,
        name: "location",
        label: "Location",
        subject_template: "{{event_location}}",
        body_template: "<p>{{event_address}}</p>",
        compiled_html_template:
          '<img src="{{event_map_url}}" alt="Map" /><p>{{event_address}}</p><p>{{directions_text}}</p><p>{{accessibility_text}}</p><a href="{{google_maps_url}}">Google</a><a href="{{apple_maps_url}}">Apple</a>',
        template_format: "html",
      },
    });
    await prisma.attendee.create({
      data: {
        id: "att-location",
        event_id: EVENT_ID,
        email: "location@example.com",
        name: "Location Example",
      },
    });

    exported.length = 0;
    const result = await sendTicketEmails(
      EVENT_ID,
      { deliverImmediately: true, attendeeIds: ["att-location"], templateId: template.id },
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: (p) => exported.push(p) },
    );

    expect(result.sent).toBe(1);
    expect(exported[0]?.message.subject).toBe("Mail venue");
    expect(exported[0]?.message.html).toContain(
      'src="https://tickets.example.com/m/evt-mail-send.png?v=9_52.229700_21.012200_z15"',
    );
    expect(exported[0]?.message.html).toContain("Example Street 1, Warsaw");
    expect(exported[0]?.message.html).toContain("Enter through gate A.");
    expect(exported[0]?.message.html).toContain("A step-free entrance is available.");
    expect(exported[0]?.message.html).toContain("https://www.google.com/maps/search/");
    expect(exported[0]?.message.html).toContain("https://maps.apple.com/");
  });

  it("omits event_map_url when LOCATION_MAPS_ENABLED=false despite a saved pin", async () => {
    await prisma.eventLocation.upsert({
      where: { event_id: EVENT_ID },
      create: {
        event_id: EVENT_ID,
        venue_name: "Mail venue",
        formatted_address: "Example Street 1, Warsaw",
        latitude: 52.2297,
        longitude: 21.0122,
      },
      update: {
        venue_name: "Mail venue",
        latitude: 52.2297,
        longitude: 21.0122,
      },
    });
    const template = await prisma.mailTemplate.create({
      data: {
        scope_type: "event",
        scope_id: EVENT_ID,
        name: "location-maps-off",
        label: "Location maps off",
        subject_template: "{{event_location}}",
        body_template: "<p>{{event_address}}</p>",
        compiled_html_template: '<img src="{{event_map_url}}" alt="Map" />',
        template_format: "html",
      },
    });
    await prisma.attendee.create({
      data: {
        id: "att-maps-off",
        event_id: EVENT_ID,
        email: "maps-off@example.com",
        name: "Maps Off",
      },
    });

    exported.length = 0;
    const result = await sendTicketEmails(
      EVENT_ID,
      { deliverImmediately: true, attendeeIds: ["att-maps-off"], templateId: template.id },
      prisma,
      {
        NODE_ENV: "test",
        BASE_URL: "https://tickets.example.com",
        LOCATION_MAPS_ENABLED: "false",
      },
      { exportSink: (p) => exported.push(p) },
    );

    expect(result.sent).toBe(1);
    // Empty optional URL placeholders omit the attribute entirely (no src="").
    expect(exported[0]?.message.html).toContain("<img alt=\"Map\" />");
    expect(exported[0]?.message.html).not.toContain("/m/evt-mail-send.png");
  });

  it("second initial send to an already-ticketed attendee resends instead of being skipped", async () => {
    exported.length = 0;
    const result = await sendTicketEmails(
      EVENT_ID,
      { deliverImmediately: true, attendeeIds: ["att-mode-a"] },
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: (p) => exported.push(p) },
    );
    expect(result.sent).toBe(1);
    expect(result.skipped).toHaveLength(0);
    expect(exported).toHaveLength(1);

    const rows = await prisma.emailDelivery.findMany({
      where: { attendee_id: "att-mode-a" },
      orderBy: { queued_at: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.purpose).toBe("initial");
    expect(rows[1]?.purpose).toBe("resend");
  });

  it("race: parallel initial sends produce one delivery for one attendee", async () => {
    await prisma.emailDelivery.deleteMany({ where: { attendee_id: "att-race" } });
    await prisma.attendee.create({
      data: {
        id: "att-race",
        event_id: EVENT_ID,
        email: "race@example.com",
        name: "Race Test",
      },
    });

    exported.length = 0;
    const env = { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" };
    const sink = { exportSink: (p: ExportPayload) => exported.push(p) };

    await Promise.all([
      sendTicketEmails(EVENT_ID, { deliverImmediately: true, attendeeIds: ["att-race"] }, prisma, env, sink),
      sendTicketEmails(EVENT_ID, { deliverImmediately: true, attendeeIds: ["att-race"] }, prisma, env, sink),
    ]);

    const rows = await prisma.emailDelivery.findMany({
      where: { attendee_id: "att-race", purpose: "initial" },
    });
    expect(rows).toHaveLength(1);
    expect(exported.length).toBeLessThanOrEqual(1);
  });

  it("skips agency attendee missing public_ref without aborting the batch", async () => {
    await prisma.emailDelivery.deleteMany({
      where: { attendee_id: { in: ["att-no-ref", "att-batch-ok"] } },
    });
    await prisma.attendee.deleteMany({ where: { id: { in: ["att-no-ref", "att-batch-ok"] } } });
    await prisma.attendee.createMany({
      data: [
        {
          id: "att-no-ref",
          event_id: EVENT_ID,
          email: "no-ref@example.com",
          name: "No Ref Agency",
          qr_payload: "AGENCY-MISSING-REF",
        },
        {
          id: "att-batch-ok",
          event_id: EVENT_ID,
          email: "batch-ok@example.com",
          name: "Batch OK",
        },
      ],
    });

    exported.length = 0;
    const result = await sendTicketEmails(
      EVENT_ID,
      { deliverImmediately: true, attendeeIds: ["att-no-ref", "att-batch-ok"] },
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: (p) => exported.push(p) },
    );

    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attendeeId: "att-no-ref",
          reason: expect.stringContaining("missing public_ref"),
        }),
      ]),
    );
    expect(result.sent).toBe(1);
    expect(exported).toHaveLength(1);
    expect(exported[0]?.message.to).toBe("batch-ok@example.com");
  });

  it("marks deliveries failed when sendBatch throws", async () => {
    await prisma.emailDelivery.deleteMany({ where: { attendee_id: "att-batch-fail" } });
    await prisma.attendee.create({
      data: {
        id: "att-batch-fail",
        event_id: EVENT_ID,
        email: "batch-fail@example.com",
        name: "Batch Fail",
      },
    });

    const spy = vi.spyOn(mailer, "sendBatch").mockRejectedValueOnce(new Error("transport down"));
    exported.length = 0;

    const result = await sendTicketEmails(
      EVENT_ID,
      { deliverImmediately: true, attendeeIds: ["att-batch-fail"] },
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: (p) => exported.push(p) },
    );

    expect(result.sent).toBe(0);
    expect(exported).toHaveLength(0);

    const row = await prisma.emailDelivery.findFirst({
      where: { attendee_id: "att-batch-fail", purpose: "initial" },
    });
    expect(row?.status).toBe("failed");
    expect(row?.retryable).toBe(true);
    expect(row?.error).toContain("transport down");

    spy.mockRestore();
  });

  it("rejects recipientEmail override unless exactly one attendee is targeted", async () => {
    await expect(
      sendTicketEmails(
        EVENT_ID,
        { deliverImmediately: true, purpose: "resend", attendeeIds: ["att-mode-a", "att-mode-b"], recipientEmail: "x@example.com" },
        prisma,
        { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      ),
    ).rejects.toThrow("recipientEmail requires exactly one attendeeId");
  });
});

describe("resendTicketEmail", () => {
  it("creates resend row with same links for Mode A", async () => {
    exported.length = 0;
    const before = await prisma.emailDelivery.count({
      where: { attendee_id: "att-mode-a", purpose: "resend" },
    });

    await resendTicketEmail(
      "att-mode-a",
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: (p) => exported.push(p) },
      { deliverImmediately: true },
    );

    const after = await prisma.emailDelivery.count({
      where: { attendee_id: "att-mode-a", purpose: "resend" },
    });
    expect(after).toBe(before + 1);
    expect(exported[0]?.message.html).toMatch(/\/t\/[A-Za-z0-9_-]{40,}/);

    const resendRow = await prisma.emailDelivery.findFirst({
      where: { attendee_id: "att-mode-a", purpose: "resend" },
      orderBy: { created_at: "desc" },
    });
    expect(resendRow?.rendered_html).toContain("{{ticket_url}}");
    expect(resendRow?.rendered_html).not.toMatch(/\/t\/[A-Za-z0-9_-]{20,}/);
  });

  it("uses alternate to without changing Attendee.email", async () => {
    exported.length = 0;
    const before = await prisma.attendee.findUniqueOrThrow({ where: { id: "att-mode-a" } });

    await resendTicketEmail(
      "att-mode-a",
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: (p) => exported.push(p) },
      { to: "alt@example.com", deliverImmediately: true },
    );

    const after = await prisma.attendee.findUniqueOrThrow({ where: { id: "att-mode-a" } });
    expect(after.email).toBe(before.email);

    const resendRow = await prisma.emailDelivery.findFirst({
      where: { attendee_id: "att-mode-a", purpose: "resend", recipient_email: "alt@example.com" },
      orderBy: { created_at: "desc" },
    });
    expect(resendRow?.recipient_email).toBe("alt@example.com");
    expect(exported[0]?.message.to).toBe("alt@example.com");
  });

  it("records the triggering admin's timezone when provided (Codecov review)", async () => {
    exported.length = 0;

    await resendTicketEmail(
      "att-mode-a",
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: (p) => exported.push(p) },
      { timezone: "Europe/Warsaw" },
    );

    const resendRow = await prisma.emailDelivery.findFirst({
      where: { attendee_id: "att-mode-a", purpose: "resend" },
      orderBy: { created_at: "desc" },
    });
    expect(resendRow?.client_timezone).toBe("Europe/Warsaw");
  });

  it("leaves client_timezone null when none is provided", async () => {
    exported.length = 0;

    await resendTicketEmail(
      "att-mode-a",
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: (p) => exported.push(p) },
    );

    const resendRow = await prisma.emailDelivery.findFirst({
      where: { attendee_id: "att-mode-a", purpose: "resend" },
      orderBy: { created_at: "desc" },
    });
    expect(resendRow?.client_timezone).toBeNull();
  });

  it("records the triggering admin's actor_user_id and session_id when provided", async () => {
    exported.length = 0;

    await resendTicketEmail(
      "att-mode-a",
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: (p) => exported.push(p) },
      { actorUserId: "user-resend-actor", sessionId: "session-resend-actor" },
    );

    const resendRow = await prisma.emailDelivery.findFirst({
      where: { attendee_id: "att-mode-a", purpose: "resend" },
      orderBy: { created_at: "desc" },
    });
    expect(resendRow?.actor_user_id).toBe("user-resend-actor");
    expect(resendRow?.session_id).toBe("session-resend-actor");
  });

  it("leaves actor_user_id and session_id null when none is provided", async () => {
    exported.length = 0;

    await resendTicketEmail(
      "att-mode-a",
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: (p) => exported.push(p) },
    );

    const resendRow = await prisma.emailDelivery.findFirst({
      where: { attendee_id: "att-mode-a", purpose: "resend" },
      orderBy: { created_at: "desc" },
    });
    expect(resendRow?.actor_user_id).toBeNull();
    expect(resendRow?.session_id).toBeNull();
  });

  it("resends a specific templateId when provided (Delivery log bounce Resend)", async () => {
    exported.length = 0;
    const template = await prisma.mailTemplate.create({
      data: {
        scope_type: "event",
        scope_id: EVENT_ID,
        name: `resend-specific-${Date.now()}`,
        label: "Resend specific",
        subject_template: "Specific {{first_name}}",
        body_template: "<p>Specific body {{ticket_url}}</p>",
        template_format: "html",
        compiled_html_template: "<p>Specific body {{ticket_url}}</p>",
      },
    });

    await resendTicketEmail(
      "att-mode-a",
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: (p) => exported.push(p) },
      { deliverImmediately: true, templateId: template.id },
    );

    const resendRow = await prisma.emailDelivery.findFirst({
      where: { attendee_id: "att-mode-a", purpose: "resend", template_id: template.id },
      orderBy: { created_at: "desc" },
    });
    expect(resendRow?.template_id).toBe(template.id);
    expect(exported[0]?.message.subject).toMatch(/^Specific /);
  });
});

describe("retryDelivery", () => {
  it("re-sends frozen snapshot without re-render", async () => {
    const token = "tok_retry_snapshot_abcdefghijklmnopqrstuvwxyz";
    const tokenEnc = encryptToString(token);
    await prisma.attendee.create({
      data: {
        id: "att-retry",
        event_id: EVENT_ID,
        email: "retry@example.com",
        name: "Retry User",
        token_hash: hashToken(token),
        token_enc: tokenEnc,
      },
    });

    const delivery = await prisma.emailDelivery.create({
      data: {
        organization_id: "org-mail",
        event_id: EVENT_ID,
        attendee_id: "att-retry",
        purpose: "initial",
        provider: "export_only",
        status: "failed",
        retryable: true,
        attempts: 1,
        recipient_email: "retry@example.com",
        rendered_subject: "Frozen Subject UNIQUE_MARKER",
        rendered_html: "<p>Frozen HTML UNIQUE_MARKER</p>",
      },
    });

    exported.length = 0;
    const { ok } = await retryDelivery(
      delivery.id,
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: (p) => exported.push(p) },
    );
    expect(ok).toBe(true);
    expect(exported[0]?.message.subject).toBe("Frozen Subject UNIQUE_MARKER");
    expect(exported[0]?.message.html).toContain("UNIQUE_MARKER");

    const updated = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(updated.status).toBe("accepted");
    expect(updated.attempts).toBe(2);
  });

  it("increments attempts when sendBatch returns no result", async () => {
    await prisma.attendee.create({
      data: {
        id: "att-retry-noresult",
        event_id: EVENT_ID,
        email: "noresult@example.com",
        name: "No Result",
        qr_payload: "AGENCY-NORESULT",
        public_ref: generateToken(),
      },
    });

    const delivery = await prisma.emailDelivery.create({
      data: {
        organization_id: "org-mail",
        event_id: EVENT_ID,
        attendee_id: "att-retry-noresult",
        purpose: "initial",
        provider: "export_only",
        status: "failed",
        retryable: true,
        attempts: 1,
        recipient_email: "noresult@example.com",
        rendered_subject: "S",
        rendered_html: '<a href="{{ticket_url}}">x</a>',
      },
    });

    const spy = vi.spyOn(mailer, "sendBatch").mockResolvedValueOnce({
      total: 1,
      sent: 0,
      failed: 1,
      results: [],
    });

    try {
      const { ok, reason } = await retryDelivery(
        delivery.id,
        prisma,
        { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
        { exportSink: (p) => exported.push(p) },
      );
      expect(ok).toBe(false);
      expect(reason).toBe("no_result");

      const bumped = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(bumped.attempts).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });

  it("materializes deferred ticket links from token_enc on retry", async () => {
    const token = "tok_retry_deferred_abcdefghijklmnopqrstuvwxyz";
    const tokenEnc = encryptToString(token);
    await prisma.attendee.create({
      data: {
        id: "att-retry-deferred",
        event_id: EVENT_ID,
        email: "retry-deferred@example.com",
        name: "Retry Deferred",
        token_hash: hashToken(token),
        token_enc: tokenEnc,
      },
    });

    const delivery = await prisma.emailDelivery.create({
      data: {
        organization_id: "org-mail",
        event_id: EVENT_ID,
        attendee_id: "att-retry-deferred",
        purpose: "initial",
        provider: "export_only",
        status: "failed",
        retryable: true,
        attempts: 1,
        recipient_email: "retry-deferred@example.com",
        rendered_subject: "Retry",
        rendered_html: '<a href="{{ticket_url}}">ticket</a>',
      },
    });

    exported.length = 0;
    const { ok } = await retryDelivery(
      delivery.id,
      prisma,
      { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" },
      { exportSink: (p) => exported.push(p) },
    );
    expect(ok).toBe(true);
    expect(exported[0]?.message.html).toContain(`/t/${token}`);
    expect(exported[0]?.message.html).not.toContain("{{ticket_url}}");
  });

  it("does not retry rejected deliveries", async () => {
    const delivery = await prisma.emailDelivery.create({
      data: {
        organization_id: "org-mail",
        event_id: EVENT_ID,
        attendee_id: "att-mode-a",
        purpose: "resend",
        provider: "export_only",
        status: "rejected",
        retryable: false,
        attempts: 1,
        recipient_email: "alice@example.com",
        rendered_subject: "S",
        rendered_html: "<p>x</p>",
      },
    });

    const { ok, reason } = await retryDelivery(delivery.id, prisma, {
      NODE_ENV: "test",
      BASE_URL: "https://tickets.example.com",
    });
    expect(ok).toBe(false);
    expect(reason).toBe("not_retryable");
  });

  it("records a clear error and does not throw when the stored mail secret cannot be decrypted", async () => {
    await prisma.organization.create({
      data: { id: "org-retry-decrypt", name: "Retry Decrypt Org", slug: "retry-decrypt-org" },
    });
    await prisma.event.create({
      data: {
        id: "evt-retry-decrypt",
        organization_id: "org-retry-decrypt",
        title: "Retry Decrypt Event",
        slug: "retry-decrypt-event",
        date: new Date("2026-09-01"),
      },
    });
    await setMailSettings(
      { scopeType: "organization", scopeId: "org-retry-decrypt" },
      {
        provider: "smtp",
        host: "smtp.example.com",
        port: 587,
        user: "retry@example.com",
        fromAddress: "retry@example.com",
        smtpPassword: "retry-pass",
      },
      prisma,
    );
    // Corrupt the stored ciphertext so it fails AES-GCM authentication at read time:
    // simulates a rotated/mismatched ENCRYPTION_KEY or a tampered/corrupted DB value.
    const settingsRow = await prisma.mailSettings.findUniqueOrThrow({
      where: {
        scope_type_scope_id: { scope_type: "organization", scope_id: "org-retry-decrypt" },
      },
    });
    const encoded = JSON.parse(settingsRow.smtp_password_enc!) as { ciphertext: string };
    const raw = Buffer.from(encoded.ciphertext, "base64");
    raw[0] ^= 0xff;
    encoded.ciphertext = raw.toString("base64");
    await prisma.mailSettings.update({
      where: {
        scope_type_scope_id: { scope_type: "organization", scope_id: "org-retry-decrypt" },
      },
      data: { smtp_password_enc: JSON.stringify(encoded) },
    });

    const token = "tok_retry_decrypt_abcdefghijklmnopqrstuvwxyz";
    await prisma.attendee.create({
      data: {
        id: "att-retry-decrypt",
        event_id: "evt-retry-decrypt",
        email: "retry-decrypt@example.com",
        name: "Retry Decrypt",
        token_hash: hashToken(token),
        token_enc: encryptToString(token),
      },
    });

    const delivery = await prisma.emailDelivery.create({
      data: {
        organization_id: "org-retry-decrypt",
        event_id: "evt-retry-decrypt",
        attendee_id: "att-retry-decrypt",
        purpose: "initial",
        provider: "smtp",
        status: "failed",
        retryable: true,
        attempts: 1,
        recipient_email: "retry-decrypt@example.com",
        rendered_subject: "S",
        rendered_html: "<p>x</p>",
      },
    });

    const { ok, reason } = await retryDelivery(delivery.id, prisma, {
      NODE_ENV: "test",
      BASE_URL: "https://tickets.example.com",
    });
    expect(ok).toBe(false);
    expect(reason).toBe("mail_secret_decryption_failed");

    const updated = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(updated.attempts).toBe(2);
    expect(updated.error).toContain("could not be decrypted");
  });

  it("rethrows non-MailConfigError failures from resolveMailConfig/createMailer", async () => {
    await prisma.organization.create({
      data: { id: "org-retry-unconfigured", name: "Retry Unconfigured Org", slug: "retry-unconfigured-org" },
    });
    await prisma.event.create({
      data: {
        id: "evt-retry-unconfigured",
        organization_id: "org-retry-unconfigured",
        title: "Retry Unconfigured Event",
        slug: "retry-unconfigured-event",
        date: new Date("2026-09-01"),
      },
    });
    // No MailSettings row for this org/event at all - resolveMailConfig throws a plain
    // Error ("Cannot resolve mail provider"), not a MailConfigError. retryDelivery must
    // propagate it unchanged instead of swallowing it into an { ok: false } result.

    const token = "tok_retry_unconfig_abcdefghijklmnopqrstuvwxyz";
    await prisma.attendee.create({
      data: {
        id: "att-retry-unconfigured",
        event_id: "evt-retry-unconfigured",
        email: "retry-unconfigured@example.com",
        name: "Retry Unconfigured",
        token_hash: hashToken(token),
        token_enc: encryptToString(token),
      },
    });

    const delivery = await prisma.emailDelivery.create({
      data: {
        organization_id: "org-retry-unconfigured",
        event_id: "evt-retry-unconfigured",
        attendee_id: "att-retry-unconfigured",
        purpose: "initial",
        provider: "smtp",
        status: "failed",
        retryable: true,
        attempts: 1,
        recipient_email: "retry-unconfigured@example.com",
        rendered_subject: "S",
        rendered_html: "<p>x</p>",
      },
    });

    await expect(
      retryDelivery(delivery.id, prisma, { NODE_ENV: "test", BASE_URL: "https://tickets.example.com" }),
    ).rejects.toThrow(/Cannot resolve mail provider/);

    const untouched = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(untouched.attempts).toBe(1);
  });
});
