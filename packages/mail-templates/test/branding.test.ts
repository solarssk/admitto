import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  previewTemplate,
  renderTemplate,
  resolveBranding,
  setBranding,
  setMailTemplate,
  InvalidHttpUrlError,
} from "../src/index.js";
import { resetDb } from "./resetDb.js";

const prisma = createTestPrismaClient();

beforeAll(() => {
  resetDb();
});

beforeAll(async () => {
  await prisma.organization.create({
    data: {
      id: "org-br",
      name: "Brand Org",
      slug: "brand-org",
      logo_url: "https://cdn.example.com/org-logo.png",
    },
  });
  await prisma.event.create({
    data: {
      id: "evt-br",
      organization_id: "org-br",
      title: "Brand Event",
      slug: "brand-event",
      date: new Date("2026-10-01"),
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("resolveBranding", () => {
  it("falls back org logo when event has none", async () => {
    const branding = await resolveBranding("evt-br", prisma);
    expect(branding.logo_url).toBe("https://cdn.example.com/org-logo.png");
    expect(branding.header_image_url).toBe("");
  });

  it("prefers event logo over org", async () => {
    await prisma.event.update({
      where: { id: "evt-br" },
      data: { logo_url: "https://cdn.example.com/event-logo.png" },
    });
    const branding = await resolveBranding("evt-br", prisma);
    expect(branding.logo_url).toBe("https://cdn.example.com/event-logo.png");
  });
});

describe("setBranding", () => {
  it("updates only fields provided in partial input", async () => {
    await prisma.organization.update({
      where: { id: "org-br" },
      data: {
        logo_url: "https://cdn.example.com/org-logo.png",
        header_image_url: "https://cdn.example.com/org-header.png",
      },
    });

    await setBranding(
      { scopeType: "organization", scopeId: "org-br" },
      { logoUrl: "https://cdn.example.com/new-logo.png" },
      prisma,
    );

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: "org-br" } });
    expect(org.logo_url).toBe("https://cdn.example.com/new-logo.png");
    expect(org.header_image_url).toBe("https://cdn.example.com/org-header.png");
  });

  it("rejects non-http(s) URLs", async () => {
    await expect(
      setBranding(
        { scopeType: "organization", scopeId: "org-br" },
        { logoUrl: "ftp://bad.example/logo.png" },
        prisma,
      ),
    ).rejects.toThrow(/Logo URL must be a full http:\/\/ or https:\/\/ URL/);
  });

  it("accepts local upload paths for logo_url", async () => {
    await setBranding(
      { scopeType: "organization", scopeId: "org-br" },
      { logoUrl: "/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png" },
      prisma,
    );

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: "org-br" } });
    expect(org.logo_url).toBe("/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png");
  });

  it("renders uploaded logo as absolute URL when baseUrl is provided", () => {
    const html = renderTemplate(
      {
        subject: "T",
        compiledHtml: '<img src="{{logo_url}}" alt="Logo" width="120" height="40" />',
      },
      { logo_url: "/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png" },
      { baseUrl: "https://tickets.example.com" },
    );
    expect(html.html).toContain(
      'src="https://tickets.example.com/uploads/default/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png"',
    );
  });
});

describe("empty logo in custom template", () => {
  it("never produces src=\"\" when logo_url is empty", async () => {
    const html = renderTemplate(
      {
        subject: "T",
        compiledHtml: '<img src="{{logo_url}}" alt="Logo" width="120" height="40" />',
      },
      { logo_url: "" },
    );
    expect(html.html).not.toMatch(/src\s*=\s*""/);
  });
});

describe("previewTemplate", () => {
  it("returns subject and html with @example.com sample data", async () => {
    await setMailTemplate(
      { scopeType: "event", scopeId: "evt-br" },
      {
        subject: "Your ticket for {{event_name}}",
        body: "<p>Hi {{first_name}} — {{email}}</p>",
        format: "html",
      },
      prisma,
    );

    const result = await previewTemplate("evt-br", prisma, undefined, {
      baseUrl: "https://tickets.example.com",
    });
    expect(result.subject).toContain("Brand Event");
    expect(result.html).toContain("Alex");
    expect(result.html).toMatch(/@example\.com/i);
  });

  it("renders location and map vars when the event has a saved pin", async () => {
    await prisma.eventLocation.create({
      data: {
        event_id: "evt-br",
        venue_name: "Sample venue",
        formatted_address: "Example Street 1, Warsaw",
        latitude: 52.2297,
        longitude: 21.0122,
        directions_text: "Use the main entrance.",
        accessibility_text: "Step-free access is available.",
      },
    });
    await setMailTemplate(
      { scopeType: "event", scopeId: "evt-br" },
      {
        subject: "{{event_location}}",
        body:
          '<img src="{{event_map_url}}" alt="Map" /><p>{{event_address}}</p><p>{{directions_text}}</p><p>{{accessibility_text}}</p><a href="{{google_maps_url}}">Google</a><a href="{{apple_maps_url}}">Apple</a>',
        format: "html",
      },
      prisma,
    );

    const result = await previewTemplate("evt-br", prisma, undefined, {
      baseUrl: "https://tickets.example.com/",
    });
    expect(result.subject).toBe("Sample venue");
    expect(result.html).toContain('src="https://tickets.example.com/m/evt-br.png?v=4_52.229700_21.012200_z15"');
    expect(result.html).toContain("Example Street 1, Warsaw");
    expect(result.html).toContain("Use the main entrance.");
    expect(result.html).toContain("Step-free access is available.");
    expect(result.html).toContain("https://www.google.com/maps/search/");
    expect(result.html).toContain("https://maps.apple.com/");
  });

  it("requires BASE_URL outside development when resolving preview base URL", async () => {
    await expect(
      previewTemplate("evt-br", prisma, undefined, { env: { NODE_ENV: "production" } }),
    ).rejects.toThrow("BASE_URL is required in non-development environments");
  });
});
