import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setMailSettings } from "@admitto/mailer-config";
import { resetDb } from "./resetDb.js";
import { getMailConfigDescription, serializeConfigDescriptionForCli } from "../src/configDescribe.js";

const prisma = createTestPrismaClient();

beforeAll(async () => {
  await resetDb();

  await prisma.organization.create({
    data: { id: "org-cfg-desc", name: "Config Org", slug: "cfg-desc-org" },
  });
  await prisma.event.create({
    data: {
      id: "evt-cfg-desc",
      organization_id: "org-cfg-desc",
      title: "Config Event",
      slug: "cfg-desc-event",
      date: new Date("2026-09-01"),
    },
  });

  await setMailSettings(
    { scopeType: "organization", scopeId: "org-cfg-desc" },
    {
      provider: "smtp",
      host: "smtp.example.com",
      port: 587,
      user: "mail@example.com",
      fromAddress: "mail@example.com",
      smtpPassword: "super-secret-password",
    },
    prisma,
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("getMailConfigDescription", () => {
  it("passthrough masks secrets from describeMailConfig", async () => {
    const desc = await getMailConfigDescription("evt-cfg-desc", prisma, {});

    expect(desc.smtpPassword.value).toBe("••••");
    expect(desc.smtpPassword.source).toBe("organization");
    expect(JSON.stringify(desc)).not.toContain("super-secret-password");
  });

  it("returns per-field source and locked flags", async () => {
    const desc = await getMailConfigDescription("evt-cfg-desc", prisma, {
      SMTP_HOST: "smtp.env.example.com",
      MAIL_FROM_ADDRESS: "env@example.com",
    });

    expect(desc.host.source).toBe("env");
    expect(desc.host.locked).toBe(true);
    expect(desc.host.value).toBe("smtp.env.example.com");
  });
});

describe("serializeConfigDescriptionForCli", () => {
  it("omits secret values from CLI JSON (presence only)", async () => {
    const desc = await getMailConfigDescription("evt-cfg-desc", prisma, {});
    const json = serializeConfigDescriptionForCli(desc);
    const parsed = JSON.parse(json) as Record<string, { configured?: boolean; value?: string }>;

    expect(json).not.toContain("super-secret-password");
    expect(parsed.smtpPassword).toEqual({
      configured: true,
      source: "organization",
      locked: false,
    });
    expect(parsed.smtpPassword).not.toHaveProperty("value");
  });

  it("ignores unexpected enumerable fields without a field descriptor", async () => {
    const desc = await getMailConfigDescription("evt-cfg-desc", prisma, {});
    Object.defineProperty(desc, "unexpected", { value: undefined, enumerable: true });

    expect(JSON.parse(serializeConfigDescriptionForCli(desc))).not.toHaveProperty("unexpected");
  });
});
