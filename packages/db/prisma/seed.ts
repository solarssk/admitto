import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const bobDevToken = "devticketbob0000000000000000000000000000000";
const daveDevToken = "devticketdave000000000000000000000000000000";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function main() {
  const event = await prisma.event.upsert({
    where: { slug: "test-event-2024" },
    update: {},
    create: {
      title: "Test Event 2024",
      slug: "test-event-2024",
      date: new Date("2024-09-01T10:00:00Z"),
      location: "Convention Center, City",
    },
  });

  const attendeeData = [
    {
      email: "alice@example.com",
      name: "Alice Smith",
      token_hash: null,
      external_uuid: null,
      qr_payload: null,
      status: "registered",
      note: "Imported internal attendee without issuance yet",
    },
    {
      email: "bob@example.com",
      name: "Bob Jones",
      token_hash: hashToken(bobDevToken),
      external_uuid: null,
      qr_payload: null,
      status: "confirmed",
      note: `Issued internal attendee with deterministic dev token: /t/${bobDevToken}`,
    },
    {
      email: "carol@example.com",
      name: "Carol Taylor",
      token_hash: null,
      external_uuid: "ext-uuid-carol",
      qr_payload: "AGENCY-QR-CAROL",
      status: "registered",
      note: "Agency-provided attendee",
    },
    {
      email: "dave@example.com",
      name: "Dave Brown",
      token_hash: hashToken(daveDevToken),
      external_uuid: null,
      qr_payload: null,
      status: "cancelled",
      note: "Cancelled attendee should render as an invalid ticket",
    },
  ] as const;

  let upserted = 0;
  for (const a of attendeeData) {
    await prisma.attendee.upsert({
      where: { event_id_email: { event_id: event.id, email: a.email } },
      update: {
        name: a.name,
        token_hash: a.token_hash,
        external_uuid: a.external_uuid,
        qr_payload: a.qr_payload,
        status: a.status,
      },
      create: {
        event_id: event.id,
        email: a.email,
        name: a.name,
        token_hash: a.token_hash,
        external_uuid: a.external_uuid,
        qr_payload: a.qr_payload,
        status: a.status,
      },
    });
    upserted++;
    console.log(`Seeded ${a.email} — ${a.note}`);
  }

  console.log(`Seeded event "${event.slug}" (${event.id.slice(0, 8)}...) with ${upserted} attendees.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
