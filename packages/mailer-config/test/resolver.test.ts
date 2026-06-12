import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMailer } from "@admitto/mailer";
import { parseMailerConfig } from "@admitto/mailer";
import { setMailSettings } from "../src/mailSettings.js";
import { resolveMailConfig } from "../src/resolver.js";

const prisma = new PrismaClient();

const BASE_SMTP_ENV: NodeJS.ProcessEnv = {
  EMAIL_PROVIDER: "smtp",
  SMTP_HOST: "smtp.env.example.com",
  SMTP_USER: "env-user@example.com",
  SMTP_PASSWORD: "env-pass",
  MAIL_FROM_ADDRESS: "env-from@example.com",
};

beforeAll(async () => {
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: new URL("../../db", import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: "pipe",
  });

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
    const adapter = createMailer(config);
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
