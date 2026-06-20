import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setMailSettings } from "../src/mailSettings.js";
import { describeMailConfig, describeMailConfigForOrg } from "../src/describer.js";
import { resetDb } from "./resetDb.js";

const prisma = new PrismaClient();

beforeAll(async () => {
  resetDb();

  await prisma.organization.create({
    data: { id: "org-d", name: "Describe Org", slug: "describe-org" },
  });
  await prisma.event.create({
    data: {
      id: "evt-d",
      organization_id: "org-d",
      title: "Describe Event",
      slug: "describe-event",
      date: new Date("2026-09-01"),
    },
  });

  // Org: smtp with secret
  await setMailSettings(
    { scopeType: "organization", scopeId: "org-d" },
    {
      provider: "smtp",
      host: "smtp.org.example.com",
      port: 587,
      user: "org@example.com",
      fromAddress: "org@example.com",
      smtpPassword: "org-secret-pass",
    },
    prisma,
  );

  // Event: overrides host and from, but no secret
  await setMailSettings(
    { scopeType: "event", scopeId: "evt-d" },
    {
      host: "smtp.event.example.com",
      fromAddress: "event@example.com",
    },
    prisma,
  );

  // Fresh org+event with no MailSettings — used by secrets and provider-defaults tests
  await prisma.organization.create({
    data: { id: "org-d-clean", name: "Clean Org", slug: "clean-org" },
  });
  await prisma.event.create({
    data: {
      id: "evt-d-clean",
      organization_id: "org-d-clean",
      title: "Clean Event",
      slug: "clean-event",
      date: new Date("2026-09-01"),
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("describeMailConfig — source attribution", () => {
  it("attributes event-level field to source=event", async () => {
    const desc = await describeMailConfig("evt-d", prisma, {});
    expect(desc.host.source).toBe("event");
    expect(desc.host.value).toBe("smtp.event.example.com");
    expect(desc.host.locked).toBe(false);
  });

  it("falls back to org when event field is null", async () => {
    const desc = await describeMailConfig("evt-d", prisma, {});
    expect(desc.port.source).toBe("organization");
    expect(desc.port.value).toBe(587);
    expect(desc.port.locked).toBe(false);
  });

  it("default source when not set anywhere", async () => {
    const desc = await describeMailConfig("evt-d", prisma, {});
    expect(desc.heloName.source).toBe("default");
    expect(desc.heloName.value).toBeNull();
  });

  it("env field wins and is locked", async () => {
    const envWithHost: NodeJS.ProcessEnv = {
      SMTP_HOST: "smtp.env.example.com",
      SMTP_USER: "env@example.com",
      MAIL_FROM_ADDRESS: "env@example.com",
    };
    const desc = await describeMailConfig("evt-d", prisma, envWithHost);
    expect(desc.host.source).toBe("env");
    expect(desc.host.value).toBe("smtp.env.example.com");
    expect(desc.host.locked).toBe(true);
  });
});

describe("describeMailConfig — secrets never exposed", () => {
  it("masks smtp password from org DB", async () => {
    const desc = await describeMailConfig("evt-d", prisma, {});
    expect(desc.smtpPassword.value).toBe("••••");
    expect(desc.smtpPassword.source).toBe("organization");
    expect(desc.smtpPassword.locked).toBe(false);
  });

  it("masks smtp password from env", async () => {
    const envWithPass: NodeJS.ProcessEnv = { SMTP_PASSWORD: "env-secret" };
    const desc = await describeMailConfig("evt-d", prisma, envWithPass);
    expect(desc.smtpPassword.value).toBe("••••");
    expect(desc.smtpPassword.source).toBe("env");
    expect(desc.smtpPassword.locked).toBe(true);
    // must not contain the actual secret string
    expect(JSON.stringify(desc)).not.toContain("env-secret");
  });

  it("graph secret is masked", async () => {
    await setMailSettings(
      { scopeType: "event", scopeId: "evt-d" },
      {
        provider: "graph",
        mailbox: "mail@example.com",
        tenantId: "t",
        clientId: "c",
        fromAddress: "mail@example.com",
        graphClientSecret: "graph-super-secret",
      },
      prisma,
    );

    const desc = await describeMailConfig("evt-d", prisma, {});
    expect(desc.graphClientSecret.value).toBe("••••");
    expect(JSON.stringify(desc)).not.toContain("graph-super-secret");
  });

  it("power automate url and key are masked", async () => {
    await setMailSettings(
      { scopeType: "organization", scopeId: "org-d" },
      {
        provider: "powerautomate",
        fromAddress: "flow@example.com",
        powerAutomateUrl: "https://flow.example.com/trigger?sig=verysecret",
        powerAutomateKey: "pa-key-secret",
      },
      prisma,
    );

    const desc = await describeMailConfig("evt-d", prisma, {});
    expect(desc.powerAutomateUrl.value).toBe("••••");
    expect(desc.powerAutomateKey.value).toBe("••••");
    expect(JSON.stringify(desc)).not.toContain("verysecret");
    expect(JSON.stringify(desc)).not.toContain("pa-key-secret");
  });

  it("null when no secret present in any scope", async () => {
    // evt-d-clean has no MailSettings — created in the top-level beforeAll
    const desc = await describeMailConfig("evt-d-clean", prisma, {});
    expect(desc.smtpPassword.value).toBeNull();
    expect(desc.smtpPassword.source).toBe("default");
  });
});

describe("describeMailConfig — provider defaults", () => {
  it("smtp port shows 587 with source=default when provider=smtp from env but port unset", async () => {
    // evt-d-clean has no MailSettings; provider forced to smtp via env
    // port is not set anywhere in DB → describer must show the runtime default, not null
    const desc = await describeMailConfig("evt-d-clean", prisma, { EMAIL_PROVIDER: "smtp" });
    expect(desc.port.value).toBe(587);
    expect(desc.port.source).toBe("default");
    expect(desc.secure.value).toBe(false);
    expect(desc.secure.source).toBe("default");
    expect(desc.requireTls.value).toBe(true);
    expect(desc.requireTls.source).toBe("default");
  });

  it("unknown provider → port stays null", async () => {
    const desc = await describeMailConfig("evt-d-clean", prisma, {});
    expect(desc.port.value).toBeNull();
    expect(desc.port.source).toBe("default");
  });
});

describe("describeMailConfigForOrg — org-scoped instance settings", () => {
  it("reads organization MailSettings without event layer", async () => {
    const desc = await describeMailConfigForOrg("org-d", prisma, {});
    expect(desc.host.source).toBe("organization");
    expect(desc.host.value).toBe("smtp.org.example.com");
    expect(desc.smtpPassword.value).toBe("••••");
    expect(JSON.stringify(desc)).not.toContain("org-secret-pass");
  });

  it("ignores event overrides when describing org only", async () => {
    const desc = await describeMailConfigForOrg("org-d", prisma, {});
    expect(desc.host.value).toBe("smtp.org.example.com");
    expect(desc.host.value).not.toBe("smtp.event.example.com");
  });

  it("env field wins and is locked", async () => {
    const desc = await describeMailConfigForOrg("org-d", prisma, {
      SMTP_HOST: "smtp.env-only.example.com",
    });
    expect(desc.host.source).toBe("env");
    expect(desc.host.locked).toBe(true);
  });
});
