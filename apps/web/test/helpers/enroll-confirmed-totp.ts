import { PrismaClient } from "@admitto/db";
import { encryptTotpSecret, generateTotpSecret } from "@admitto/auth/testing";

/** Directly enrolls a confirmed TOTP method for `userId`, bypassing the HTTP enrollment
 * ceremony - the common "make this user MFA-required-eligible" fixture step. */
export async function enrollConfirmedTotp(client: PrismaClient, userId: string): Promise<void> {
  await client.userMfaMethod.create({
    data: {
      user_id: userId,
      type: "totp",
      secret_enc: encryptTotpSecret(generateTotpSecret()),
      confirmed_at: new Date(),
    },
  });
}
