/**
 * Seeds a disposable database for the check-in load test (.github/workflows/load-test.yml):
 * one org and event, N operator accounts scoped to that event, and M synthetic attendees, then
 * writes the ids and credentials the k6 script needs to a JSON file.
 *
 * Usage: node --import tsx scripts/load-test/seed.ts <operators> <attendees> <contested> <out.json>
 *
 * Refuses to run without E2E_SEED_ALLOW_WRITE=true (same deliberate opt-in as
 * apps/admin/e2e/seed.ts): it writes fixed-password accounts into whatever DATABASE_URL is set.
 * Arguments rather than env vars on purpose, so this stays out of the deploy env catalog.
 */
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { prisma } from "@admitto/db";
import { createUser } from "@admitto/auth";

if (
  process.env["NODE_ENV"] === "production" ||
  process.env["E2E_SEED_ALLOW_WRITE"] !== "true"
) {
  throw new Error(
    "Refusing to seed: needs E2E_SEED_ALLOW_WRITE=true and NODE_ENV != production",
  );
}

const [operatorsArg, attendeesArg, contestedArg, outPath] =
  process.argv.slice(2);
const operatorCount = Number(operatorsArg);
const attendeeCount = Number(attendeesArg);
const contestedCount = Number(contestedArg);
if (
  !outPath ||
  ![operatorCount, attendeeCount, contestedCount].every(Number.isInteger)
) {
  throw new Error(
    "Usage: seed.ts <operators> <attendees> <contested> <out.json>",
  );
}

const org = await prisma.organization.create({
  data: { name: "Load Test Org", slug: `load-test-org-${Date.now()}` },
});
const event = await prisma.event.create({
  data: {
    title: "Load Test Event",
    slug: `load-test-event-${Date.now()}`,
    date: new Date("2026-09-01T10:00:00Z"),
    organization_id: org.id,
  },
});

// Per-run tag so the seed can run again against the same database (emails are unique).
const runTag = Date.now();
const operators: { email: string; password: string }[] = [];
for (let i = 0; i < operatorCount; i++) {
  const email = `load.operator.${runTag}.${i}@example.com`;
  const password = randomBytes(18).toString("base64");
  const user = await createUser(prisma, {
    email,
    password,
    displayName: `Load Operator ${i}`,
  });
  await prisma.roleAssignment.create({
    data: {
      user_id: user.id,
      role: "operator",
      scope_type: "event",
      scope_id: event.id,
    },
  });
  operators.push({ email, password });
}

await prisma.attendee.createMany({
  data: Array.from({ length: attendeeCount }, (_, i) => ({
    event_id: event.id,
    email: `load.attendee.${i}@example.com`,
    name: `Load Attendee ${i}`,
    status: "confirmed" as const,
  })),
});

const attendees = await prisma.attendee.findMany({
  where: { event_id: event.id },
  select: { id: true },
  orderBy: { email: "asc" },
});
const ids = attendees.map((a) => a.id);

await writeFile(
  outPath,
  JSON.stringify({
    eventId: event.id,
    operators,
    // Each contested attendee is admitted by several operators at once, the "don't double-admit"
    // case; the rest are admitted exactly once by whichever operator draws them.
    contestedIds: ids.slice(0, contestedCount),
    distinctIds: ids.slice(contestedCount),
  }),
);
console.log(
  `[load-test] seeded event ${event.id}: ${operators.length} operators, ${ids.length} attendees`,
);
await prisma.$disconnect();
