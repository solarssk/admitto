import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import { createMailer, parseMailerConfig } from "@admitto/mailer";
import { setMailSettings } from "../src/mailSettings.js";
import { resolveMailConfig, resolveMailConfigForOrg } from "../src/resolver.js";
import { resetDb } from "./resetDb.js";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

const mockedLookup = vi.mocked(lookup);

beforeEach(() => {
  mockedLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as Awaited<
    ReturnType<typeof lookup>
  >);
});

const prisma = createTestPrismaClient();

const BASE_SMTP_ENV: NodeJS.ProcessEnv = {
  EMAIL_PROVIDER: "smtp",
  SMTP_HOST: "smtp.env.example.com",
  SMTP_USER: "env-user@example.com",
  SMTP_PASSWORD: "env-pass",
  MAIL_FROM_ADDRESS: "env-from@example.com",
};

beforeAll(async () => {
  await resetDb();

  await prisma.organization.create({
    data: { id: "org-r", name: "Resolver Org", slug: "resolver-org" },
  });
  await prisma.event.create({
    data: {
      id: "evt-r",
      organization_id: "org-r",
      title: "Resolver Event",
      slug: "resolver-event",
      date: new Date("2026-09-01"),
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("resolveMailConfig — env only", () => {
  it("resolves from env when no DB settings exist", async () => {
    const config = await resolveMailConfig("evt-r", prisma, BASE_SMTP_ENV);
    expect(config.provider).toBe("smtp");
    if (config.provider === "smtp") {
      expect(config.host).toBe("smtp.env.example.com");
      expect(config.user).toBe("env-user@example.com");
      expect(config.password).toBe("env-pass");
    }
  });

  it("output passes parseMailerConfig and creates an adapter", async () => {
    const config = await resolveMailConfig("evt-r", prisma, BASE_SMTP_ENV);
    expect(() => parseMailerConfig(config)).not.toThrow();
    const adapter = await createMailer(config);
    expect(adapter.provider).toBe("smtp");
    await adapter.close();
  });
});

describe("resolveMailConfig — DB only (no env provider)", () => {
  beforeAll(async () => {
    await setMailSettings(
      { scopeType: "organization", scopeId: "org-r" },
      {
        provider: "smtp",
        host: "smtp.org.example.com",
        port: 587,
        user: "org@example.com",
        fromAddress: "org@example.com",
        smtpPassword: "org-pass",
      },
      prisma,
    );
  });

  it("resolves from org DB settings when env has no provider", async () => {
    const config = await resolveMailConfig("evt-r", prisma, {});
    expect(config.provider).toBe("smtp");
    if (config.provider === "smtp") {
      expect(config.host).toBe("smtp.org.example.com");
      expect(config.user).toBe("org@example.com");
      expect(config.password).toBe("org-pass"); // decrypted at point of use
    }
  });
});

describe("resolveMailConfig — event overrides org", () => {
  beforeAll(async () => {
    await setMailSettings(
      { scopeType: "event", scopeId: "evt-r" },
      {
        provider: "smtp",
        host: "smtp.event.example.com",
        user: "evt@example.com",
        fromAddress: "evt@example.com",
        smtpPassword: "evt-pass",
      },
      prisma,
    );
  });

  it("event host wins over org host", async () => {
    const config = await resolveMailConfig("evt-r", prisma, {});
    if (config.provider === "smtp") {
      expect(config.host).toBe("smtp.event.example.com");
      expect(config.user).toBe("evt@example.com");
    }
  });

  it("falls back to org field when event field is null", async () => {
    // port is only set on org (587), not on event
    const config = await resolveMailConfig("evt-r", prisma, {});
    if (config.provider === "smtp") {
      expect(config.port).toBe(587);
    }
  });
});

describe("resolveMailConfig — event cannot borrow the org secret while redirecting the endpoint", () => {
  it("throws instead of resolving the org's SMTP password when the event overrides only the host", async () => {
    await prisma.organization.create({
      data: { id: "org-r2", name: "Resolver Org 2", slug: "resolver-org-2" },
    });
    await prisma.event.create({
      data: {
        id: "evt-r2",
        organization_id: "org-r2",
        title: "Resolver Event 2",
        slug: "resolver-event-2",
        date: new Date("2026-09-01"),
      },
    });
    await setMailSettings(
      { scopeType: "organization", scopeId: "org-r2" },
      {
        provider: "smtp",
        host: "smtp.org2.example.com",
        port: 587,
        user: "org2@example.com",
        fromAddress: "org2@example.com",
        smtpPassword: "org2-real-secret",
      },
      prisma,
    );
    // Matches the exploit shape exactly: a minimal event-level PUT body containing only
    // `host`, with no provider and no password of its own.
    await setMailSettings(
      { scopeType: "event", scopeId: "evt-r2" },
      { host: "smtp.attacker.example.com" },
      prisma,
    );

    await expect(resolveMailConfig("evt-r2", prisma, {})).rejects.toThrow();
  });

  it("does not carry the org's Power Automate key to an event-overridden URL", async () => {
    await prisma.organization.create({
      data: { id: "org-r3", name: "Resolver Org 3", slug: "resolver-org-3" },
    });
    await prisma.event.create({
      data: {
        id: "evt-r3",
        organization_id: "org-r3",
        title: "Resolver Event 3",
        slug: "resolver-event-3",
        date: new Date("2026-09-01"),
      },
    });
    await setMailSettings(
      { scopeType: "organization", scopeId: "org-r3" },
      {
        provider: "powerautomate",
        fromAddress: "org3@example.com",
        powerAutomateUrl: "https://org3.example.com/flow",
        powerAutomateKey: "org3-real-key",
      },
      prisma,
    );
    await setMailSettings(
      { scopeType: "event", scopeId: "evt-r3" },
      { powerAutomateUrl: "https://attacker.example.com/flow" },
      prisma,
    );

    const config = await resolveMailConfig("evt-r3", prisma, {});
    expect(config.provider).toBe("powerautomate");
    if (config.provider === "powerautomate") {
      expect(config.url).toBe("https://attacker.example.com/flow");
      expect(config.key).toBeUndefined();
    }
  });
});

describe("resolveMailConfig — env overrides DB", () => {
  it("env host wins over event and org host", async () => {
    const envWithHost: NodeJS.ProcessEnv = {
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "smtp.locked.example.com",
      SMTP_USER: "locked@example.com",
      SMTP_PASSWORD: "locked-pass",
      MAIL_FROM_ADDRESS: "locked@example.com",
    };
    const config = await resolveMailConfig("evt-r", prisma, envWithHost);
    if (config.provider === "smtp") {
      expect(config.host).toBe("smtp.locked.example.com");
    }
  });
});

describe("resolveMailConfig — errors", () => {
  it("throws when no provider can be resolved", async () => {
    // Clear all DB settings by removing event and org rows
    await prisma.mailSettings.deleteMany({ where: { scope_type: "event", scope_id: "evt-r" } });
    await prisma.mailSettings.deleteMany({ where: { scope_type: "organization", scope_id: "org-r" } });

    await expect(resolveMailConfig("evt-r", prisma, {})).rejects.toThrow(/Cannot resolve mail provider/);
  });
});

describe("resolveMailConfig — secret round-trip", () => {
  beforeAll(async () => {
    await setMailSettings(
      { scopeType: "organization", scopeId: "org-r" },
      {
        provider: "smtp",
        host: "smtp.rt.example.com",
        user: "rt@example.com",
        fromAddress: "rt@example.com",
        smtpPassword: "round-trip-secret",
      },
      prisma,
    );
  });

  it("decrypts smtp password correctly at point of use", async () => {
    const config = await resolveMailConfig("evt-r", prisma, {});
    if (config.provider === "smtp") {
      expect(config.password).toBe("round-trip-secret");
    }
  });
});

describe("resolveMailConfigForOrg — org-scoped instance settings", () => {
  beforeAll(async () => {
    await setMailSettings(
      { scopeType: "organization", scopeId: "org-r" },
      {
        provider: "smtp",
        host: "smtp.org-for-org.example.com",
        port: 587,
        user: "org-for@example.com",
        fromAddress: "org-for@example.com",
        smtpPassword: "org-for-pass",
      },
      prisma,
    );
  });

  it("resolves from org DB when env has no provider", async () => {
    const config = await resolveMailConfigForOrg("org-r", prisma, {});
    expect(config.provider).toBe("smtp");
    if (config.provider === "smtp") {
      expect(config.host).toBe("smtp.org-for-org.example.com");
    }
  });

  it("env overrides org DB", async () => {
    const config = await resolveMailConfigForOrg("org-r", prisma, {
      ...BASE_SMTP_ENV,
      SMTP_HOST: "smtp.env-override.example.com",
    });
    if (config.provider === "smtp") {
      expect(config.host).toBe("smtp.env-override.example.com");
    }
  });

  it("rejects resolve when allowed from domain does not match from address", async () => {
    await setMailSettings(
      { scopeType: "organization", scopeId: "org-r" },
      {
        provider: "smtp",
        host: "smtp.org-for-org.example.com",
        port: 587,
        user: "org-for@example.com",
        fromAddress: "org-for@other.com",
        allowedFromDomain: "example.com",
        smtpPassword: "org-for-pass",
      },
      prisma,
    );

    await expect(resolveMailConfigForOrg("org-r", prisma, {})).rejects.toThrow(
      /allowed from domain/i,
    );
  });
});
