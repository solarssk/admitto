/**
 * What the tests of the registration settings of an event share: a staff user with one role and a session, a mail provider for
 * an organisation, and an instance that has no address. Every address and name here is synthetic.
 */
import type { PrismaClient } from "@admitto/db";
import { enrollConfirmedTotp } from "./enroll-confirmed-totp.js";
import { sessionCookieFor } from "./session-cookie.js";

type StaffRole =
  | { role: "superadmin" }
  | { role: "admin"; organizationId: string }
  | { role: "operator"; eventId: string };

/** A staff member with one role, and the cookie of a signed-in session. Everyone but an operator has a second factor, as the
 * staff gate asks. */
export async function createStaffSession(
  prisma: PrismaClient,
  email: string,
  grant: StaffRole,
): Promise<{ userId: string; cookie: string }> {
  const user = await prisma.user.create({ data: { email } });
  const scope =
    grant.role === "superadmin"
      ? { scope_type: "instance", scope_id: null }
      : grant.role === "admin"
        ? { scope_type: "organization", scope_id: grant.organizationId }
        : { scope_type: "event", scope_id: grant.eventId };
  await prisma.roleAssignment.create({ data: { user_id: user.id, role: grant.role, ...scope } });
  if (grant.role !== "operator") await enrollConfirmedTotp(prisma, user.id);
  return { userId: user.id, cookie: await sessionCookieFor(prisma, user.id) };
}

/** Removes the staff members of a test: their roles, sessions, second factors and accounts. */
export async function removeStaff(prisma: PrismaClient, emails: string[]): Promise<void> {
  const owner = { user: { email: { in: emails } } };
  await prisma.roleAssignment.deleteMany({ where: owner });
  await prisma.session.deleteMany({ where: owner });
  await prisma.userMfaMethod.deleteMany({ where: owner });
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
}

/** A mail provider for the organisation, one that needs no network (`export_only`), or none. */
export async function setOrgMail(prisma: PrismaClient, organizationId: string, on: boolean): Promise<void> {
  await prisma.mailSettings.deleteMany({ where: { scope_type: "organization", scope_id: organizationId } });
  if (on) {
    await prisma.mailSettings.create({
      data: { scope_type: "organization", scope_id: organizationId, provider: "export_only", from_address: "events@example.net" },
    });
  }
}

/**
 * Runs `run` as an instance that has no address: none in the environment, none saved, and a production environment, which
 * has no address of its own to fall back to. The environment the worker reads is the process's, so that is what is changed
 * while `run` runs; `run` is given the environment to pass where the code under test takes one.
 */
export async function withoutInstanceUrl<T>(prisma: PrismaClient, run: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const saved = process.env.BASE_URL;
  delete process.env.BASE_URL;
  await prisma.systemSettings.deleteMany({ where: { key: "instance_url" } });
  try {
    return await run({ NODE_ENV: "production" });
  } finally {
    if (saved !== undefined) process.env.BASE_URL = saved;
  }
}
