import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setMailSettings } from "../src/mailSettings.js";

const prisma = new PrismaClient();

beforeAll(async () => {
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: new URL("../../db", import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: "pipe",
  });

  await prisma.organization.create({
    data: { id: "org-1", name: "Test Org", slug: "test-org" },
  });
  await prisma.event.create({
    data: {
      id: "evt-1",
      organization_id: "org-1",
      title: "Test Event",
      slug: "test-event",
      date: new Date("2026-09-01"),
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("setMailSettings", () => {
  it("creates org-scope settings with plain non-secret fields", async () => {
    await setMailSettings(
      { scopeType: "organization", scopeId: "org-1" },
      {
        provider: "smtp",
        host: "smtp.example.com",
        port: 587,
        user: "sender@example.com",
        fromAddress: "sender@example.com",
      },
      prisma,
    );

    const row = await prisma.mailSettings.findUniqueOrThrow({
      where: { scope_type_scope_id: { scope_type: "organization", scope_id: "org-1" } },
    });
    expect(row.host).toBe("smtp.example.com");
    expect(row.port).toBe(587);
    expect(row.user).toBe("sender@example.com");
    expect(row.from_address).toBe("sender@example.com");
  });

  it("stores smtp password encrypted (never plaintext)", async () => {
    await setMailSettings(
      { scopeType: "organization", scopeId: "org-1" },
      {
        provider: "smtp",
        host: "smtp.example.com",
        port: 587,
        user: "sender@example.com",
        fromAddress: "sender@example.com",
        smtpPassword: "s3cr3t-password",
      },
      prisma,
    );

    const row = await prisma.mailSettings.findUniqueOrThrow({
      where: { scope_type_scope_id: { scope_type: "organization", scope_id: "org-1" } },
    });
    expect(row.smtp_password_enc).toBeTruthy();
    expect(row.smtp_password_enc).not.toBe("s3cr3t-password");
  });

  it("creates event-scope settings", async () => {
    await setMailSettings(
      { scopeType: "event", scopeId: "evt-1" },
      { provider: "smtp", host: "smtp2.example.com", user: "evt@example.com", fromAddress: "evt@example.com" },
      prisma,
    );

    const row = await prisma.mailSettings.findUniqueOrThrow({
      where: { scope_type_scope_id: { scope_type: "event", scope_id: "evt-1" } },
    });
    expect(row.host).toBe("smtp2.example.com");
  });

  it("upserts — subsequent call updates the record", async () => {
    await setMailSettings(
      { scopeType: "organization", scopeId: "org-1" },
      { provider: "smtp", host: "updated.example.com", user: "u@example.com", fromAddress: "u@example.com" },
      prisma,
    );

    const rows = await prisma.mailSettings.findMany({
      where: { scope_type: "organization", scope_id: "org-1" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].host).toBe("updated.example.com");
  });

  it("stores graph client secret encrypted", async () => {
    await setMailSettings(
      { scopeType: "organization", scopeId: "org-1" },
      {
        provider: "graph",
        mailbox: "mail@example.com",
        tenantId: "tenant-id",
        clientId: "client-id",
        fromAddress: "mail@example.com",
        graphClientSecret: "graph-secret-xyz",
      },
      prisma,
    );

    const row = await prisma.mailSettings.findUniqueOrThrow({
      where: { scope_type_scope_id: { scope_type: "organization", scope_id: "org-1" } },
    });
    expect(row.graph_client_secret_enc).toBeTruthy();
    expect(row.graph_client_secret_enc).not.toBe("graph-secret-xyz");
  });

  it("stores power automate url and key encrypted", async () => {
    await setMailSettings(
      { scopeType: "event", scopeId: "evt-1" },
      {
        provider: "powerautomate",
        fromAddress: "flow@example.com",
        powerAutomateUrl: "https://flow.example.com/trigger?sig=secret",
        powerAutomateKey: "pa-key-abc",
      },
      prisma,
    );

    const row = await prisma.mailSettings.findUniqueOrThrow({
      where: { scope_type_scope_id: { scope_type: "event", scope_id: "evt-1" } },
    });
    expect(row.power_automate_url_enc).toBeTruthy();
    expect(row.power_automate_url_enc).not.toContain("secret");
    expect(row.power_automate_key_enc).toBeTruthy();
    expect(row.power_automate_key_enc).not.toBe("pa-key-abc");
  });
});
