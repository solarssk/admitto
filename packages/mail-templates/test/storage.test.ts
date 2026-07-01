import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getBuiltinTemplate,
  resolveTemplate,
  setMailTemplate,
  UnknownPlaceholdersError,
  MjmlCompileError,
} from "../src/index.js";
import { resetDb } from "./resetDb.js";

const prisma = new PrismaClient();

const VALID_MJML = `<mjml><mj-body><mj-section><mj-column><mj-text>{{event_name}} — {{first_name}}</mj-text></mj-column></mj-section></mj-body></mjml>`;

beforeAll(() => {
  resetDb();
});

beforeAll(async () => {
  await prisma.organization.create({
    data: { id: "org-mt", name: "MT Org", slug: "mt-org" },
  });
  await prisma.event.create({
    data: {
      id: "evt-mt",
      organization_id: "org-mt",
      title: "MT Event",
      slug: "mt-event",
      date: new Date("2026-09-15"),
      location: "Krakow",
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("getBuiltinTemplate", () => {
  it("compiles and passes whitelist validation", async () => {
    const builtin = await getBuiltinTemplate();
    expect(builtin.source).toBe("builtin");
    expect(builtin.compiledHtmlTemplate).toContain("{{ticket_url}}");
    expect(builtin.compiledHtmlTemplate.toLowerCase()).toContain("<table");
  });
});

describe("resolveTemplate", () => {
  it("returns builtin when no scoped rows exist", async () => {
    const resolved = await resolveTemplate("evt-mt", prisma);
    expect(resolved.source).toBe("builtin");
  });

  it("prefers organization template over builtin", async () => {
    await setMailTemplate(
      { scopeType: "organization", scopeId: "org-mt" },
      { subject: "Org {{event_name}}", body: VALID_MJML, format: "mjml" },
      prisma,
    );

    const resolved = await resolveTemplate("evt-mt", prisma);
    expect(resolved.source).toBe("organization");
    expect(resolved.subjectTemplate).toBe("Org {{event_name}}");
  });

  it("prefers event template over organization", async () => {
    await setMailTemplate(
      { scopeType: "event", scopeId: "evt-mt" },
      { subject: "Event {{event_name}}", body: VALID_MJML, format: "mjml" },
      prisma,
    );

    const resolved = await resolveTemplate("evt-mt", prisma);
    expect(resolved.source).toBe("event");
    expect(resolved.subjectTemplate).toBe("Event {{event_name}}");
    expect(resolved.templateId).toBeDefined();
  });
});

describe("setMailTemplate", () => {
  it("rejects unknown placeholders before compile", async () => {
    await expect(
      setMailTemplate(
        { scopeType: "event", scopeId: "evt-mt" },
        {
          subject: "{{not_allowed}}",
          body: VALID_MJML,
          format: "mjml",
        },
        prisma,
      ),
    ).rejects.toThrow(UnknownPlaceholdersError);
  });

  it("rejects invalid MJML", async () => {
    await expect(
      setMailTemplate(
        { scopeType: "event", scopeId: "evt-mt" },
        {
          subject: "{{event_name}}",
          body: "<mjml><mj-broken /></mjml>",
          format: "mjml",
        },
        prisma,
      ),
    ).rejects.toThrow(MjmlCompileError);
  });

  it("accepts MJML mj-button with ticket_url placeholder after compile", async () => {
    const body = `<mjml><mj-body><mj-section><mj-column>
      <mj-button href="{{ticket_url}}">View ticket</mj-button>
      <mj-image src="{{qr_image_url}}" alt="QR" width="200px" />
    </mj-column></mj-section></mj-body></mjml>`;

    await setMailTemplate(
      { scopeType: "organization", scopeId: "org-mt" },
      {
        subject: "{{event_name}}",
        body,
        format: "mjml",
      },
      prisma,
    );

    const row = await prisma.mailTemplate.findUniqueOrThrow({
      where: {
        scope_type_scope_id_name: { scope_type: "organization", scope_id: "org-mt", name: "ticket" },
      },
    });
    expect(row.compiled_html_template).toContain('href="{{ticket_url}}"');
  });

  it("stores compiled_html_template on save", async () => {
    await setMailTemplate(
      { scopeType: "event", scopeId: "evt-mt" },
      {
        subject: "Saved {{event_name}}",
        body: VALID_MJML,
        format: "mjml",
      },
      prisma,
    );

    const row = await prisma.mailTemplate.findUniqueOrThrow({
      where: {
        scope_type_scope_id_name: { scope_type: "event", scope_id: "evt-mt", name: "ticket" },
      },
    });
    expect(row.compiled_html_template).toContain("{{first_name}}");
    expect(row.compiled_html_template.toLowerCase()).toContain("<table");
    expect(row.body_template).toBe(VALID_MJML);
  });
});
