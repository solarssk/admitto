/**
 * Dev-only bulk attendee generator for local UI/load testing.
 *
 * Usage (from admitto/packages/db):
 *   npx tsx src/scripts/seed-bulk-attendees.ts
 *   EVENT_SLUG=test-event-2024 COUNT=300 npx tsx src/scripts/seed-bulk-attendees.ts
 */
import { PrismaClient, type Prisma } from "../generated/prisma/client.js";
import { createPrismaAdapter } from "../adapter.js";

const prisma = new PrismaClient({ adapter: createPrismaAdapter(process.env["DATABASE_URL"]) });

const EVENT_SLUG = process.env["EVENT_SLUG"] ?? "test-event-2024";
const COUNT = Number(process.env["COUNT"] ?? "300");
const EMAIL_DOMAIN = (process.env["EMAIL_DOMAIN"] ?? "loadtest.example.com").trim().toLowerCase();

/** Restricts EMAIL_DOMAIN to example.com or a subdomain of it (AGENTS.md: synthetic @example.com only). */
function isSyntheticEmailDomain(domain: string): boolean {
  if (domain.length === 0 || domain.length > 255) return false;
  if (domain !== "example.com" && !domain.endsWith(".example.com")) return false;
  return /^[a-z0-9.-]+$/.test(domain);
}

/** Small deterministic PRNG — same COUNT => same names if re-seeded on empty DB. */
function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

function pickWeighted<T extends string>(
  rng: () => number,
  weights: ReadonlyArray<{ value: T; weight: number }>,
): T {
  const total = weights.reduce((s, w) => s + w.weight, 0);
  let roll = rng() * total;
  for (const w of weights) {
    roll -= w.weight;
    if (roll <= 0) return w.value;
  }
  return weights.at(-1)!.value;
}

const FIRST_NAMES = [
  "Anna",
  "Jan",
  "Maria",
  "Piotr",
  "Katarzyna",
  "Tomasz",
  "Agnieszka",
  "Michał",
  "Ewa",
  "Paweł",
  "Joanna",
  "Krzysztof",
  "Monika",
  "Andrzej",
  "Aleksandra",
  "James",
  "Emily",
  "Oliver",
  "Sophie",
  "Liam",
  "Emma",
  "Noah",
  "Mia",
  "Lucas",
  "Hans",
  "Ingrid",
  "Pierre",
  "Claire",
  "Marco",
  "Elena",
] as const;

const LAST_NAMES = [
  "Kowalski",
  "Nowak",
  "Wiśniewski",
  "Wójcik",
  "Kowalczyk",
  "Kamiński",
  "Lewandowski",
  "Zieliński",
  "Szymański",
  "Woźniak",
  "Dąbrowski",
  "Kozłowski",
  "Smith",
  "Johnson",
  "Williams",
  "Brown",
  "Taylor",
  "Anderson",
  "Thomas",
  "Jackson",
  "Müller",
  "Schmidt",
  "Dubois",
  "Martin",
  "Rossi",
  "Ferrari",
  "van der Berg",
  "O'Brien",
  "Nakamura",
  "Patel",
] as const;

const LONG_NAME_SUFFIXES = [
  "von Hohenberg-Schwarzwald",
  "de la Cruz-Martínez",
  "McDonald-Fitzgerald Jr.",
  "with an unusually long display name for layout QA",
] as const;

const COMPANIES = [
  "Oscorp",
  "Acme Corp",
  "Globex International",
  "Initech",
  "Umbrella Systems",
  "Wayne Enterprises",
  "Stark Industries",
  "Wonka Industries",
  "Cyberdyne Systems",
  "Massive Dynamic",
  "Hooli",
  "Pied Piper",
  "Soylent GmbH",
  "Ministry of Digital Affairs",
  "City of Warsaw",
  "Freelance",
  "University of Technology",
  "NGO Open Doors",
  "Media House Alpha",
  "Logistics Pro",
] as const;

const DEPARTMENTS = [
  "Engineering",
  "Sales",
  "Marketing",
  "HR",
  "Finance",
  "Operations",
  "Cybersecurity",
  "R&D",
  "Legal",
  "Support",
  "Executive",
  "Field Services",
] as const;

/** Approximates a realistic distribution when the event's real catalog uses these common names. */
const DEFAULT_TICKET_TYPE_WEIGHTS: Readonly<Record<string, number>> = {
  standard: 58,
  vip: 18,
  aaa: 10,
  press: 5,
  speaker: 4,
  disabled: 3,
  staff: 2,
};
const FALLBACK_TICKET_TYPE_WEIGHT = 5;

function buildTicketTypeWeights(
  keys: readonly string[],
): ReadonlyArray<{ value: string; weight: number }> {
  return keys.map((key) => ({
    value: key,
    weight: DEFAULT_TICKET_TYPE_WEIGHTS[key.toLowerCase()] ?? FALLBACK_TICKET_TYPE_WEIGHT,
  }));
}

/** Bare attendees for list/search/load testing — no check-in or RSVP presets. */
const BULK_STATUS = "registered" as const;
const BULK_RSVP = "none" as const;

const DUPLICATE_DISPLAY_NAMES = [
  "Anna Kowalski",
  "Jan Nowak",
  "Maria Kowalska",
  "Piotr Wiśniewski",
  "James Smith",
  "Ewa Kowalski",
  "Tomasz Wójcik",
  "Sophie Martin",
] as const;

function buildName(rng: () => number, index: number): string {
  // ~12% forced duplicates — same display name, different email (list/search QA).
  if (index % 8 === 0) {
    return DUPLICATE_DISPLAY_NAMES[Math.floor(index / 8) % DUPLICATE_DISPLAY_NAMES.length]!;
  }
  const first = pick(rng, FIRST_NAMES);
  const last = pick(rng, LAST_NAMES);
  if (index % 47 === 0) {
    return `${first} ${last} ${pick(rng, LONG_NAME_SUFFIXES)}`;
  }
  if (index % 19 === 0) {
    return `${first} ${last}-${pick(rng, LAST_NAMES)}`;
  }
  return `${first} ${last}`;
}

function buildAttendeeRow(
  rng: () => number,
  eventId: string,
  index: number,
  ticketTypeWeights: ReadonlyArray<{ value: string; weight: number }>,
): Prisma.AttendeeCreateManyInput {
  const hasCompany = rng() < 0.68;
  const company = hasCompany ? pick(rng, COMPANIES) : null;
  const department =
    hasCompany && rng() < 0.45 ? pick(rng, DEPARTMENTS) : null;

  return {
    event_id: eventId,
    email: `loadtest.${String(index).padStart(4, "0")}@${EMAIL_DOMAIN}`,
    name: buildName(rng, index),
    ticket_type: pickWeighted(rng, ticketTypeWeights),
    company,
    department,
    status: BULK_STATUS,
    rsvp_status: BULK_RSVP,
    admitted_at: null,
    token_hash: null,
    token_enc: null,
    external_uuid: null,
    qr_payload: null,
  };
}

async function main(): Promise<void> {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("Refusing to run bulk attendee seed in production");
  }
  if (!Number.isInteger(COUNT) || COUNT < 1 || COUNT > 5000) {
    throw new Error("COUNT must be an integer between 1 and 5000");
  }
  if (!isSyntheticEmailDomain(EMAIL_DOMAIN)) {
    throw new Error(`EMAIL_DOMAIN must be "example.com" or a subdomain of it (got "${EMAIL_DOMAIN}")`);
  }

  const event = await prisma.event.findUnique({
    where: { slug: EVENT_SLUG },
    select: { id: true, title: true, slug: true, date: true },
  });
  if (!event) {
    throw new Error(`Event not found for slug "${EVENT_SLUG}"`);
  }

  const ticketTypes = await prisma.ticketType.findMany({
    where: { event_id: event.id },
    select: { key: true },
    orderBy: { sort_order: "asc" },
  });
  if (ticketTypes.length === 0) {
    throw new Error(
      `Event "${EVENT_SLUG}" has no ticket types configured. Create at least one before running this script`,
    );
  }
  const ticketTypeWeights = buildTicketTypeWeights(ticketTypes.map((t) => t.key));

  const before = await prisma.attendee.count({ where: { event_id: event.id } });
  const rng = mulberry32(420_260_708);

  const rows: Prisma.AttendeeCreateManyInput[] = [];
  for (let i = 1; i <= COUNT; i++) {
    rows.push(buildAttendeeRow(rng, event.id, i, ticketTypeWeights));
  }

  const BATCH = 100;
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += BATCH) {
    const batch = rows.slice(offset, offset + BATCH);
    const result = await prisma.attendee.createMany({
      data: batch,
      skipDuplicates: true,
    });
    inserted += result.count;
  }

  const after = await prisma.attendee.count({ where: { event_id: event.id } });
  const active = await prisma.attendee.count({
    where: {
      event_id: event.id,
      status: { notIn: ["revoked", "cancelled"] },
    },
  });
  console.log(`Event: "${event.title}" (${event.slug})`);
  console.log(`Attendees: ${before} → ${after} (+${after - before} new, ${inserted} inserted this run)`);
  console.log(`Active (non revoked/cancelled): ${active}`);
  console.log(`Bulk rows: registered / no RSVP / no check-in / no token`);
  console.log(`Emails: loadtest.0001@${EMAIL_DOMAIN} … loadtest.${String(COUNT).padStart(4, "0")}@${EMAIL_DOMAIN}`);
  console.log("Re-run is safe (skipDuplicates on email). Delete with:");
  console.log(`  DELETE FROM "Attendee" WHERE event_id = '${event.id}' AND email LIKE 'loadtest.%@${EMAIL_DOMAIN}';`);
}

try {
  await main();
} catch (err: unknown) {
  console.error(err);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
