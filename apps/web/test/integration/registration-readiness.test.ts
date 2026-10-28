import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { getEventRegistrationSettings } from "../../src/admin/event-registration-settings.js";
import { setEnabledAccessMethods } from "../../src/registration/access-methods.js";
import { resolveRegistration } from "../../src/registration/form-model.js";
import { READINESS_KEYS, readinessBlockers, type RegistrationReadinessKey } from "../../src/registration/readiness.js";
import { TURNSTILE_SETTINGS_KEY } from "../../src/registration/turnstile-settings.js";
import { PAST, eventSeeder, type EventSeed } from "../helpers/registration-submit-harness.js";

/**
 * The readiness of an event against the public page it is about. What the plan asks of it (PR 99a): an event that is
 * judged ready really opens its form, and an event that is judged not ready for a reason that concerns the form does not.
 * Each row below sets an event and its system up, and says what the page does (`resolveRegistration`, the one decision the
 * form and the submit route share) and which checks are not met. The rows run against a real database, so that the
 * answer of the page is the page's own and not a copy of its rules.
 *
 * Three checks are not about the form but about what it leads to (`mail_provider`, `instance_url`, `required_fields`): the
 * form opens without them, and the rows say so, so that nobody takes them for conditions of the page.
 */
const ORG = "org-reg99a-readiness";
const NOT_ABOUT_THE_FORM: readonly RegistrationReadinessKey[] = ["mail_provider", "instance_url", "required_fields"];

/** The marker of PR 111: its module is what lets the page open for the password. */
const PASSWORD_WAY_IN_IS_BUILT = existsSync(join(dirname(fileURLToPath(import.meta.url)), "../../src/registration/event-password.ts"));

let prisma: PrismaClient;
let seeder: ReturnType<typeof eventSeeder>;
let counter = 0;

async function setMail(on: boolean): Promise<void> {
  await prisma.mailSettings.deleteMany({ where: { scope_type: "organization", scope_id: ORG } });
  if (on) {
    await prisma.mailSettings.create({
      data: { scope_type: "organization", scope_id: ORG, provider: "export_only", from_address: "events@example.net" },
    });
  }
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  seeder = eventSeeder(prisma, ORG);
  await seeder.prepare();
});

beforeEach(async () => {
  await seeder.setSystemKeys(true);
  await setMail(true);
});

afterAll(async () => {
  if (!prisma) return;
  await seeder.wipe();
  await prisma.mailSettings.deleteMany({ where: { scope_type: "organization", scope_id: ORG } });
  await prisma.$disconnect();
});

type Row = {
  name: string;
  /** The event: it has registration on (`automatic`) and the link, unless the row says otherwise. */
  seed?: EventSeed;
  /** What is done to the system around the event. */
  system?: () => Promise<unknown>;
  /** The instance has no address. */
  noInstanceUrl?: boolean;
  page: "open" | "not_found" | "closed";
  blockers: RegistrationReadinessKey[];
  /** The row needs the password way in of PR 111 to be in the code to be true. */
  needsPassword?: boolean;
};

const bothWays = () => setEnabledAccessMethods(prisma, ["link", "password"]);

const ROWS: Row[] = [
  { name: "an event that has everything", page: "open", blockers: [] },
  { name: "an event that has everything, in the mode of approval", seed: { settings: { mode: "approval" } }, page: "open", blockers: [] },
  { name: "an event that is ready and has registration off: ready, and still a not-found page", seed: { settings: { mode: null } }, page: "not_found", blockers: [] },
  { name: "no way in chosen", seed: { settings: { access_methods: [] } }, page: "not_found", blockers: ["access_method"] },
  { name: "the company sign-in, which an event cannot choose yet", seed: { settings: { access_methods: ["sso"] } }, page: "not_found", blockers: ["access_method"] },
  { name: "two ways in", seed: { settings: { access_methods: ["link", "password"] } }, system: bothWays, page: "not_found", blockers: ["access_method"] },
  { name: "a link that the system administrator has not enabled", system: () => setEnabledAccessMethods(prisma, []), page: "not_found", blockers: ["access_method_enabled"] },
  {
    name: "no Turnstile keys",
    system: () => prisma.systemSettings.deleteMany({ where: { key: TURNSTILE_SETTINGS_KEY } }),
    page: "not_found",
    blockers: ["bot_protection"],
  },
  {
    name: "a password that the system administrator has not enabled, and nobody set",
    seed: { settings: { access_methods: ["password"] } },
    page: "not_found",
    blockers: ["access_method_enabled", "password"],
  },
  { name: "a password nobody set", seed: { settings: { access_methods: ["password"] } }, system: bothWays, page: "not_found", blockers: ["password"] },
  {
    name: "a password that is set",
    seed: { settings: { access_methods: ["password"], password_hash: "$argon2id$not-checked-here" } },
    system: bothWays,
    page: "open",
    blockers: [],
    needsPassword: true,
  },
  { name: "no privacy notice", seed: { legal: { privacy: false } }, page: "not_found", blockers: ["legal_documents"] },
  { name: "terms that are only a draft", seed: { legal: { terms: false, draftTerms: true } }, page: "not_found", blockers: ["legal_documents"] },
  { name: "a consent the form asks for and the event has not published", seed: { settings: { consent_keys: ["photos"] } }, page: "not_found", blockers: ["legal_documents"] },
  { name: "a consent the form asks for and the event has published", seed: { settings: { consent_keys: ["photos"] }, legal: { consents: ["photos"] } }, page: "open", blockers: [] },
  {
    name: "a required choice with no choices, which nobody could answer",
    seed: { fields: [{ source_field: "diet", label: "Diet", type: "select", required: true, options: [] }] },
    page: "not_found",
    blockers: ["form_questions"],
  },
  {
    name: "an optional choice with no choices, which the form leaves out",
    seed: { fields: [{ source_field: "diet", label: "Diet", type: "select", options: [] }] },
    page: "open",
    blockers: [],
  },
  {
    name: "a required question the form does not ask (left by an import)",
    seed: { fields: [{ source_field: "left", label: "Left", required: true, show_on_form: false }] },
    page: "open",
    blockers: ["required_fields"],
  },
  { name: "an archived event", seed: { archived: true }, page: "not_found", blockers: ["event_not_archived"] },
  { name: "an event that is over", seed: { date: PAST }, page: "closed", blockers: ["event_not_ended"] },
  { name: "no mail provider", system: () => setMail(false), page: "open", blockers: ["mail_provider"] },
  { name: "no address of the instance", noInstanceUrl: true, page: "open", blockers: ["instance_url"] },
  {
    name: "everything missing at once",
    seed: { archived: true, date: PAST, legal: { privacy: false, terms: false }, settings: { access_methods: [] } },
    system: async () => {
      await setMail(false);
      await prisma.systemSettings.deleteMany({ where: { key: TURNSTILE_SETTINGS_KEY } });
    },
    noInstanceUrl: true,
    page: "not_found",
    blockers: ["access_method", "bot_protection", "legal_documents", "mail_provider", "instance_url", "event_not_archived", "event_not_ended"],
  },
];

/** Reads the readiness of the stored event as an instance without an address would, when the row says so. */
async function readinessOf(eventId: string, noInstanceUrl: boolean) {
  const saved = process.env.BASE_URL;
  if (noInstanceUrl) {
    delete process.env.BASE_URL;
    await prisma.systemSettings.deleteMany({ where: { key: "instance_url" } });
  }
  try {
    return await getEventRegistrationSettings(prisma, eventId, noInstanceUrl ? { env: { NODE_ENV: "production" } } : {});
  } finally {
    if (saved !== undefined) process.env.BASE_URL = saved;
  }
}

describe("the readiness of an event and the page it is about", () => {
  it.each(ROWS)("$name", async (row) => {
    if (row.needsPassword && !PASSWORD_WAY_IN_IS_BUILT) return;
    counter += 1;
    const slug = `reg99a-ready-${counter}`;
    await row.system?.();
    const eventId = await seeder.addEvent(slug, {
      ...row.seed,
      settings: { mode: "automatic", access_methods: ["link"], consent_keys: [], ...row.seed?.settings },
    });

    const settings = await readinessOf(eventId, row.noInstanceUrl === true);
    const page = await resolveRegistration(prisma, slug, new Date());

    const blockers = readinessBlockers(settings!.readiness);
    expect(blockers).toEqual(row.blockers);
    expect(page.kind).toBe(row.page);
    // The two rules, as the plan states them: ready opens the form, and a check about the form that is missing closes it.
    const formBlockers = blockers.filter((key) => !NOT_ABOUT_THE_FORM.includes(key));
    const modeOn = row.seed?.settings?.mode !== null;
    if (modeOn && formBlockers.length === 0) expect(page.kind).toBe("open");
    if (formBlockers.length > 0) expect(page.kind).not.toBe("open");
  });

  it("names its checks with the keys of the vocabulary, and no other", async () => {
    const eventId = await seeder.addEvent(`reg99a-ready-vocabulary-${(counter += 1)}`, {
      settings: { mode: null, access_methods: ["password"] },
    });

    const settings = await getEventRegistrationSettings(prisma, eventId);

    expect(settings!.readiness.length).toBeGreaterThan(0);
    for (const check of settings!.readiness) expect(READINESS_KEYS).toContain(check.key);
  });

  it("opens the form of an event on the moment its last check is met, and not before", async () => {
    const slug = `reg99a-ready-moment-${(counter += 1)}`;
    await prisma.systemSettings.deleteMany({ where: { key: TURNSTILE_SETTINGS_KEY } });
    const eventId = await seeder.addEvent(slug, { settings: { mode: "automatic", access_methods: ["link"] } });

    const before = await getEventRegistrationSettings(prisma, eventId);
    const closed = await resolveRegistration(prisma, slug, new Date());
    await seeder.setSystemKeys(true);
    const after = await getEventRegistrationSettings(prisma, eventId);
    const opened = await resolveRegistration(prisma, slug, new Date());

    expect(readinessBlockers(before!.readiness)).toEqual(["bot_protection"]);
    expect(closed.kind).toBe("not_found");
    expect(readinessBlockers(after!.readiness)).toEqual([]);
    expect(opened.kind).toBe("open");
  });
});
