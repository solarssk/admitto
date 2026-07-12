import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { verifyTotpOrRecoveryCode } from "../../src/mfa/verify-step-up-code.js";
import { generateBackupRecoveryCodes } from "../../src/mfa/backup-recovery.js";
import { generateEmergencyRecoveryCode } from "../../src/mfa/emergency-recovery.js";
import { encryptTotpSecret, generateTotpCode, generateTotpSecret } from "../../src/mfa/totp.js";
import { hashPassword } from "../../src/password.js";

const USER_ID = "verify-step-up-code-user";

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = new PrismaClient();
  await prisma.userMfaMethod.deleteMany({ where: { user_id: USER_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });

  await prisma.user.create({
    data: {
      id: USER_ID,
      email: "verify-step-up-code@example.com",
      password_hash: await hashPassword("pw"),
      is_active: true,
    },
  });
});

afterEach(async () => {
  // Each test seeds its own confirmed TOTP method directly (never through
  // enroll+confirm) so it always has an unconsumed time-step available and no test's
  // code choice can collide with another's.
  await prisma.userMfaMethod.deleteMany({ where: { user_id: USER_ID } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.$disconnect();
});

describe("verifyTotpOrRecoveryCode", () => {
  it("returns false for an empty or whitespace-only code", async () => {
    expect(await verifyTotpOrRecoveryCode(prisma, USER_ID, "")).toBe(false);
    expect(await verifyTotpOrRecoveryCode(prisma, USER_ID, "   ")).toBe(false);
  });

  it("returns false for a code that matches no TOTP or recovery method", async () => {
    expect(await verifyTotpOrRecoveryCode(prisma, USER_ID, "000000")).toBe(false);
  });

  it("returns true for a correct TOTP code", async () => {
    const secret = generateTotpSecret();
    await prisma.userMfaMethod.create({
      data: {
        user_id: USER_ID,
        type: "totp",
        secret_enc: encryptTotpSecret(secret),
        confirmed_at: new Date(),
      },
    });
    expect(await verifyTotpOrRecoveryCode(prisma, USER_ID, generateTotpCode(secret))).toBe(true);
  });

  it("accepts and consumes a correct backup recovery code — a second use fails", async () => {
    const secret = generateTotpSecret();
    await prisma.userMfaMethod.create({
      data: {
        user_id: USER_ID,
        type: "totp",
        secret_enc: encryptTotpSecret(secret),
        confirmed_at: new Date(),
      },
    });
    const { codes } = await generateBackupRecoveryCodes(prisma, USER_ID);
    const backupCode = codes[0]!;

    expect(await verifyTotpOrRecoveryCode(prisma, USER_ID, backupCode)).toBe(true);
    expect(await verifyTotpOrRecoveryCode(prisma, USER_ID, backupCode)).toBe(false);
  });

  it("falls back to an emergency recovery code when no backup code matches, and consumes it", async () => {
    const { code } = await generateEmergencyRecoveryCode(prisma, USER_ID);
    expect(await verifyTotpOrRecoveryCode(prisma, USER_ID, code)).toBe(true);
    expect(await verifyTotpOrRecoveryCode(prisma, USER_ID, code)).toBe(false);
  });
});
