import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decryptFromString, encryptToString, SECRET_CONTEXTS } from "@admitto/crypto";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { createTestPrismaClient } from "../src/testing.js";
import { rebindSecretContexts } from "../src/rebind-secret-contexts.js";
import { assertTestDatabaseUrl } from "../src/testDbGuard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..");

let prisma: PrismaClient;

beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });
  prisma = createTestPrismaClient();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("rebindSecretContexts", () => {
  it("binds legacy secrets, is idempotent, honours dry run and leaves unreadable values alone", async () => {
    const mail = await prisma.mailSettings.create({
      data: {
        scope_type: "organization",
        scope_id: "org-rebind",
        smtp_password_enc: encryptToString("smtp-pw"),
        graph_client_secret_enc: encryptToString("graph-secret", SECRET_CONTEXTS.graphClientSecret),
        power_automate_key_enc: "not json",
      },
    });

    const dry = await rebindSecretContexts(prisma, { dryRun: true });
    expect(dry.find((r) => r.column === "MailSettings.smtp_password_enc")).toMatchObject({ rewritten: 1 });
    const untouched = await prisma.mailSettings.findUniqueOrThrow({ where: { id: mail.id } });
    expect(JSON.parse(untouched.smtp_password_enc ?? "").keyVersion).toBe(1);

    const first = await rebindSecretContexts(prisma);
    expect(first.find((r) => r.column === "MailSettings.smtp_password_enc")).toMatchObject({ rewritten: 1, failed: 0 });
    expect(first.find((r) => r.column === "MailSettings.graph_client_secret_enc")).toMatchObject({ alreadyBound: 1 });
    expect(first.find((r) => r.column === "MailSettings.power_automate_key_enc")).toMatchObject({ failed: 1 });

    const row = await prisma.mailSettings.findUniqueOrThrow({ where: { id: mail.id } });
    expect(decryptFromString(row.smtp_password_enc ?? "", SECRET_CONTEXTS.smtpPassword)).toBe("smtp-pw");
    expect(row.power_automate_key_enc).toBe("not json");

    const second = await rebindSecretContexts(prisma);
    expect(second.find((r) => r.column === "MailSettings.smtp_password_enc")).toMatchObject({ rewritten: 0, alreadyBound: 1 });
  });

  it("binds the event wallet key, the IMAP password and the notification webhook URL", async () => {
    await prisma.organization.create({ data: { id: "org-rebind-2", name: "Rebind Org", slug: "rebind-org" } });
    await prisma.event.create({
      data: {
        id: "evt-rebind",
        organization_id: "org-rebind-2",
        title: "Rebind Event",
        slug: "rebind-event",
        date: new Date("2026-09-01"),
        wallet_api_key_enc: encryptToString("wallet-key"),
      },
    });
    await prisma.bounceIngestSettings.create({
      data: { event_id: "evt-rebind", imap_password_enc: encryptToString("imap-pw") },
    });
    const notification = await prisma.notificationSettings.create({
      data: {
        scope_type: "organization",
        scope_id: "org-rebind-2",
        webhook_url_enc: encryptToString("https://hooks.example.com/x"),
      },
    });

    const results = await rebindSecretContexts(prisma);
    for (const column of [
      "Event.wallet_api_key_enc",
      "BounceIngestSettings.imap_password_enc",
      "NotificationSettings.webhook_url_enc",
    ]) {
      expect(results.find((r) => r.column === column)).toMatchObject({ rewritten: 1, failed: 0 });
    }

    const event = await prisma.event.findUniqueOrThrow({ where: { id: "evt-rebind" } });
    expect(decryptFromString(event.wallet_api_key_enc ?? "", SECRET_CONTEXTS.walletApiKey)).toBe("wallet-key");
    const bounce = await prisma.bounceIngestSettings.findUniqueOrThrow({ where: { event_id: "evt-rebind" } });
    expect(decryptFromString(bounce.imap_password_enc ?? "", SECRET_CONTEXTS.imapPassword)).toBe("imap-pw");
    const settings = await prisma.notificationSettings.findUniqueOrThrow({ where: { id: notification.id } });
    expect(decryptFromString(settings.webhook_url_enc ?? "", SECRET_CONTEXTS.notificationWebhookUrl)).toBe(
      "https://hooks.example.com/x",
    );
    expect(() => decryptFromString(settings.webhook_url_enc ?? "", SECRET_CONTEXTS.imapPassword)).toThrow();
  });
});
