/**
 * Creates a synthetic org, event and event-scoped operator inside the DAST workflow's compose stack
 * (.github/workflows/dast-baseline.yml), so ZAP can scan /operator as a signed-in operator. The
 * stack has no CLI for this (only bootstrap-superadmin), and the app image contains the built
 * @admitto/db and @admitto/auth packages, so the workflow pipes this file into `node` in the app
 * container. Prints the event id as the last line of stdout.
 *
 * Only ever run against that disposable stack. Reads DAST_OPERATOR_EMAIL and
 * DAST_OPERATOR_PASSWORD from the environment.
 */
import { prisma } from "@admitto/db";
import { createUser } from "@admitto/auth";

const email = process.env.DAST_OPERATOR_EMAIL;
const password = process.env.DAST_OPERATOR_PASSWORD;
if (!email || !password) {
  throw new Error(
    "DAST_OPERATOR_EMAIL and DAST_OPERATOR_PASSWORD are required",
  );
}

const org = await prisma.organization.create({
  data: { name: "DAST Org", slug: "dast-org" },
});
const event = await prisma.event.create({
  data: {
    title: "DAST Event",
    slug: "dast-event",
    date: new Date("2026-09-01T10:00:00Z"),
    organization_id: org.id,
  },
});
await prisma.attendee.create({
  data: {
    event_id: event.id,
    email: "dast.attendee@example.com",
    name: "Dast Attendee",
    status: "confirmed",
  },
});
const user = await createUser(prisma, {
  email,
  password,
  displayName: "DAST Operator",
});
await prisma.roleAssignment.create({
  data: {
    user_id: user.id,
    role: "operator",
    scope_type: "event",
    scope_id: event.id,
  },
});
await prisma.$disconnect();
console.log(event.id);
