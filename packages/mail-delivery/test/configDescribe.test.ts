import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setMailSettings } from "@admitto/mailer-config";
import { resetDb } from "./resetDb.js";
import { getMailConfigDescription } from "../src/configDescribe.js";

const prisma = new PrismaClient();

beforeAll(async () => {
  resetDb();

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
