import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/password.js";
import { verifyOidcLinkStepUp } from "../../src/oidc/link-step-up.js";
import { bootstrapSuperadmin } from "../../src/bootstrap.js";
import {
  startTotpEnrollment,
  confirmTotpEnrollment,
} from "../../src/mfa/enrollment.js";
import { generateTotpCode, decryptTotpSecret } from "../../src/mfa/totp.js";

const USER_ID = "oidc-link-stepup-user";

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = new PrismaClient();
  await prisma.userMfaMethod.deleteMany({ where: { user_id: USER_ID } });
  await prisma.roleAssignment.deleteMany({ where: { user_id: USER_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });

  await prisma.user.create({
    data: {
      id: USER_ID,
      email: "oidc-link-stepup@example.com",
      password_hash: await hashPassword("correct-password"),
      is_active: true,
    },
  });
});

afterAll(async () => {
  await prisma.userMfaMethod.deleteMany({ where: { user_id: USER_ID } });
  await prisma.roleAssignment.deleteMany({ where: { user_id: USER_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.$disconnect();
});

describe("verifyOidcLinkStepUp", () => {
  it("accepts correct password for user without MFA", async () => {
    const result = await verifyOidcLinkStepUp(prisma, {
      userId: USER_ID,
      password: "correct-password",
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects wrong password", async () => {
    const result = await verifyOidcLinkStepUp(prisma, {
      userId: USER_ID,
      password: "wrong-password",
    });
    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("requires TOTP for elevated users with enrolled MFA", async () => {
    const mfaEmail = "oidc-link-mfa@example.com";
    await prisma.userMfaMethod.deleteMany({ where: { user: { email: mfaEmail } } });
    await prisma.roleAssignment.deleteMany({ where: { user: { email: mfaEmail } } });
    await prisma.user.deleteMany({ where: { email: mfaEmail } });

    const { userId } = await bootstrapSuperadmin(prisma, mfaEmail, "pw");
    const enrollment = await startTotpEnrollment(prisma, userId);
    expect(enrollment).not.toBeNull();

    const row = await prisma.userMfaMethod.findFirst({
      where: { user_id: userId, type: "totp" },
    });
    const secret = decryptTotpSecret(row!.secret_enc!);
    expect(await confirmTotpEnrollment(prisma, userId, generateTotpCode(secret))).toBe(true);

    const missing = await verifyOidcLinkStepUp(prisma, {
      userId,
      password: "pw",
    });
    expect(missing).toEqual({ ok: false, reason: "totp_required" });

    const ok = await verifyOidcLinkStepUp(prisma, {
      userId,
      password: "pw",
      code: enrollment!.backupCodes[0],
    });
    expect(ok).toEqual({ ok: true });

    await prisma.userMfaMethod.deleteMany({ where: { user_id: userId } });
    await prisma.roleAssignment.deleteMany({ where: { user_id: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });
});
