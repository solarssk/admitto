import { createHash } from "node:crypto";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { createPrismaAdapter } from "../src/adapter.js";
import { encryptToString } from "@admitto/crypto";

const prisma = new PrismaClient({ adapter: createPrismaAdapter(process.env["DATABASE_URL"]) });
const bobDevToken = "devticketbob0000000000000000000000000000000";
const daveDevToken = "devticketdave000000000000000000000000000000";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Wraps encryptToString() for seed use only.
// Returns null (+ logs a warning) if ENCRYPTION_KEY is absent or invalid, so the seed
// always completes its DB work regardless of local key configuration.
function tryEncrypt(token: string): string | null {
  try {
    return encryptToString(token);
  } catch (err) {
    console.warn("tryEncrypt failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function main() {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("Refusing to run development seed in production");
  }

  const bobTokenEnc = tryEncrypt(bobDevToken);
  const daveTokenEnc = tryEncrypt(daveDevToken);
  if (bobTokenEnc === null) {
    console.warn(
      "ENCRYPTION_KEY not set or invalid — token_enc will be null for pre-issued dev attendees.\n" +
        "To enable full dev parity: openssl rand -base64 32 → add to packages/db/.env",
    );
  }

  // Default organization — stable ID 'org_default' matches the tenant_foundation migration backfill.
  const org = await prisma.organization.upsert({
    where: { slug: "default" },
    update: {},
    create: { id: "org_default", name: "Default", slug: "default" },
  });

  const event = await prisma.event.upsert({
    where: { slug: "test-event-2024" },
    update: {},
    create: {
      title: "Test Event 2024",
      slug: "test-event-2024",
      date: new Date("2024-09-01T10:00:00Z"),
      organization_id: org.id,
    },
  });

  await prisma.eventLocation.upsert({
    where: { event_id: event.id },
    update: {},
    create: {
      event_id: event.id,
      venue_name: "Convention Center, City",
    },
  });

  const attendeeData = [
    {
      email: "alice@example.com",
      name: "Alice Smith",
      token_hash: null,
      token_enc: null,
      external_uuid: null,
      qr_payload: null,
      status: "registered",
      note: "Imported internal attendee without issuance yet",
    },
    {
      email: "bob@example.com",
      name: "Bob Jones",
      token_hash: hashToken(bobDevToken),
      token_enc: bobTokenEnc,
      external_uuid: null,
      qr_payload: null,
      status: "confirmed",
      note: `Issued internal attendee with deterministic dev token: /t/${bobDevToken}`,
    },
    {
      email: "carol@example.com",
      name: "Carol Taylor",
      token_hash: null,
      token_enc: null,
      external_uuid: "ext-uuid-carol",
      qr_payload: "AGENCY-QR-CAROL",
      status: "registered",
      note: "Agency-provided attendee",
    },
    {
      email: "dave@example.com",
      name: "Dave Brown",
      token_hash: hashToken(daveDevToken),
      token_enc: daveTokenEnc,
      external_uuid: null,
      qr_payload: null,
      status: "cancelled",
      note: "Cancelled attendee should render as an invalid ticket",
    },
  ];

  let upserted = 0;
  for (const a of attendeeData) {
    await prisma.attendee.upsert({
      where: { event_id_email: { event_id: event.id, email: a.email } },
      update: {
        name: a.name,
        token_hash: a.token_hash,
        // For attendees that are not pre-issued (token_hash = null in fixture, e.g. Alice,
        // Carol), always write token_enc: null to clear any stale value.
        // For pre-issued attendees (Bob, Dave): only overwrite when we have a value — skip
        // when encryption is unavailable so an existing token_enc isn't wiped mid-run.
        ...(a.token_hash === null || a.token_enc !== null ? { token_enc: a.token_enc } : {}),
        external_uuid: a.external_uuid,
        qr_payload: a.qr_payload,
        status: a.status,
      },
      create: {
        event_id: event.id,
        email: a.email,
        name: a.name,
        token_hash: a.token_hash,
        token_enc: a.token_enc,
        external_uuid: a.external_uuid,
        qr_payload: a.qr_payload,
        status: a.status,
      },
    });
    upserted++;
    console.log(`Seeded ${a.email} — ${a.note}`);
  }

  console.log(`Seeded org "${org.slug}" (${org.id})`);
  console.log(`Seeded event "${event.slug}" (${event.id.slice(0, 8)}...) with ${upserted} attendees.`);
}

try {
  await main();
} catch (e) {
  console.error(e);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
