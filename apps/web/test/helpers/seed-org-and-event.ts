import { PrismaClient } from "@admitto/db";

/** Creates one organization and one event under it - the common pair several integration test
 * `seed()` functions repeat (often twice, for an "A"/"B" org+event pair used to prove scoping). */
export async function seedOrgAndEvent(
  client: PrismaClient,
  org: { id: string; name: string; slug: string },
  event: { id: string; title: string; slug: string; date: string; organizationId: string },
): Promise<void> {
  await client.organization.create({ data: org });
  await client.event.create({
    data: {
      id: event.id,
      title: event.title,
      slug: event.slug,
      date: new Date(event.date),
      organization_id: event.organizationId,
    },
  });
}

/** Creates an admin (scoped to `orgId`) and an operator (scoped to `eventId`) - the common pair
 * several single-org/single-event integration test `seed()` functions repeat. */
export async function createAdminAndOp(
  client: PrismaClient,
  opts: { adminEmail: string; opEmail: string; passwordHash: string; orgId: string; eventId: string },
): Promise<{ adminId: string; opId: string }> {
  const adminUser = await client.user.create({ data: { email: opts.adminEmail, password_hash: opts.passwordHash } });
  const opUser = await client.user.create({ data: { email: opts.opEmail, password_hash: opts.passwordHash } });
  await client.roleAssignment.createMany({
    data: [
      { user_id: adminUser.id, role: "admin", scope_type: "organization", scope_id: opts.orgId },
      { user_id: opUser.id, role: "operator", scope_type: "event", scope_id: opts.eventId },
    ],
  });
  return { adminId: adminUser.id, opId: opUser.id };
}
