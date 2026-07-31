import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createMailTemplate,
  findUnknownPlaceholders,
  previewTemplate,
  renderTemplate,
  resolveEventImageAssetVars,
  setMailTemplate,
  UnknownPlaceholdersError,
} from "../src/index.js";
import { resetDb } from "./resetDb.js";

const prisma = createTestPrismaClient();

beforeAll(async () => {
  await resetDb();
});

beforeAll(async () => {
  await prisma.organization.create({
    data: { id: "org-ia", name: "Asset Org", slug: "asset-org" },
  });
  await prisma.event.create({
    data: {
      id: "evt-ia",
      organization_id: "org-ia",
      title: "Asset Event",
      slug: "asset-event",
      date: new Date("2026-11-01"),
      location: "Krakow",
    },
  });
  await prisma.eventImageAsset.create({
    data: {
      event_id: "evt-ia",
      token: "sponsor_logo",
      filename: "sponsor.png",
      url: "/uploads/asset-org/events/evt-ia/sponsor.png",
      size_bytes: 1024,
      mime_type: "image/png",
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("resolveEventImageAssetVars", () => {
  it("returns an event's uploaded asset tokens as vars + a names set", async () => {
    const result = await resolveEventImageAssetVars("evt-ia", prisma);
    expect(result.vars).toEqual({
      sponsor_logo: "/uploads/asset-org/events/evt-ia/sponsor.png",
    });
    expect(result.names.has("sponsor_logo")).toBe(true);
  });

  it("returns empty vars/names for an event with no uploaded assets", async () => {
    await prisma.event.create({
      data: {
        id: "evt-ia-empty",
        organization_id: "org-ia",
        title: "Empty Asset Event",
        slug: "empty-asset-event",
        date: new Date("2026-11-02"),
      },
    });
    const result = await resolveEventImageAssetVars("evt-ia-empty", prisma);
    expect(result.vars).toEqual({});
    expect(result.names.size).toBe(0);
  });
});

describe("findUnknownPlaceholders with extraAllowed", () => {
  it("rejects a custom token without extraAllowed", () => {
    const unknown = findUnknownPlaceholders("Hi", "<p>{{sponsor_logo}}</p>");
    expect(unknown).toContain("sponsor_logo");
  });

  it("accepts a custom token when passed in extraAllowed", () => {
    const unknown = findUnknownPlaceholders(
      "Hi",
      '<img src="{{sponsor_logo}}" alt="Sponsor" />',
      new Set(["sponsor_logo"]),
    );
    expect(unknown).not.toContain("sponsor_logo");
  });

  it("still rejects unrelated unknown names even with extraAllowed set", () => {
    const unknown = findUnknownPlaceholders(
      "Hi",
      "<p>{{sponsor_logo}} {{totally_made_up}}</p>",
      new Set(["sponsor_logo"]),
    );
    expect(unknown).toEqual(["totally_made_up"]);
  });
});

describe("renderTemplate with customAssetPlaceholders", () => {
  it("substitutes and absolutizes a relative custom asset URL like a branding field", () => {
    const result = renderTemplate(
      {
        subject: "T",
        compiledHtml: '<img src="{{sponsor_logo}}" alt="Sponsor" width="100" height="40" />',
      },
      { sponsor_logo: "/uploads/asset-org/events/evt-ia/sponsor.png" },
      {
        baseUrl: "https://tickets.example.com",
        customAssetPlaceholders: new Set(["sponsor_logo"]),
      },
    );
    expect(result.html).toContain(
      'src="https://tickets.example.com/uploads/asset-org/events/evt-ia/sponsor.png"',
    );
  });

  it("throws UnknownPlaceholdersError for a custom token when customAssetPlaceholders is omitted", () => {
    expect(() =>
      renderTemplate(
        { subject: "T", compiledHtml: "<p>{{sponsor_logo}}</p>" },
        { sponsor_logo: "/uploads/x.png" },
      ),
    ).toThrow(UnknownPlaceholdersError);
  });

  it("never produces src=\"\" when a custom asset value is empty", () => {
    const result = renderTemplate(
      {
        subject: "T",
        compiledHtml: '<img src="{{sponsor_logo}}" alt="Sponsor" />',
      },
      { sponsor_logo: "" },
      { customAssetPlaceholders: new Set(["sponsor_logo"]) },
    );
    expect(result.html).not.toMatch(/src\s*=\s*""/);
  });
});

describe("event-scoped vs organization-scoped template save", () => {
  it("allows a custom asset token in an event-scoped template", async () => {
    await expect(
      setMailTemplate(
        { scopeType: "event", scopeId: "evt-ia" },
        {
          subject: "Thanks for registering",
          body: '<p>Sponsored by <img src="{{sponsor_logo}}" alt="Sponsor" /></p>',
          format: "html",
        },
        prisma,
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects the same custom asset token in an organization-scoped template", async () => {
    await expect(
      setMailTemplate(
        { scopeType: "organization", scopeId: "org-ia" },
        {
          subject: "Thanks for registering",
          body: '<p>Sponsored by <img src="{{sponsor_logo}}" alt="Sponsor" /></p>',
          format: "html",
        },
        prisma,
      ),
    ).rejects.toThrow(UnknownPlaceholdersError);
  });

  it("createMailTemplate also allows event-scoped custom tokens", async () => {
    await expect(
      createMailTemplate(
        { scopeType: "event", scopeId: "evt-ia", name: "reminder" },
        {
          subject: "Reminder",
          body: '<p><img src="{{sponsor_logo}}" alt="Sponsor" /></p>',
          format: "html",
        },
        prisma,
      ),
    ).resolves.toBeDefined();
  });
});

describe("previewTemplate merges custom asset vars", () => {
  it("renders a custom token used in the saved template with its real uploaded URL", async () => {
    await setMailTemplate(
      { scopeType: "event", scopeId: "evt-ia" },
      {
        subject: "Your ticket",
        body: '<p>Hi {{first_name}} - <img src="{{sponsor_logo}}" alt="Sponsor" /></p>',
        format: "html",
      },
      prisma,
    );

    const result = await previewTemplate("evt-ia", prisma, undefined, {
      baseUrl: "https://tickets.example.com",
    });
    expect(result.html).toContain(
      'src="https://tickets.example.com/uploads/asset-org/events/evt-ia/sponsor.png"',
    );
  });
});
