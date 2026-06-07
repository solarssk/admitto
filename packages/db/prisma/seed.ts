import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const event = await prisma.event.upsert({
    where: { slug: 'test-event-2024' },
    update: {},
    create: {
      title: 'Test Event 2024',
      slug: 'test-event-2024',
      date: new Date('2024-09-01T10:00:00Z'),
      location: 'Convention Center, City',
    },
  });

  console.log(`Event: ${event.title} (${event.id})`);

  const attendees = [
    {
      email: 'alice@example.com',
      name: 'Alice Smith',
      token: 'seed-token-alice-00000001',
      external_uuid: 'ext-uuid-alice',
    },
    {
      email: 'bob@example.com',
      name: 'Bob Jones',
      token: 'seed-token-bob-000000002',
      external_uuid: 'ext-uuid-bob',
    },
    {
      email: 'carol@example.com',
      name: 'Carol Taylor',
      token: 'seed-token-carol-0000003',
      external_uuid: null,
    },
  ];

  for (const a of attendees) {
    const attendee = await prisma.attendee.upsert({
      where: { token: a.token },
      update: { name: a.name, status: 'registered' },
      create: {
        event_id: event.id,
        email: a.email,
        name: a.name,
        token: a.token,
        external_uuid: a.external_uuid,
        status: 'registered',
      },
    });
    console.log(`Attendee: ${attendee.name} <${attendee.email}> token=${attendee.token}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
