import { PrismaClient } from "@admitto/db";
import {
  beginWebauthnRegistration,
  finishWebauthnRegistration,
  markBackupCodesAcknowledged,
  type WebauthnRpConfig,
} from "@admitto/auth";
import { createVirtualAuthenticator } from "@admitto/auth/webauthn-testing";

/** Register + acknowledge a confirmed WebAuthn credential directly against `prisma` (bypassing
 * the HTTP ceremony), returning the virtual authenticator too so a caller can later produce a
 * valid assertion against this same credential. Note: `userMfaMethod` is shared with
 * `type: "recovery"` backup-code rows auto-created alongside a user's first-ever confirmed MFA
 * method - filter by `type` in any row-count assertion. */
export async function registerConfirmedWebauthnCredential(
  prisma: PrismaClient,
  webauthnRp: WebauthnRpConfig,
  uid: string,
  label = "Seeded key",
) {
  const authenticator = createVirtualAuthenticator();
  const begin = await beginWebauthnRegistration(prisma, uid, "platform", webauthnRp);
  if (!begin) throw new Error("beginWebauthnRegistration failed");
  const response = authenticator.register({ challenge: begin.challenge, rpID: webauthnRp.rpID, origin: webauthnRp.origin });
  const result = await finishWebauthnRegistration(prisma, uid, response, begin.challenge, "platform", label, webauthnRp);
  if (!result) throw new Error("finishWebauthnRegistration failed");
  await markBackupCodesAcknowledged(prisma, uid);
  return { ...result, authenticator };
}
