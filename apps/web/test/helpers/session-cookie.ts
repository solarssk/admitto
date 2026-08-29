import { PrismaClient } from "@admitto/db";
import { createSession, SESSION_STAGE } from "@admitto/auth";

/** Create a full-stage session for `userId` and return its `Cookie` header value. */
export async function sessionCookieFor(prisma: PrismaClient, userId: string): Promise<string> {
  const { rawToken } = await createSession(prisma, { userId, stage: SESSION_STAGE.FULL });
  return `admitto_session=${rawToken}`;
}

/** Extract the `admitto_session` cookie from a response's `Set-Cookie` headers, if present. */
export function sessionCookie(res: Response): string | undefined {
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const line = setCookie.find((c) => c.startsWith("admitto_session="));
  return line?.split(";")[0];
}
