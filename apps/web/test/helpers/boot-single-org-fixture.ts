import { PrismaClient } from "@admitto/db";
import { buildTestApp } from "./build-test-app.js";
import { sessionCookieFor } from "./session-cookie.js";

/** Boots the app and signs in as the admin/operator fixture users - the common tail several
 * single-org/single-event integration test `beforeAll`s repeat once seeding is done. */
export async function bootSingleOrgFixture(opts: {
  prisma: PrismaClient;
  adminId: string;
  opId: string;
  checkinToken: string;
  adminDistRoot: string;
}): Promise<{
  app: ReturnType<typeof buildTestApp>;
  adminCookie: string;
  opCookie: string;
}> {
  const app = buildTestApp({
    prisma: opts.prisma,
    checkinToken: opts.checkinToken,
    adminDistRoot: opts.adminDistRoot,
  });
  const adminCookie = await sessionCookieFor(opts.prisma, opts.adminId);
  const opCookie = await sessionCookieFor(opts.prisma, opts.opId);
  return { app, adminCookie, opCookie };
}
