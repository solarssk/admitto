import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { buildGeocodingUserAgent, isGeocodingContactConfigured } from "../../src/maps/user-agent.js";
import { resolveProductVersion } from "../../src/ops/product-version.js";

const ORG_ID = "org-geocoding-ua-test";

let prisma: PrismaClient;
let prevInstanceOrgId: string | undefined;
let prevBaseUrl: string | undefined;

beforeAll(async () => {
  prevInstanceOrgId = process.env.INSTANCE_ORG_ID;
  process.env.INSTANCE_ORG_ID = ORG_ID;

  // `instance_url` is env-locked by BASE_URL (see SETTING_ENV_LOCKS) and `sharedTestEnv` sets
  // BASE_URL=https://tickets.example.com for the whole suite — clear it here so the "nothing
  // configured" scenarios below see a real null instead of that shared fixture value; setSetting
  // would throw "setting_locked_by_env" while any BASE_URL is set, so the DB is never involved.
  prevBaseUrl = process.env.BASE_URL;
  delete process.env.BASE_URL;

  prisma = createTestPrismaClient();
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.organization.create({
    data: { id: ORG_ID, name: "Geocoding User-Agent Test Org", slug: "geocoding-ua-test" },
  });
});

afterEach(async () => {
  await prisma.organization.update({
    where: { id: ORG_ID },
    data: { support_contact_name: null, support_contact_email: null },
  });
});

afterAll(async () => {
  if (prevInstanceOrgId === undefined) delete process.env.INSTANCE_ORG_ID;
  else process.env.INSTANCE_ORG_ID = prevInstanceOrgId;
  if (prevBaseUrl === undefined) delete process.env.BASE_URL;
  else process.env.BASE_URL = prevBaseUrl;
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.$disconnect();
});

describe("buildGeocodingUserAgent", () => {
  it("falls back to non-identifying placeholders when nothing is configured", async () => {
    const ua = await buildGeocodingUserAgent(prisma);
    expect(ua).toBe(`Admitto/${resolveProductVersion()} (+self-hosted; no-contact-configured)`);
  });

  it("includes the instance URL (from BASE_URL) when set", async () => {
    process.env.BASE_URL = "https://admitto.example.com";
    try {
      const ua = await buildGeocodingUserAgent(prisma);
      expect(ua).toBe(`Admitto/${resolveProductVersion()} (+https://admitto.example.com; no-contact-configured)`);
    } finally {
      delete process.env.BASE_URL;
    }
  });

  it("prefers support_contact_email over support_contact_name", async () => {
    await prisma.organization.update({
      where: { id: ORG_ID },
      data: { support_contact_name: "Ops Team", support_contact_email: "ops@customer.org" },
    });
    const ua = await buildGeocodingUserAgent(prisma);
    expect(ua).toContain("ops@customer.org");
    expect(ua).not.toContain("Ops Team");
  });

  it("omits reserved documentation emails from the User-Agent and falls back to name", async () => {
    await prisma.organization.update({
      where: { id: ORG_ID },
      data: { support_contact_name: "Ops Team", support_contact_email: "ops@example.com" },
    });
    const ua = await buildGeocodingUserAgent(prisma);
    expect(ua).toContain("Ops Team");
    expect(ua).not.toContain("ops@example.com");
    expect(ua).not.toContain("@example.com");
  });

  it("omits reserved documentation emails when no name is set", async () => {
    await prisma.organization.update({
      where: { id: ORG_ID },
      data: { support_contact_email: "ops@example.com" },
    });
    const ua = await buildGeocodingUserAgent(prisma);
    expect(ua).toContain("no-contact-configured");
    expect(ua).not.toContain("@example.com");
  });

  it("falls back to support_contact_name when email is unset", async () => {
    await prisma.organization.update({
      where: { id: ORG_ID },
      data: { support_contact_name: "Ops Team" },
    });
    const ua = await buildGeocodingUserAgent(prisma);
    expect(ua).toContain("Ops Team");
  });

  it("falls back gracefully when INSTANCE_ORG_ID points at no organization", async () => {
    const prev = process.env.INSTANCE_ORG_ID;
    process.env.INSTANCE_ORG_ID = "org-does-not-exist";
    try {
      const ua = await buildGeocodingUserAgent(prisma);
      expect(ua).toBe(`Admitto/${resolveProductVersion()} (+self-hosted; no-contact-configured)`);
    } finally {
      process.env.INSTANCE_ORG_ID = prev;
    }
  });
});

describe("isGeocodingContactConfigured", () => {
  it("is false when neither support contact field is set", async () => {
    expect(await isGeocodingContactConfigured(prisma)).toBe(false);
  });

  it("is true once support_contact_email is set", async () => {
    await prisma.organization.update({
      where: { id: ORG_ID },
      data: { support_contact_email: "ops@example.com" },
    });
    expect(await isGeocodingContactConfigured(prisma)).toBe(true);
  });

  it("is true once support_contact_name is set", async () => {
    await prisma.organization.update({
      where: { id: ORG_ID },
      data: { support_contact_name: "Ops Team" },
    });
    expect(await isGeocodingContactConfigured(prisma)).toBe(true);
  });

  it("is false when blank strings are stored (whitespace-only counts as unset)", async () => {
    await prisma.organization.update({
      where: { id: ORG_ID },
      data: { support_contact_name: "   ", support_contact_email: "  " },
    });
    expect(await isGeocodingContactConfigured(prisma)).toBe(false);
  });
});
