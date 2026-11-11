/**
 * The bot challenge of `POST /r/:slug` on an event's own address (D-C6): a challenge that Cloudflare says was solved on the event's own
 * address is accepted once that address is verified, as one solved on the instance's always is. An address that is only set, and the
 * address of another event, are not the host of this form, so a token solved there is refused. The address is read from the event, not
 * from the request.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { HOST, eventSeeder, harness } from "../helpers/registration-submit-harness.js";

const ORG = "org-reg119a-challenge";
const OWN = "summit.acme.example";
const OTHER = "gala.other.example";

let prisma: PrismaClient;
let seeder: ReturnType<typeof eventSeeder>;
let h: ReturnType<typeof harness>;
const ids = { own: "", other: "" };
let counter = 0;

beforeAll(async () => {
  prisma = createTestPrismaClient();
  seeder = eventSeeder(prisma, ORG);
  await seeder.prepare();
  h = harness({ prisma });
  ids.own = await seeder.addEvent("reg119a-own", { settings: { mode: "automatic", verify_email: true } });
  ids.other = await seeder.addEvent("reg119a-other", { settings: { mode: "automatic", verify_email: true } });
  await prisma.eventRegistrationSettings.update({ where: { event_id: ids.other }, data: { custom_domain: OTHER, custom_domain_verified_at: new Date() } });
});

afterAll(async () => {
  await seeder?.wipe();
  await prisma?.$disconnect();
});

const setOwn = (verified: boolean) =>
  prisma.eventRegistrationSettings.update({
    where: { event_id: ids.own },
    data: { custom_domain: OWN, custom_domain_verified_at: verified ? new Date() : null, custom_domain_status: verified ? "ok" : "unchecked" },
  });

/** A guest's submission whose challenge was solved on `host`. */
async function submitSolvedOn(host: string): Promise<Response> {
  const slug = "reg119a-own";
  const email = `guest-${(counter += 1)}@example.com`;
  return h.post(slug, h.body(slug, { first_name: "Ada", last_name: "Example", email, challenge: h.cf.token(slug, `on=${host}`) }));
}

describe("the host a challenge may have been solved on", () => {
  it("is the instance's alone while the event has no address of its own, or has one that is not verified", async () => {
    expect((await submitSolvedOn(HOST)).status).toBe(200);
    expect((await submitSolvedOn(OWN)).status).toBe(400);

    await setOwn(false);

    expect((await submitSolvedOn(HOST)).status).toBe(200);
    expect((await submitSolvedOn(OWN)).status).toBe(400);
  });

  it("is also the event's own address once it is verified, and still the instance's: an old link keeps working", async () => {
    await setOwn(true);

    expect((await submitSolvedOn(OWN)).status).toBe(200);
    expect((await submitSolvedOn(HOST)).status).toBe(200);
  });

  it("is never the address of another event, nor a host the request names", async () => {
    await setOwn(true);

    for (const host of [OTHER, "evil.example", `evil.${OWN}`, `${OWN}.evil.example`]) {
      const res = await submitSolvedOn(host);
      expect(res.status, host).toBe(400);
    }
  });
});
