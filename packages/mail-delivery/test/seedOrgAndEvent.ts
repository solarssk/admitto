import { PrismaClient } from "@admitto/db";
import { setMailSettings } from "@admitto/mailer-config";

/** Creates an organization + event with export_only mail settings - the common prefix several
 * suite `beforeAll`s share before seeding their own file-specific fixtures (attendees, etc). */
export async function seedOrgAndEvent(
  prisma: PrismaClient,
  opts: {
    orgId: string;
    orgName: string;
    orgSlug: string;
    eventId: string;
    eventTitle: string;
    eventSlug: string;
  },
): Promise<void> {
  await prisma.organization.create({
    data: { id: opts.orgId, name: opts.orgName, slug: opts.orgSlug },
  });
  await prisma.event.create({
    data: {
      id: opts.eventId,
      organization_id: opts.orgId,
      title: opts.eventTitle,
      slug: opts.eventSlug,
      date: new Date("2026-09-01"),
    },
  });
  await setMailSettings(
    { scopeType: "organization", scopeId: opts.orgId },
    { provider: "export_only", fromAddress: "events@example.com" },
    prisma,
  );
}
