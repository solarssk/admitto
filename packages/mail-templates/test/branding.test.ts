import { PrismaClient } from "@prisma/client";
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

const prisma = new PrismaClient();

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
      location: "Gdansk",
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
  it("rejects non-http(s) URLs", async () => {
    await expect(
      setBranding(
        { scopeType: "organization", scopeId: "org-br" },
        { logoUrl: "ftp://bad.example/logo.png" },
        prisma,
      ),
    ).rejects.toThrow("Logo URL must be a full http:// or https:// URL.");
  });

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

    const result = await previewTemplate("evt-br", prisma);
    expect(result.subject).toContain("Brand Event");
    expect(result.html).toContain("Alex");
    expect(result.html).toMatch(/@example\.com/i);
  });
});
