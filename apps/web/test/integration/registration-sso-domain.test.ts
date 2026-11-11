/**
 * The guest's company sign-in on an event's own address (D-C6), against a real database and a stand-in identity provider, through the
 * real app. The return address at the provider is one per host: on the event's own address once it is verified and the guest is on it, on
 * the instance's otherwise (an old link to the instance keeps working), and the host that the token is exchanged for is always the one the
 * guest was sent to. The request only chooses between the two addresses the database and the configuration give: no host it carries is
 * ever used as a return address.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { startMockOidcIdp, stopMockOidcIdp, type MockOidcIdp } from "../helpers/mock-oidc-idp.js";
import {
  GUEST_SSO_SESSION_COOKIE,
  Jar,
  goToProvider,
  installProvider,
  removeProvider,
  walk,
  type App,
} from "../helpers/registration-sso-harness.js";
import { ORIGIN, SelectiveStore, eventSeeder, harness } from "../helpers/registration-submit-harness.js";

const ORG = "org-reg119a-sso";
const OWN = "summit.acme.example";
const OWN_ORIGIN = `https://${OWN}`;
const SLUG = "reg119a-sso-event";

let prisma: PrismaClient;
let idp: MockOidcIdp;
let seeder: ReturnType<typeof eventSeeder>;
let h: ReturnType<typeof harness>;
let eventId = "";

/** The app as a browser on `host` sees it: the address of every request is the host's, the way a proxy that passes the host on shows it. */
function onHost(host: string): App {
  return { request: (input, init) => h.app.request(input.replace(ORIGIN, `https://${host}`), init) };
}

const setDomain = (verified: boolean) =>
  prisma.eventRegistrationSettings.update({
    where: { event_id: eventId },
    data: { custom_domain: OWN, custom_domain_verified_at: verified ? new Date() : null, custom_domain_status: verified ? "ok" : "unchecked" },
  });

beforeAll(async () => {
  prisma = createTestPrismaClient();
  idp = await startMockOidcIdp();
  seeder = eventSeeder(prisma, ORG);
  await seeder.prepare();
  eventId = await seeder.addEvent(SLUG, { settings: { access_methods: ["sso"], mode: "approval" } });
  h = harness({ prisma, store: new SelectiveStore() });
});

beforeEach(async () => {
  await installProvider(prisma, idp);
  await prisma.registrationSsoState.deleteMany();
  await prisma.eventRegistrationSettings.update({
    where: { event_id: eventId },
    data: { custom_domain: null, custom_domain_verified_at: null, custom_domain_status: "unchecked" },
  });
});

afterAll(async () => {
  if (!prisma) return;
  await prisma.registrationSsoState.deleteMany();
  await removeProvider(prisma);
  await seeder.wipe();
  await prisma.$disconnect();
  await stopMockOidcIdp(idp);
});

/** The return address of the start and the one the token was asked for, after a whole flow on `host`. */
async function flowOn(host: string) {
  const app = onHost(host);
  const jar = new Jar();
  const before = idp.tokenRedirectUris().length;
  const w = await walk(app, jar, SLUG, idp);
  const asked = idp.tokenRedirectUris().slice(before);
  return { w, jar, sentTo: w.authorizeUrl.searchParams.get("redirect_uri"), asked };
}

describe("the return address of a guest's sign-in", () => {
  it("is the instance's for an event with no address of its own, wherever the guest is", async () => {
    for (const host of ["tickets.example.com", OWN]) {
      const { sentTo, asked } = await flowOn(host);
      expect(sentTo, host).toBe("https://tickets.example.com/sso/callback");
      expect(asked, host).toEqual([sentTo]);
    }
  });

  it("is the instance's while the address is set but not verified, even for a guest who is on it", async () => {
    await setDomain(false);
    const { sentTo, asked } = await flowOn(OWN);
    expect(sentTo).toBe("https://tickets.example.com/sso/callback");
    expect(asked).toEqual([sentTo]);
  });

  it("is the event's own once it is verified and the guest is on it, and the token is asked for with the same one", async () => {
    await setDomain(true);

    const { w, jar, sentTo, asked } = await flowOn(OWN);

    expect(sentTo).toBe(`${OWN_ORIGIN}/sso/callback`);
    expect(asked).toEqual([sentTo]);
    // The provider sent the guest back to the host they began on, where the host-only cookies are: the flow ends in a sign-in.
    expect(w.callbackUrl.origin).toBe(OWN_ORIGIN);
    expect(w.callback.status).toBe(302);
    expect(w.callback.headers.get("location")).toBe(`/r/${SLUG}`);
    expect(jar.names()).toEqual([GUEST_SSO_SESSION_COOKIE]);
  });

  it("stays the instance's for a guest who comes by an old link to the instance, which goes on working after the address is verified", async () => {
    await setDomain(true);

    const { w, jar, sentTo, asked } = await flowOn("tickets.example.com");

    expect(sentTo).toBe("https://tickets.example.com/sso/callback");
    expect(asked).toEqual([sentTo]);
    expect(w.callbackUrl.origin).toBe("https://tickets.example.com");
    expect(jar.names()).toEqual([GUEST_SSO_SESSION_COOKIE]);
  });

  it("is never built on a host the request merely carries: another host gets the instance's address", async () => {
    await setDomain(true);
    for (const host of ["evil.example.net", `evil.${OWN}`, `${OWN}.evil.example.net`, "other.acme.example"]) {
      const { sentTo, asked } = await flowOn(host);
      expect(sentTo, host).toBe("https://tickets.example.com/sso/callback");
      expect(asked, host).toEqual([sentTo]);
    }
  });

  it("is the one of the host even in capitals, and with a port or without", async () => {
    await setDomain(true);
    // The origin of a URL is lower case and without a default port, whichever way the host was written.
    for (const host of [OWN.toUpperCase(), `${OWN}:443`]) {
      const { sentTo } = await flowOn(host);
      expect(sentTo, host).toBe(`${OWN_ORIGIN}/sso/callback`);
    }
  });

  it("does not let a flow begun on the instance end on the event's own address: the cookie of the flow is host-only", async () => {
    await setDomain(true);
    const jar = new Jar();
    const began = await goToProvider(onHost("tickets.example.com"), jar, SLUG, idp);

    // The same state and code, brought to the event's own address by a browser that holds no cookie of this flow there.
    const elsewhere = await onHost(OWN).request(`${ORIGIN}${began.callbackUrl.pathname}${began.callbackUrl.search}`, { redirect: "manual" });

    expect(elsewhere.status).toBe(302);
    expect(elsewhere.headers.get("location")).toBe(`/r/${SLUG}?sso=failed`);
    expect(elsewhere.headers.getSetCookie().some((line) => line.startsWith(`${GUEST_SSO_SESSION_COOKIE}=`) && !/Max-Age=0/.test(line))).toBe(false);
  });
});
