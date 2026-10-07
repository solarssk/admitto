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
});
